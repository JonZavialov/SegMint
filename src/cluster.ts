/**
 * Cosine-similarity-based greedy clustering.
 *
 * Algorithm: centroid-based greedy clustering.
 *
 * For each embedding (processed in input order, which is sorted by file_path):
 *   1. Compute cosine similarity between the embedding and each existing
 *      cluster centroid.
 *   2. If the highest similarity >= threshold, assign to that cluster
 *      and recompute its centroid as the component-wise mean of all
 *      member embeddings.
 *   3. Otherwise, start a new cluster with this embedding as its centroid.
 *
 * This produces deterministic results for a given input order and threshold.
 */

/** Cosine similarity between two vectors of equal length. Returns 0 for zero vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export interface Cluster {
  /** Indices into the original embeddings array. */
  indices: number[];
  /** Component-wise mean of member embeddings. */
  centroid: number[];
}

/**
 * Cluster embeddings using centroid-based greedy assignment.
 *
 * @param embeddings - Array of embedding vectors (same dimensionality)
 * @param threshold  - Minimum cosine similarity to join an existing cluster (default 0.80)
 * @returns Array of clusters, each with member indices and centroid
 */
export function clusterByThreshold(
  embeddings: number[][],
  threshold = 0.80,
): Cluster[] {
  if (embeddings.length === 0) return [];

  const dim = embeddings[0].length;
  const clusters: Cluster[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    const vec = embeddings[i];

    // Find the most similar existing cluster
    let bestCluster = -1;
    let bestSim = -Infinity;
    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSimilarity(vec, clusters[c].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = c;
      }
    }

    if (bestCluster >= 0 && bestSim >= threshold) {
      // Assign to existing cluster and recompute centroid
      const cluster = clusters[bestCluster];
      cluster.indices.push(i);

      // Update centroid: running mean
      const n = cluster.indices.length;
      for (let d = 0; d < dim; d++) {
        cluster.centroid[d] = cluster.centroid[d] * ((n - 1) / n) + vec[d] / n;
      }
    } else {
      // Start a new cluster
      clusters.push({
        indices: [i],
        centroid: [...vec],
      });
    }
  }

  return clusters;
}
