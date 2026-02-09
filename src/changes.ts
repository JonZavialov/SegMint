/**
 * Shared change-loading, ID resolution, and embedding text construction.
 *
 * Single source of truth for loading Change objects from the repository.
 * Used by both list_changes and group_changes to ensure consistent
 * ID assignment and change resolution across the substrate.
 */

import { createHash } from "node:crypto";
import { getUncommittedChanges } from "./git.js";
import type { Change, ChangeGroup } from "./models.js";
import { getEmbeddingProvider } from "./embeddings.js";
import { clusterByThreshold } from "./cluster.js";

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

/**
 * Derive a stable content-based hash from string parts.
 * Pure hash — joins parts as-is (no sorting). Callers are responsible
 * for sorting when order-independence is required (e.g. membership hashes).
 * Returns the first 8 hex chars of the SHA-256 digest.
 */
export function contentHash(parts: string[]): string {
  return createHash("sha256").update(parts.join(",")).digest("hex").slice(0, 8);
}

/**
 * Shared embed→cluster→ChangeGroup pipeline.
 *
 * Single source of truth for turning Change[] into ChangeGroup[].
 * Used by both the group_changes handler (on a user-specified subset)
 * and computeGroups (on all uncommitted changes).
 *
 * Group IDs are content-derived (stable across calls with same membership).
 */
export async function embedAndCluster(changes: Change[]): Promise<ChangeGroup[]> {
  if (changes.length === 0) return [];

  // Single change — skip embeddings, return one group
  if (changes.length === 1) {
    return [
      {
        // single element — no sort needed for membership stability
        id: `group-${contentHash([changes[0].id])}`,
        change_ids: [changes[0].id],
        summary: `Changes in ${changes[0].file_path}`,
      },
    ];
  }

  // Get embedding provider (throws if OPENAI_API_KEY not set and not local)
  const provider = getEmbeddingProvider();

  // Build embedding texts and compute embeddings
  const texts = changes.map((c) => buildEmbeddingText(c));
  const embeddings = await provider.embed(texts);

  // Cluster by cosine similarity
  const clusters = clusterByThreshold(embeddings, 0.80);

  // Map clusters to ChangeGroups with content-derived IDs
  return clusters.map((cluster) => {
    const clusterChanges = cluster.indices.map((i) => changes[i]);
    const changeIds = clusterChanges.map((c) => c.id);
    const filePaths = clusterChanges.map((c) => c.file_path);
    const summary =
      filePaths.length === 1
        ? `Changes in ${filePaths[0]}`
        : `Related changes across ${filePaths.join(", ")}`;

    return {
      // sorted for membership stability
      id: `group-${contentHash([...changeIds].sort())}`,
      change_ids: changeIds,
      summary,
    };
  });
}

/**
 * Load all uncommitted changes and cluster them into groups.
 *
 * Stateless recomputation: every call loads fresh repo state.
 * Returns both the raw changes and the computed groups.
 */
export async function computeGroups(cwd?: string): Promise<{ changes: Change[]; groups: ChangeGroup[] }> {
  const changes = loadChanges(cwd);
  const groups = await embedAndCluster(changes);
  return { changes, groups };
}
