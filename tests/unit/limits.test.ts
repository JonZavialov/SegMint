import { describe, it, expect } from "vitest";
import { truncateArray, capChanges } from "../../src/limits.js";

describe("limits helpers", () => {
  it("truncateArray returns unmodified values when under cap", () => {
    const result = truncateArray([1, 2, 3], 5);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(result.omitted_count).toBe(0);
  });

  it("truncateArray truncates deterministically when over cap", () => {
    const result = truncateArray([1, 2, 3, 4], 2);
    expect(result.items).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
    expect(result.omitted_count).toBe(2);
  });

  it("capChanges truncates files, hunks, and diff lines", () => {
    const changes = Array.from({ length: 205 }, (_, idx) => ({
      id: `change-${idx + 1}`,
      file_path: `f-${idx + 1}.ts`,
      hunks: [
        {
          old_start: 1,
          old_lines: 1,
          new_start: 1,
          new_lines: 1,
          header: "@@ -1,1 +1,1 @@",
          lines: Array.from({ length: 205 }, (__, lineIdx) => `+${lineIdx}`),
        },
      ],
    }));

    // Add extra hunks on first change to hit hunk cap path.
    for (let i = 0; i < 205; i++) {
      changes[0].hunks.push({
        old_start: i + 2,
        old_lines: 1,
        new_start: i + 2,
        new_lines: 1,
        header: `@@ -${i + 2},1 +${i + 2},1 @@`,
        lines: ["+x"],
      });
    }

    const result = capChanges(changes);
    expect(result.changes).toHaveLength(200);
    expect(result.changes[0].hunks).toHaveLength(200);
    expect(result.changes[1].hunks[0].lines).toHaveLength(200);
    expect(result.truncated).toBe(true);
    expect(result.omitted_count).toBeGreaterThan(0);
  });
});
