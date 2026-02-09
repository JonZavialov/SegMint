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
});
