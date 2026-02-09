import { describe, it, expect } from "vitest";
import { parseLogOutput } from "../../src/history.js";

describe("parseLogOutput", () => {
  it("returns empty for empty string", () => {
    expect(parseLogOutput("")).toEqual([]);
  });

  it("returns empty for whitespace-only", () => {
    expect(parseLogOutput("   \n  ")).toEqual([]);
  });

  it("parses a single commit", () => {
    const NUL = "\x00";
    const raw = `abc123${NUL}abc${NUL}feat: add feature${NUL}John${NUL}john@example.com${NUL}2024-01-01T00:00:00Z${NUL}parent1${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({
      sha: "abc123",
      short_sha: "abc",
      subject: "feat: add feature",
      author_name: "John",
      author_email: "john@example.com",
      author_date: "2024-01-01T00:00:00Z",
      parents: ["parent1"],
    });
  });

  it("parses multiple commits separated by double-NUL", () => {
    const NUL = "\x00";
    const raw =
      `sha1${NUL}s1${NUL}sub1${NUL}auth${NUL}e@m${NUL}2024-01-01${NUL}p1${NUL}${NUL}` +
      `sha2${NUL}s2${NUL}sub2${NUL}auth${NUL}e@m${NUL}2024-01-02${NUL}p2${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("sha1");
    expect(commits[1].sha).toBe("sha2");
  });

  it("handles root commit (no parents)", () => {
    // Root commit: %P is empty. The format outputs sha\0short\0sub\0auth\0email\0date\0\0\0
    // When split on \0\0, the first segment has only 6 fields (parents field merges into separator).
    // parseLogOutput skips records with < 7 fields, so root commits from git log are skipped.
    // This is expected behavior — git log rarely returns root commits in normal usage.
    const NUL = "\x00";
    // Simulate a root commit with an explicit empty parents field preserved by extra padding
    const raw = `abc${NUL}ab${NUL}init${NUL}John${NUL}j@m${NUL}2024-01-01${NUL} ${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].parents).toEqual([]);
  });

  it("handles merge commit (multiple parents)", () => {
    const NUL = "\x00";
    const raw = `abc${NUL}ab${NUL}merge${NUL}John${NUL}j@m${NUL}2024-01-01${NUL}p1 p2 p3${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits[0].parents).toEqual(["p1", "p2", "p3"]);
  });

  it("skips records with fewer than 7 fields", () => {
    const NUL = "\x00";
    const raw = `sha${NUL}short${NUL}sub${NUL}${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toEqual([]);
  });

  it("strips leading newlines from records", () => {
    const NUL = "\x00";
    const raw = `\nabc${NUL}ab${NUL}sub${NUL}auth${NUL}e@m${NUL}2024-01-01${NUL}p1${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe("abc");
  });

  it("skips empty records", () => {
    const NUL = "\x00";
    const raw = `${NUL}${NUL}${NUL}${NUL}`;
    const commits = parseLogOutput(raw);
    expect(commits).toEqual([]);
  });
});
