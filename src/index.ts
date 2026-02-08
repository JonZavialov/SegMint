#!/usr/bin/env node
/**
 * Segmint MCP Server
 *
 * A semantic Git runtime for AI agents. Exposes repository state as structured,
 * typed objects (Change, ChangeGroup, CommitPlan, PullRequestDraft) over the
 * Model Context Protocol so agents can inspect diffs, cluster edits by intent,
 * and operate on Git at a semantic level.
 *
 * list_changes and group_changes use real git + embeddings.
 * propose_commits, apply_commit, generate_pr return mocked data.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  MOCK_CHANGE_GROUPS,
  MOCK_COMMIT_PLANS,
  MOCK_PR_DRAFT,
} from "./mock-data.js";
import { loadChanges, resolveChangeIds, buildEmbeddingText } from "./changes.js";
import { getEmbeddingProvider } from "./embeddings.js";
import { clusterByThreshold } from "./cluster.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "segmint",
  version: "0.0.1",
});

// ---------------------------------------------------------------------------
// Tool: list_changes
// ---------------------------------------------------------------------------

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
          hunks: z.array(
            z.object({
              old_start: z.number(),
              old_lines: z.number(),
              new_start: z.number(),
              new_lines: z.number(),
              header: z.string(),
              lines: z.array(z.string()),
            })
          ),
        })
      ),
    }),
  },
  async (_args, _extra) => {
    try {
      const changes = loadChanges();
      const result = { changes };
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

// ---------------------------------------------------------------------------
// Tool: group_changes
// ---------------------------------------------------------------------------

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
    try {
      // Resolve requested IDs against current repo state
      const { changes, unknown } = resolveChangeIds(change_ids);
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

      // Single change — skip embeddings, return one group
      if (changes.length === 1) {
        const result = {
          groups: [
            {
              id: "group-1",
              change_ids: [changes[0].id],
              summary: `Changes in ${changes[0].file_path}`,
            },
          ],
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      }

      // Get embedding provider (throws if OPENAI_API_KEY not set)
      const provider = getEmbeddingProvider();

      // Build embedding texts and compute embeddings
      const texts = changes.map((c) => buildEmbeddingText(c));
      const embeddings = await provider.embed(texts);

      // Cluster by cosine similarity
      const clusters = clusterByThreshold(embeddings, 0.80);

      // Map clusters to ChangeGroups
      const groups = clusters.map((cluster, idx) => {
        const clusterChanges = cluster.indices.map((i) => changes[i]);
        const filePaths = clusterChanges.map((c) => c.file_path);
        const summary =
          filePaths.length === 1
            ? `Changes in ${filePaths[0]}`
            : `Related changes across ${filePaths.join(", ")}`;

        return {
          id: `group-${idx + 1}`,
          change_ids: clusterChanges.map((c) => c.id),
          summary,
        };
      });

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

// ---------------------------------------------------------------------------
// Tool: propose_commits
// ---------------------------------------------------------------------------

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
    const knownIds = new Set(MOCK_CHANGE_GROUPS.map((g) => g.id));
    const unknown = group_ids.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown group IDs: ${unknown.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const result = { commits: MOCK_COMMIT_PLANS };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: apply_commit
// ---------------------------------------------------------------------------

server.registerTool(
  "apply_commit",
  {
    description:
      "Apply a proposed commit to the repository. Accepts a commit plan ID and stages + commits the associated changes.",
    inputSchema: z.object({
      commit_id: z.string().describe("ID of the commit plan to apply"),
    }),
    outputSchema: z.object({
      success: z.boolean(),
    }),
  },
  async ({ commit_id }, _extra) => {
    const known = MOCK_COMMIT_PLANS.some((c) => c.id === commit_id);
    if (!known) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown commit ID: ${commit_id}`,
          },
        ],
        isError: true,
      };
    }

    const result = { success: true };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ---------------------------------------------------------------------------
// Tool: generate_pr
// ---------------------------------------------------------------------------

server.registerTool(
  "generate_pr",
  {
    description:
      "Generate a pull request draft from a set of commit plan IDs. Returns a PullRequestDraft with a title, description, and the full list of commits.",
    inputSchema: z.object({
      commit_ids: z
        .array(z.string())
        .describe("IDs of commit plans to include in the PR"),
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
  async ({ commit_ids }, _extra) => {
    const knownIds = new Set(MOCK_COMMIT_PLANS.map((c) => c.id));
    const unknown = commit_ids.filter((id) => !knownIds.has(id));
    if (unknown.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown commit IDs: ${unknown.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const result = {
      title: MOCK_PR_DRAFT.title,
      description: MOCK_PR_DRAFT.description,
      commits: MOCK_PR_DRAFT.commits.map((c) => ({ ...c })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Segmint MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
