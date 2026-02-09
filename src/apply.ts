/**
 * Real git commit execution with safety guardrails.
 *
 * Downstream consumer of the semantic substrate. Recomputes groups and
 * commit plans from current repo state, then stages and commits the
 * files belonging to a specific commit plan.
 *
 * Safety:
 * - Requires explicit `confirm: true`
 * - Defaults to `dry_run: true` (no mutation)
 * - Optional `expected_head_sha` for optimistic concurrency
 * - Fails if staged changes exist outside the commit's scope (unless allow_staged)
 * - Fails during merge/rebase
 */

import { computeGroups } from "./changes.js";
import { execGit, tryExecGit } from "./exec-git.js";
import type { ApplyCommitResult, Change } from "./models.js";
import { buildCommitPlan } from "./propose.js";

export interface ApplyCommitArgs {
  commit_id: string;
  confirm: boolean;
  dry_run?: boolean;
  expected_head_sha?: string;
  message_override?: string;
  allow_staged?: boolean;
}

/**
 * Apply a commit plan to the repository.
 *
 * Recomputes the full pipeline (changes → groups → plans) to find the
 * matching commit_id. Then stages the relevant files and commits them.
 */
export async function applyCommit(
  args: ApplyCommitArgs,
  cwd?: string,
): Promise<ApplyCommitResult> {
  const {
    commit_id,
    confirm,
    dry_run = true,
    expected_head_sha,
    message_override,
    allow_staged = false,
  } = args;

  // Gate 1: require explicit confirmation
  if (confirm !== true) {
    throw new Error(
      "confirm must be true to apply a commit. Set confirm: true and dry_run: false to create a real commit.",
    );
  }

  // Gate 2: check for merge/rebase in progress
  const statusRaw = execGit(["status", "--porcelain"], cwd);
  const hasConflict = statusRaw
    .split("\n")
    .some((line) => line.startsWith("UU") || line.startsWith("AA") || line.startsWith("DD"));
  if (hasConflict) {
    throw new Error(
      "Cannot commit during merge/rebase with unresolved conflicts. Resolve conflicts first.",
    );
  }

  // Gate 3: recompute full pipeline to find matching commit
  const { changes, groups } = await computeGroups(cwd);
  const allPlans = groups.map((g) => buildCommitPlan(g, changes));
  const plan = allPlans.find((p) => p.id === commit_id);
  if (!plan) {
    throw new Error(`Unknown commit ID: ${commit_id}`);
  }

  // Resolve plan → groups → changes → file_paths
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const planChangeIds = new Set<string>();
  for (const gid of plan.change_group_ids) {
    const group = groupMap.get(gid);
    if (group) {
      for (const cid of group.change_ids) {
        planChangeIds.add(cid);
      }
    }
  }
  const changeMap = new Map(changes.map((c) => [c.id, c]));
  const planChanges: Change[] = [];
  for (const cid of planChangeIds) {
    const change = changeMap.get(cid);
    if (change) planChanges.push(change);
  }
  const filePaths = planChanges.map((c) => c.file_path);

  // Gate 4: optimistic concurrency
  if (expected_head_sha !== undefined) {
    const headSha = execGit(["rev-parse", "HEAD"], cwd).trim();
    if (headSha !== expected_head_sha) {
      throw new Error(
        `HEAD has moved: expected ${expected_head_sha}, got ${headSha}`,
      );
    }
  }

  // Gate 5: check for staged changes outside scope
  if (!allow_staged) {
    const stagedRaw = tryExecGit(["diff", "--cached", "--name-only"], cwd);
    if (stagedRaw.ok && stagedRaw.stdout.trim().length > 0) {
      const stagedFiles = stagedRaw.stdout.trim().split("\n").filter(Boolean);
      const filePathSet = new Set(filePaths);
      const outsideScope = stagedFiles.filter((f) => !filePathSet.has(f));
      if (outsideScope.length > 0) {
        throw new Error(
          "Repository has staged changes outside this commit's scope. Unstage them first or pass allow_staged: true.",
        );
      }
    }
  }

  // Build commit message
  const title = message_override ?? plan.title;
  const description = message_override ? "" : plan.description;
  const displayMessage = description
    ? `${title}\n\n${description}`
    : title;

  // Dry run — return preview without mutation
  if (dry_run) {
    return {
      success: true,
      dry_run: true,
      committed_paths: filePaths,
      message: displayMessage,
    };
  }

  // Real commit: stage + commit
  execGit(["add", "--", ...filePaths], cwd);

  const commitArgs = message_override
    ? ["commit", "-m", title]
    : ["commit", "-m", title, "-m", description];
  execGit(commitArgs, cwd);

  const newSha = execGit(["rev-parse", "HEAD"], cwd).trim();

  return {
    success: true,
    dry_run: false,
    commit_sha: newSha,
    committed_paths: filePaths,
    message: displayMessage,
  };
}
