/**
 * Segmint MCP Server factory.
 *
 * Creates and configures the McpServer with all tool registrations.
 * Separated from index.ts to enable in-process testing without spawning
 * a child process — tests import createServer() directly.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadChanges, resolveChangeIds, embedAndCluster } from "./changes.js";
import { proposeCommits } from "./propose.js";
import { applyCommit } from "./apply.js";
import { generatePr } from "./generate-pr.js";
import { getRepoStatus } from "./status.js";
import { getLog } from "./history.js";
import { getCommit } from "./show.js";
import { getDiffBetweenRefs } from "./diff.js";
import { getBlame } from "./blame.js";
import { resolveGitRoot, tryResolveGitRoot } from "./exec-git.js";
import { MAX_BLAME_LINES, MAX_PATH_ENTRIES, capChanges, truncateArray } from "./limits.js";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const hunkSchema = z.object({
  old_start: z.number(),
  old_lines: z.number(),
  new_start: z.number(),
  new_lines: z.number(),
  header: z.string(),
  lines: z.array(z.string()),
});

const changeSchema = z.object({
  id: z.string(),
  file_path: z.string(),
  hunks: z.array(hunkSchema),
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully-configured Segmint MCP server.
 *
 * The returned server has all 10 tools registered and is ready to be
 * connected to any MCP transport (stdio, in-memory, etc.).
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "segmint",
    version: "0.1.1",
  });

  let configuredRepoRoot: string | undefined;
  const startupRepoRoot = tryResolveGitRoot(process.cwd());

  function activeRepoRoot(): string | undefined {
    return configuredRepoRoot ?? startupRepoRoot;
  }

  function noRepoResult() {
    const message = "No repository selected. Call set_repo_root first, or start Segmint from inside a git repository.";
    return {
      content: [{ type: "text" as const, text: message }],
      structuredContent: {
        code: "SEGMINT_NO_REPO",
        message,
      },
      isError: true,
    };
  }

  function requireRepoRoot(): string | undefined {
    return activeRepoRoot();
  }

  // -------------------------------------------------------------------------
  // Tool: set_repo_root (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "set_repo_root",
    {
      description:
        "Set explicit repository root for all Segmint tools. Accepts any directory inside a repo and resolves to the repo toplevel.",
      inputSchema: z.object({
        path: z.string().describe("Path to a git repository root or any subdirectory inside it"),
      }),
      outputSchema: z.object({
        repo_root: z.string(),
      }),
    },
    async ({ path }, _extra) => {
      try {
        const repo_root = resolveGitRoot(path);
        configuredRepoRoot = repo_root;
        return {
          content: [{ type: "text", text: JSON.stringify({ repo_root }, null, 2) }],
          structuredContent: { repo_root },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_repo_root",
    {
      description: "Get current repository root used by Segmint tools.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        repo_root: z.string().optional(),
      }),
    },
    async (_args, _extra) => {
      const repo_root = activeRepoRoot();
      return {
        content: [{ type: "text", text: JSON.stringify({ repo_root }, null, 2) }],
        structuredContent: { repo_root },
      };
    }
  );

  // -------------------------------------------------------------------------
  // Tool: list_changes
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_changes",
    {
      description:
        "List uncommitted changes in the repository, returned as structured Change objects with file paths and hunks.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        changes: z.array(
          z.object({
            id: z.string(),
            file_path: z.string(),
            hunks: z.array(hunkSchema),
          })
        ),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async (_args, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const changes = loadChanges(repoRoot);
        const limited = capChanges(changes);
        const result = { changes: limited.changes, truncated: limited.truncated, omitted_count: limited.omitted_count };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: repo_status (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "repo_status",
    {
      description:
        "Get structured repository status: HEAD ref, staged/unstaged/untracked files, ahead/behind counts, and merge/rebase state.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        is_git_repo: z.boolean(),
        root_path: z.string(),
        repo_root: z.string().optional(),
        head: z.object({
          type: z.enum(["branch", "detached"]),
          name: z.string().optional(),
          sha: z.string().optional(),
        }),
        staged: z.array(z.object({ path: z.string(), status: z.string() })),
        unstaged: z.array(z.object({ path: z.string(), status: z.string() })),
        untracked: z.array(z.string()),
        ahead_by: z.number().optional(),
        behind_by: z.number().optional(),
        upstream: z.string().optional(),
        merge_in_progress: z.boolean(),
        rebase_in_progress: z.boolean(),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async (_args, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const status = getRepoStatus(repoRoot);
        const staged = truncateArray(status.staged, MAX_PATH_ENTRIES);
        const unstaged = truncateArray(status.unstaged, MAX_PATH_ENTRIES);
        const untracked = truncateArray(status.untracked, MAX_PATH_ENTRIES);
        const omittedCount = staged.omitted_count + unstaged.omitted_count + untracked.omitted_count;
        const withSafety = {
          ...status,
          repo_root: repoRoot,
          staged: staged.items,
          unstaged: unstaged.items,
          untracked: untracked.items,
          truncated: omittedCount > 0,
          omitted_count: omittedCount,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(withSafety, null, 2) }],
          structuredContent: withSafety,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: log (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "log",
    {
      description:
        "Retrieve commit history as structured objects. Supports limit, ref, path filtering, date range, and merge filtering.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Max commits to return (default 20, clamped 1..200)"),
        ref: z
          .string()
          .optional()
          .describe("Git ref to start from (default HEAD)"),
        path: z
          .string()
          .optional()
          .describe("Restrict to commits touching this path"),
        since: z
          .string()
          .optional()
          .describe("Only commits after this date (ISO 8601 or git date string)"),
        until: z
          .string()
          .optional()
          .describe("Only commits before this date (ISO 8601 or git date string)"),
        include_merges: z
          .boolean()
          .optional()
          .describe("Include merge commits (default false)"),
      }),
      outputSchema: z.object({
        commits: z.array(
          z.object({
            sha: z.string(),
            short_sha: z.string(),
            subject: z.string(),
            author_name: z.string(),
            author_email: z.string(),
            author_date: z.string(),
            parents: z.array(z.string()),
          })
        ),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async (args, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = getLog(args, repoRoot);
        const commits = truncateArray(result.commits, MAX_PATH_ENTRIES);
        const safeResult = { commits: commits.items, truncated: commits.truncated, omitted_count: commits.omitted_count };
        return {
          content: [{ type: "text", text: JSON.stringify(safeResult, null, 2) }],
          structuredContent: safeResult,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: show_commit (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "show_commit",
    {
      description:
        "Retrieve full details for a single commit: metadata, affected files, and structured diff with Change/Hunk objects.",
      inputSchema: z.object({
        sha: z.string().describe("Commit SHA, short SHA, or ref to inspect"),
      }),
      outputSchema: z.object({
        commit: z.object({
          sha: z.string(),
          short_sha: z.string(),
          subject: z.string(),
          body: z.string(),
          author_name: z.string(),
          author_email: z.string(),
          author_date: z.string(),
          committer_name: z.string(),
          committer_email: z.string(),
          committer_date: z.string(),
          parents: z.array(z.string()),
          files: z.array(z.object({ path: z.string(), status: z.string() })),
          diff: z.object({
            changes: z.array(changeSchema),
          }),
        }),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async ({ sha }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = getCommit(sha, repoRoot);
        const files = truncateArray(result.commit.files, MAX_PATH_ENTRIES);
        const diff = capChanges(result.commit.diff.changes);
        const safeResult = {
          commit: {
            ...result.commit,
            files: files.items,
            diff: { changes: diff.changes },
          },
          truncated: files.truncated || diff.truncated,
          omitted_count: files.omitted_count + diff.omitted_count,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(safeResult, null, 2) }],
          structuredContent: {
            ...safeResult,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: diff_between_refs (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "diff_between_refs",
    {
      description:
        "Compute a structured diff between any two git refs (branches, commits, tags). Returns Change[] with typed hunks.",
      inputSchema: z.object({
        base: z.string().describe("Base ref (branch, tag, SHA, or expression like HEAD~3)"),
        head: z.string().describe("Head ref to diff against base"),
        path: z
          .string()
          .optional()
          .describe("Restrict diff to this path"),
        unified: z
          .number()
          .optional()
          .describe("Lines of context (default 3, clamped 0..20)"),
      }),
      outputSchema: z.object({
        base: z.string(),
        head: z.string(),
        changes: z.array(changeSchema),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async ({ base, head, path, unified }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const changes = getDiffBetweenRefs({ base, head, path, unified }, repoRoot);
        const limited = capChanges(changes);
        const result = { base, head, changes: limited.changes, truncated: limited.truncated, omitted_count: limited.omitted_count };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: {
            base,
            head,
            changes: limited.changes.map((c) => ({
              ...c,
              hunks: c.hunks.map((h) => ({ ...h, lines: [...h.lines] })),
            })),
            truncated: limited.truncated,
            omitted_count: limited.omitted_count,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: blame (Tier 1 — read-only)
  // -------------------------------------------------------------------------

  server.registerTool(
    "blame",
    {
      description:
        "Line-level attribution for a file: for each line, returns the commit SHA, author, timestamp, and summary. Supports line ranges, whitespace-ignoring, and move/copy detection.",
      inputSchema: z.object({
        path: z.string().describe("Repo-relative file path to blame"),
        ref: z
          .string()
          .optional()
          .describe("Git ref to blame at (default HEAD)"),
        start_line: z
          .number()
          .optional()
          .describe("Start line (1-indexed, inclusive)"),
        end_line: z
          .number()
          .optional()
          .describe("End line (1-indexed, inclusive)"),
        ignore_whitespace: z
          .boolean()
          .optional()
          .describe("Ignore whitespace changes (default false)"),
        detect_moves: z
          .boolean()
          .optional()
          .describe("Detect moved/copied lines across files (default false)"),
      }),
      outputSchema: z.object({
        path: z.string(),
        ref: z.string(),
        lines: z.array(
          z.object({
            line_number: z.number(),
            content: z.string(),
            commit: z.object({
              sha: z.string(),
              short_sha: z.string(),
              author_name: z.string(),
              author_email: z.string(),
              author_time: z.string(),
              summary: z.string(),
            }),
          })
        ),
        truncated: z.boolean(),
        omitted_count: z.number(),
      }),
    },
    async ({ path, ref, start_line, end_line, ignore_whitespace, detect_moves }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = getBlame({ path, ref, start_line, end_line, ignore_whitespace, detect_moves }, repoRoot);
        const lines = truncateArray(result.lines, MAX_BLAME_LINES);
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, lines: lines.items, truncated: lines.truncated, omitted_count: lines.omitted_count }, null, 2) }],
          structuredContent: {
            path: result.path,
            ref: result.ref,
            lines: lines.items.map((l) => ({
              line_number: l.line_number,
              content: l.content,
              commit: { ...l.commit },
            })),
            truncated: lines.truncated,
            omitted_count: lines.omitted_count,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: group_changes
  // -------------------------------------------------------------------------

  server.registerTool(
    "group_changes",
    {
      description:
        "Group a set of changes by intent. Accepts change IDs and returns ChangeGroups, each with a summary describing the purpose of the grouped edits.",
      inputSchema: z.object({
        change_ids: z
          .array(z.string())
          .describe("IDs of changes to group (from list_changes)"),
      }),
      outputSchema: z.object({
        groups: z.array(
          z.object({
            id: z.string(),
            change_ids: z.array(z.string()),
            summary: z.string(),
          })
        ),
      }),
    },
    async ({ change_ids }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        // Resolve requested IDs against current repo state
        const { changes, unknown } = resolveChangeIds(change_ids, repoRoot);
        if (unknown.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown change IDs: ${unknown.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        // Shared embed→cluster pipeline (handles 0, 1, and N changes)
        const groups = await embedAndCluster(changes);

        const result = { groups };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: propose_commits
  // -------------------------------------------------------------------------

  server.registerTool(
    "propose_commits",
    {
      description:
        "Given change group IDs, propose a sequence of commits. Returns CommitPlans with titles, descriptions, and the groups each commit covers.",
      inputSchema: z.object({
        group_ids: z
          .array(z.string())
          .describe("IDs of change groups to create commits for"),
      }),
      outputSchema: z.object({
        commits: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            change_group_ids: z.array(z.string()),
          })
        ),
      }),
    },
    async ({ group_ids }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = await proposeCommits(group_ids, repoRoot);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: apply_commit
  // -------------------------------------------------------------------------

  server.registerTool(
    "apply_commit",
    {
      description:
        "Apply a proposed commit to the repository. Stages + commits the associated changes with safety guardrails. Defaults to dry_run mode.",
      inputSchema: z.object({
        commit_id: z.string().describe("ID of the commit plan to apply (from propose_commits)"),
        confirm: z.boolean().describe("Must be true to proceed. Safety gate."),
        dry_run: z
          .boolean()
          .optional()
          .describe("Preview without mutating (default true). Set false to create a real commit."),
        expected_head_sha: z
          .string()
          .optional()
          .describe("If provided, fail if HEAD has moved (optimistic concurrency guard)"),
        message_override: z
          .string()
          .optional()
          .describe("Custom commit message (overrides heuristic title)"),
        allow_staged: z
          .boolean()
          .optional()
          .describe("Allow existing staged changes outside this commit's scope (default false)"),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        dry_run: z.boolean(),
        commit_sha: z.string().optional(),
        committed_paths: z.array(z.string()),
        message: z.string(),
      }),
    },
    async ({ commit_id, confirm, dry_run, expected_head_sha, message_override, allow_staged }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = await applyCommit(
          { commit_id, confirm, dry_run, expected_head_sha, message_override, allow_staged },
          repoRoot,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: { ...result },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tool: generate_pr
  // -------------------------------------------------------------------------

  server.registerTool(
    "generate_pr",
    {
      description:
        "Generate a pull request draft from real commit SHAs. Returns a PullRequestDraft with a title, description, and the full list of commits.",
      inputSchema: z.object({
        commit_shas: z
          .array(z.string())
          .describe("Git commit SHAs (hex format, 4+ chars) to include in the PR draft"),
      }),
      outputSchema: z.object({
        title: z.string(),
        description: z.string(),
        commits: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            change_group_ids: z.array(z.string()),
          })
        ),
      }),
    },
    async ({ commit_shas }, _extra) => {
      const repoRoot = requireRepoRoot();
      if (!repoRoot) return noRepoResult();
      try {
        const result = generatePr(commit_shas, repoRoot);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: {
            title: result.title,
            description: result.description,
            commits: result.commits.map((c) => ({ ...c })),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  return server;
}
