import { describe, it, expect } from "vitest";
import { cosineSimilarity, clusterByThreshold } from "../../src/cluster.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 when both are zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("returns 1 for parallel vectors with different magnitude", () => {
    expect(cosineSimilarity([1, 0], [100, 0])).toBeCloseTo(1, 10);
  });
});

describe("clusterByThreshold", () => {
  it("returns empty for empty input", () => {
    expect(clusterByThreshold([])).toEqual([]);
  });

  it("returns single cluster for single embedding", () => {
    const result = clusterByThreshold([[1, 2, 3]]);
    expect(result).toHaveLength(1);
    expect(result[0].indices).toEqual([0]);
  });

  it("groups all identical embeddings into one cluster", () => {
    const vec = [1, 0, 0];
    const result = clusterByThreshold([vec, vec, vec], 0.80);
    expect(result).toHaveLength(1);
    expect(result[0].indices).toEqual([0, 1, 2]);
  });

  it("separates orthogonal embeddings into N clusters", () => {
    const result = clusterByThreshold([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 0.80);
    expect(result).toHaveLength(3);
    expect(result[0].indices).toEqual([0]);
    expect(result[1].indices).toEqual([1]);
    expect(result[2].indices).toEqual([2]);
  });

  it("updates centroids correctly when merging", () => {
    // Two very similar vectors + one different
    const a = [1, 0, 0];
    const b = [0.99, 0.01, 0]; // very close to a
    const c = [0, 1, 0]; // orthogonal
    const result = clusterByThreshold([a, b, c], 0.80);
    // a and b should cluster together; c should be separate
    expect(result).toHaveLength(2);
    expect(result[0].indices).toContain(0);
    expect(result[0].indices).toContain(1);
    expect(result[1].indices).toEqual([2]);
  });

  it("uses default threshold of 0.80", () => {
    // These two vectors have similarity > 0.80
    const a = [1, 0, 0, 0];
    const b = [0.95, 0.05, 0, 0];
    const result = clusterByThreshold([a, b]);
    expect(result).toHaveLength(1);
  });

  it("threshold 0 clusters all non-zero vectors together", () => {
    // cosine similarity is always >= 0 for non-negative vectors,
    // and can be negative for opposite vectors, but threshold=0 means
    // anything with similarity >= 0 joins the first cluster
    const result = clusterByThreshold(
      [[1, 0], [0, 1], [0.5, 0.5]],
      0,
    );
    // [1,0] starts cluster. [0,1] has sim=0 with [1,0], which is >= 0, so it joins.
    // [0.5,0.5] has sim > 0 with centroid, so it joins.
    expect(result).toHaveLength(1);
    expect(result[0].indices).toEqual([0, 1, 2]);
  });

  it("threshold 1 creates separate clusters for non-identical vectors", () => {
    const result = clusterByThreshold(
      [[1, 0], [0.99, 0.01], [0, 1]],
      1.0,
    );
    // Only perfectly identical vectors (similarity === 1.0) would cluster.
    // [0.99, 0.01] has sim < 1.0 with [1, 0], so it gets its own cluster.
    expect(result).toHaveLength(3);
  });

  it("threshold 1 groups truly identical vectors", () => {
    const result = clusterByThreshold(
      [[1, 0], [1, 0], [0, 1]],
      1.0,
    );
    expect(result).toHaveLength(2);
    expect(result[0].indices).toEqual([0, 1]);
    expect(result[1].indices).toEqual([2]);
  });

  it("negative threshold clusters opposite vectors together", () => {
    const result = clusterByThreshold(
      [[1, 0], [-1, 0], [0, 1]],
      -1.0,
    );
    // Everything has sim >= -1.0, so all join first cluster
    expect(result).toHaveLength(1);
    expect(result[0].indices).toEqual([0, 1, 2]);
  });
});
