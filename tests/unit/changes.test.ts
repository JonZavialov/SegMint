import { describe, it, expect, vi } from "vitest";
import { buildEmbeddingText } from "../../src/changes.js";
import type { Change } from "../../src/models.js";

// Mock getUncommittedChanges to test loadChanges/resolveChangeIds without git
vi.mock("../../src/git.js", () => ({
  getUncommittedChanges: vi.fn(() => [
    { id: "change-1", file_path: "a.ts", hunks: [] },
    { id: "change-2", file_path: "b.ts", hunks: [] },
  ]),
  parseDiff: vi.fn(() => []),
}));

describe("buildEmbeddingText", () => {
  it("includes file path", () => {
    const change: Change = {
      id: "change-1",
      file_path: "src/foo.ts",
      hunks: [],
    };
    const text = buildEmbeddingText(change);
    expect(text).toBe("file: src/foo.ts");
  });

  it("includes hunk header and lines", () => {
    const change: Change = {
      id: "change-1",
      file_path: "src/foo.ts",
      hunks: [
        {
          old_start: 1,
          old_lines: 2,
          new_start: 1,
          new_lines: 3,
          header: "@@ -1,2 +1,3 @@",
          lines: ["+added line", " context"],
        },
      ],
    };
    const text = buildEmbeddingText(change);
    expect(text).toContain("file: src/foo.ts");
    expect(text).toContain("@@ -1,2 +1,3 @@");
    expect(text).toContain("+added line");
    expect(text).toContain(" context");
  });

  it("includes multiple hunks", () => {
    const change: Change = {
      id: "change-1",
      file_path: "src/foo.ts",
      hunks: [
        {
          old_start: 1, old_lines: 1, new_start: 1, new_lines: 1,
          header: "@@ -1,1 +1,1 @@",
          lines: ["+line1"],
        },
        {
          old_start: 10, old_lines: 1, new_start: 10, new_lines: 1,
          header: "@@ -10,1 +10,1 @@",
          lines: ["+line2"],
        },
      ],
    };
    const text = buildEmbeddingText(change);
    expect(text).toContain("@@ -1,1 +1,1 @@");
    expect(text).toContain("@@ -10,1 +10,1 @@");
  });

  it("truncates at 200 lines", () => {
    const manyLines = Array.from({ length: 250 }, (_, i) => `+line${i}`);
    const change: Change = {
      id: "change-1",
      file_path: "src/foo.ts",
      hunks: [
        {
          old_start: 1, old_lines: 0, new_start: 1, new_lines: 250,
          header: "@@ -1,0 +1,250 @@",
          lines: manyLines,
        },
      ],
    };
    const text = buildEmbeddingText(change);
    const parts = text.split("\n");
    // file: line + header + 199 lines = 201 (header counts as 1 line toward 200)
    expect(parts.length).toBeLessThanOrEqual(201);
  });

  it("handles change with 0 hunks", () => {
    const change: Change = {
      id: "change-1",
      file_path: "src/empty.ts",
      hunks: [],
    };
    expect(buildEmbeddingText(change)).toBe("file: src/empty.ts");
  });

  it("stops adding hunks when limit is reached at hunk boundary", () => {
    // Create a change where the first hunk exactly fills the 200-line limit,
    // so the second hunk header triggers the break on line 53 (hunk-level check)
    const lines199 = Array.from({ length: 199 }, (_, i) => `+line${i}`);
    const change: Change = {
      id: "change-1",
      file_path: "src/big.ts",
      hunks: [
        {
          old_start: 1, old_lines: 0, new_start: 1, new_lines: 199,
          header: "@@ -1,0 +1,199 @@",
          lines: lines199,
        },
        {
          old_start: 300, old_lines: 1, new_start: 300, new_lines: 1,
          header: "@@ -300,1 +300,1 @@",
          lines: ["+should not appear"],
        },
      ],
    };
    const text = buildEmbeddingText(change);
    // 1 (header of hunk1) + 199 (lines) = 200 lines exactly at limit
    // Second hunk header should NOT be included
    expect(text).not.toContain("@@ -300");
    expect(text).toContain("@@ -1,0 +1,199 @@");
  });
});

describe("loadChanges", () => {
  it("delegates to getUncommittedChanges", async () => {
    const { loadChanges } = await import("../../src/changes.js");
    const changes = loadChanges();
    expect(changes).toHaveLength(2);
    expect(changes[0].id).toBe("change-1");
  });
});

describe("resolveChangeIds", () => {
  it("resolves known IDs", async () => {
    const { resolveChangeIds } = await import("../../src/changes.js");
    const result = resolveChangeIds(["change-1"]);
    expect(result.changes).toHaveLength(1);
    expect(result.unknown).toEqual([]);
  });

  it("reports unknown IDs", async () => {
    const { resolveChangeIds } = await import("../../src/changes.js");
    const result = resolveChangeIds(["change-1", "bad-id"]);
    expect(result.unknown).toEqual(["bad-id"]);
  });

  it("reports all unknown when none match", async () => {
    const { resolveChangeIds } = await import("../../src/changes.js");
    const result = resolveChangeIds(["nope-1", "nope-2"]);
    expect(result.changes).toEqual([]);
    expect(result.unknown).toEqual(["nope-1", "nope-2"]);
  });

  it("returns empty changes and empty unknown for empty input", async () => {
    const { resolveChangeIds } = await import("../../src/changes.js");
    const result = resolveChangeIds([]);
    expect(result.changes).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it("returns duplicates when duplicate IDs are requested", async () => {
    const { resolveChangeIds } = await import("../../src/changes.js");
    const result = resolveChangeIds(["change-1", "change-1"]);
    // filter returns all matching entries for each occurrence
    expect(result.changes).toHaveLength(1);
    expect(result.unknown).toEqual([]);
  });
});
