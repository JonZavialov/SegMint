import { describe, it, expect } from "vitest";
import {
  parseMetadata,
  parseNameStatus,
  showStatusCodeToLabel,
} from "../../src/show.js";

describe("parseMetadata", () => {
  it("parses normal 11-part output", () => {
    const parts = [
      "fullsha", "short", "the subject", "the body",
      "Author", "a@m.com", "2024-01-01T00:00:00Z",
      "Committer", "c@m.com", "2024-01-01T00:00:00Z",
      "parent1 parent2",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.sha).toBe("fullsha");
    expect(result.short_sha).toBe("short");
    expect(result.subject).toBe("the subject");
    expect(result.body).toBe("the body");
    expect(result.author_name).toBe("Author");
    expect(result.author_email).toBe("a@m.com");
    expect(result.committer_name).toBe("Committer");
    expect(result.parents).toEqual(["parent1", "parent2"]);
  });

  it("handles 10 parts (empty body)", () => {
    const parts = [
      "fullsha", "short", "subject",
      "Author", "a@m.com", "2024-01-01",
      "Committer", "c@m.com", "2024-01-01",
      "",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.body).toBe("");
    expect(result.parents).toEqual([]);
  });

  it("throws for fewer than 10 parts", () => {
    const raw = "a\0b\0c\0d\0e";
    expect(() => parseMetadata(raw)).toThrow("Unexpected git show output format");
  });

  it("handles body with newlines", () => {
    const parts = [
      "sha", "sh", "sub", "line1\nline2\nline3",
      "Author", "a@m", "2024-01-01",
      "Committer", "c@m", "2024-01-01",
      "p1",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.body).toBe("line1\nline2\nline3");
  });

  it("handles no parents (root commit)", () => {
    const parts = [
      "sha", "sh", "init", "body",
      "Author", "a@m", "2024-01-01",
      "Committer", "c@m", "2024-01-01",
      "",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.parents).toEqual([]);
  });

  it("handles multiple parents (merge commit)", () => {
    const parts = [
      "sha", "sh", "merge", "body",
      "Author", "a@m", "2024-01-01",
      "Committer", "c@m", "2024-01-01",
      "p1 p2 p3",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.parents).toEqual(["p1", "p2", "p3"]);
  });

  it("handles body containing NUL (12+ parts)", () => {
    // Body with embedded NUL splits into multiple parts (>11 total)
    const parts = [
      "sha", "sh", "sub",
      "body-part1", "body-part2",     // body split across 2 parts
      "Author", "a@m", "2024-01-01",
      "Committer", "c@m", "2024-01-01",
      "p1",
    ];
    const raw = parts.join("\0");
    const result = parseMetadata(raw);
    expect(result.sha).toBe("sha");
    expect(result.subject).toBe("sub");
    expect(result.body).toBe("body-part1\0body-part2");
    expect(result.author_name).toBe("Author");
    expect(result.parents).toEqual(["p1"]);
  });
});

describe("parseNameStatus", () => {
  it("returns empty for empty input", () => {
    expect(parseNameStatus("")).toEqual([]);
  });

  it("parses modified file", () => {
    const result = parseNameStatus("M\tsrc/file.ts\n");
    expect(result).toEqual([{ path: "src/file.ts", status: "modified" }]);
  });

  it("parses rename with old and new path", () => {
    const result = parseNameStatus("R100\told.ts\tnew.ts\n");
    expect(result).toEqual([{ path: "new.ts", status: "renamed" }]);
  });

  it("parses copy", () => {
    const result = parseNameStatus("C100\tsrc.ts\tdest.ts\n");
    expect(result).toEqual([{ path: "dest.ts", status: "copied" }]);
  });

  it("skips lines with fewer than 2 parts", () => {
    const result = parseNameStatus("M\n");
    expect(result).toEqual([]);
  });

  it("parses added file", () => {
    const result = parseNameStatus("A\tsrc/new-file.ts\n");
    expect(result).toEqual([{ path: "src/new-file.ts", status: "added" }]);
  });

  it("parses deleted file", () => {
    const result = parseNameStatus("D\tsrc/removed.ts\n");
    expect(result).toEqual([{ path: "src/removed.ts", status: "deleted" }]);
  });

  it("parses multiple entries of mixed types", () => {
    const input = "M\tsrc/mod.ts\nA\tsrc/new.ts\nD\tsrc/old.ts\nR100\ta.ts\tb.ts\n";
    const result = parseNameStatus(input);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ path: "src/mod.ts", status: "modified" });
    expect(result[1]).toEqual({ path: "src/new.ts", status: "added" });
    expect(result[2]).toEqual({ path: "src/old.ts", status: "deleted" });
    expect(result[3]).toEqual({ path: "b.ts", status: "renamed" });
  });
});

describe("showStatusCodeToLabel", () => {
  const cases: Array<[string, string]> = [
    ["M", "modified"],
    ["A", "added"],
    ["D", "deleted"],
    ["R", "renamed"],
    ["R100", "renamed"],
    ["C", "copied"],
    ["C100", "copied"],
    ["U", "unmerged"],
    ["T", "typechange"],
    ["X", "X"],
  ];

  for (const [code, expected] of cases) {
    it(`maps "${code}" to "${expected}"`, () => {
      expect(showStatusCodeToLabel(code)).toBe(expected);
    });
  }
});
