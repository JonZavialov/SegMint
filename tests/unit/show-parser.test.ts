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
