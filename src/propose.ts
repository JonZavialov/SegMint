/**
 * Deterministic commit planning from ChangeGroups.
 *
 * Downstream consumer of the semantic substrate. Recomputes groups
 * from current repo state (stateless) and maps each requested group
 * to a CommitPlan with heuristic titles derived from file paths.
 */

import { computeGroups, contentHash } from "./changes.js";
import type { Change, ChangeGroup, CommitPlan } from "./models.js";

/**
 * Generate a heuristic commit title from file paths.
 *
 * - 1 file: "Update <basename>"
 * - 2-3 files: "Update <f1>, <f2>, <f3>"
 * - 4+ files: "Update <f1>, <f2>, and N more"
 */
function heuristicTitle(filePaths: string[]): string {
  const basenames = filePaths.map((p) => {
    const parts = p.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1];
  });

  if (basenames.length <= 3) {
    return `Update ${basenames.join(", ")}`;
  }
  return `Update ${basenames[0]}, ${basenames[1]}, and ${basenames.length - 2} more`;
}

/**
 * Generate a commit description listing file paths and hunk counts.
 */
function buildDescription(changes: Change[]): string {
  const lines = changes.map(
    (c) => `- ${c.file_path} (${c.hunks.length} hunk${c.hunks.length === 1 ? "" : "s"})`,
  );
  return `Changes across ${changes.length} file(s):\n${lines.join("\n")}`;
}

/**
 * Build a CommitPlan from a ChangeGroup and its resolved changes.
 */
export function buildCommitPlan(
  group: ChangeGroup,
  allChanges: Change[],
): CommitPlan {
  const changeMap = new Map(allChanges.map((c) => [c.id, c]));
  const groupChanges = group.change_ids
    .map((id) => changeMap.get(id))
    .filter((c): c is Change => c !== undefined);
  const filePaths = groupChanges.map((c) => c.file_path);

  return {
    // single element — no sort needed for membership stability
    id: `commit-${contentHash([group.id])}`,
    title: heuristicTitle(filePaths),
    description: buildDescription(groupChanges),
    change_group_ids: [group.id],
  };
}

/**
 * Propose commits for the given group IDs.
 *
 * Stateless: recomputes all groups from current repo state, then validates
 * requested group IDs against the computed set. Returns one CommitPlan per
 * valid group in input order.
 */
export async function proposeCommits(
  groupIds: string[],
  cwd?: string,
): Promise<{ commits: CommitPlan[] }> {
  const { changes, groups } = await computeGroups(cwd);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const unknown = groupIds.filter((id) => !groupMap.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown group IDs: ${unknown.join(", ")}`);
  }

  const commits = groupIds.map((id) => {
    const group = groupMap.get(id)!;
    return buildCommitPlan(group, changes);
  });

  return { commits };
}
