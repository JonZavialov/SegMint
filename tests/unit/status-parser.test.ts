import { describe, it, expect } from "vitest";
import {
  parsePorcelain,
  parseBranchHeader,
  statusCodeToLabel,
} from "../../src/status.js";

describe("statusCodeToLabel", () => {
  const cases: Array<[string, string]> = [
    ["M", "modified"],
    ["A", "added"],
    ["D", "deleted"],
    ["R", "renamed"],
    ["C", "copied"],
    ["U", "unmerged"],
    ["T", "typechange"],
    ["X", "X"],
  ];

  for (const [code, expected] of cases) {
    it(`maps "${code}" to "${expected}"`, () => {
      expect(statusCodeToLabel(code)).toBe(expected);
    });
  }
});

describe("parseBranchHeader", () => {
  it("extracts upstream from tracking branch", () => {
    const result = parseBranchHeader("## main...origin/main");
    expect(result.upstream).toBe("origin/main");
    expect(result.aheadBy).toBeUndefined();
    expect(result.behindBy).toBeUndefined();
  });

  it("extracts ahead count", () => {
    const result = parseBranchHeader("## main...origin/main [ahead 3]");
    expect(result.upstream).toBe("origin/main");
    expect(result.aheadBy).toBe(3);
    expect(result.behindBy).toBeUndefined();
  });

  it("extracts behind count", () => {
    const result = parseBranchHeader("## main...origin/main [behind 5]");
    expect(result.upstream).toBe("origin/main");
    expect(result.aheadBy).toBeUndefined();
    expect(result.behindBy).toBe(5);
  });

  it("extracts both ahead and behind", () => {
    const result = parseBranchHeader("## main...origin/main [ahead 1, behind 2]");
    expect(result.upstream).toBe("origin/main");
    expect(result.aheadBy).toBe(1);
    expect(result.behindBy).toBe(2);
  });

  it("returns no tracking for detached HEAD", () => {
    const result = parseBranchHeader("## HEAD (no branch)");
    expect(result.upstream).toBeUndefined();
    expect(result.aheadBy).toBeUndefined();
    expect(result.behindBy).toBeUndefined();
  });

  it("returns no tracking for fresh repo", () => {
    const result = parseBranchHeader("## No commits yet on main");
    expect(result.upstream).toBeUndefined();
  });
});

describe("parsePorcelain", () => {
  it("returns empty for empty output", () => {
    const result = parsePorcelain("");
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it("parses branch header with upstream", () => {
    const result = parsePorcelain("## main...origin/main [ahead 1]\n");
    expect(result.upstream).toBe("origin/main");
    expect(result.aheadBy).toBe(1);
  });

  it("parses staged file", () => {
    const result = parsePorcelain("## main\nM  src/foo.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "src/foo.ts", status: "modified" });
    expect(result.unstaged).toEqual([]);
  });

  it("parses unstaged file", () => {
    const result = parsePorcelain("## main\n M src/foo.ts\n");
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0]).toEqual({ path: "src/foo.ts", status: "modified" });
    expect(result.staged).toEqual([]);
  });

  it("parses untracked file", () => {
    const result = parsePorcelain("## main\n?? newfile.ts\n");
    expect(result.untracked).toEqual(["newfile.ts"]);
  });

  it("parses renamed with arrow", () => {
    const result = parsePorcelain("## main\nR  old.ts -> new.ts\n");
    expect(result.staged[0].path).toBe("new.ts");
    expect(result.staged[0].status).toBe("renamed");
  });

  it("handles MM (both staged and unstaged)", () => {
    const result = parsePorcelain("## main\nMM src/both.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.unstaged).toHaveLength(1);
    expect(result.staged[0].path).toBe("src/both.ts");
    expect(result.unstaged[0].path).toBe("src/both.ts");
  });

  it("skips short lines", () => {
    const result = parsePorcelain("## main\nXY\n");
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
  });

  it("ignores !! (ignored) entries", () => {
    const result = parsePorcelain("## main\n!! ignored-dir/\n");
    expect(result.staged).toEqual([]);
    expect(result.unstaged).toEqual([]);
    expect(result.untracked).toEqual([]);
  });

  it("parses staged added file", () => {
    const result = parsePorcelain("## main\nA  src/new.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "src/new.ts", status: "added" });
    expect(result.unstaged).toEqual([]);
  });

  it("parses staged deleted file", () => {
    const result = parsePorcelain("## main\nD  src/old.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "src/old.ts", status: "deleted" });
  });

  it("parses unstaged deleted file", () => {
    const result = parsePorcelain("## main\n D src/gone.ts\n");
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0]).toEqual({ path: "src/gone.ts", status: "deleted" });
    expect(result.staged).toEqual([]);
  });

  it("parses staged copied file", () => {
    const result = parsePorcelain("## main\nC  old.ts -> copy.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "copy.ts", status: "copied" });
  });

  it("parses staged typechange", () => {
    const result = parsePorcelain("## main\nT  link.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "link.ts", status: "typechange" });
  });

  it("parses unstaged typechange", () => {
    const result = parsePorcelain("## main\n T link.ts\n");
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0]).toEqual({ path: "link.ts", status: "typechange" });
  });

  it("parses staged unmerged file", () => {
    const result = parsePorcelain("## main\nU  conflict.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "conflict.ts", status: "unmerged" });
  });

  it("parses AD (staged add, unstaged delete)", () => {
    const result = parsePorcelain("## main\nAD src/temp.ts\n");
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({ path: "src/temp.ts", status: "added" });
    expect(result.unstaged).toHaveLength(1);
    expect(result.unstaged[0]).toEqual({ path: "src/temp.ts", status: "deleted" });
  });
});
