/**
 * Shared change-loading and text-building helpers.
 *
 * Used by both list_changes and group_changes to ensure a single source
 * of truth for change collection and ID assignment.
 */

import { getUncommittedChanges } from "./git.js";
import type { Change } from "./models.js";

/** Maximum number of diff lines included per change in embedding text. */
const MAX_EMBEDDING_LINES = 200;

/**
 * Load current uncommitted changes from the repository.
 * Returns sorted Change[] with deterministic IDs (change-1, change-2, ...).
 *
 * This is the single source of truth — both list_changes and group_changes
 * must use this function so IDs are consistent.
 */
export function loadChanges(cwd?: string): Change[] {
  return getUncommittedChanges(cwd);
}

/**
 * Resolve requested change IDs against the current repo state.
 *
 * @returns changes matching the requested IDs, plus any unknown IDs
 */
export function resolveChangeIds(
  requestedIds: string[],
  cwd?: string,
): { changes: Change[]; unknown: string[] } {
  const all = loadChanges(cwd);
  const knownIds = new Set(all.map((c) => c.id));
  const unknown = requestedIds.filter((id) => !knownIds.has(id));
  const changes = all.filter((c) => requestedIds.includes(c.id));
  return { changes, unknown };
}

/**
 * Build embedding text for a Change.
 *
 * Includes file path, hunk headers, and diff lines.
 * Truncated deterministically at line boundaries (MAX_EMBEDDING_LINES).
 */
export function buildEmbeddingText(change: Change): string {
  const parts: string[] = [`file: ${change.file_path}`];
  let lineCount = 0;

  for (const hunk of change.hunks) {
    if (lineCount >= MAX_EMBEDDING_LINES) break;
    parts.push(hunk.header);
    lineCount++;

    for (const line of hunk.lines) {
      if (lineCount >= MAX_EMBEDDING_LINES) break;
      parts.push(line);
      lineCount++;
    }
  }

  return parts.join("\n");
}
