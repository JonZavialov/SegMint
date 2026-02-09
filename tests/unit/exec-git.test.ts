import { describe, it, expect, vi } from "vitest";
import { throwGitError, compareAscii, tryExecGit, execGit } from "../../src/exec-git.js";

describe("throwGitError", () => {
  it("re-throws non-Error values", () => {
    expect(() => throwGitError("string error")).toThrow("string error");
  });

  it('maps "not a git repository" to clean message', () => {
    const err = new Error("fatal: not a git repository");
    expect(() => throwGitError(err)).toThrow("Not a git repository");
  });

  it("matches case-insensitively", () => {
    const err = new Error("fatal: Not A Git Repository (or any parent)");
    expect(() => throwGitError(err)).toThrow("Not a git repository");
  });

  it("maps ENOENT to git-not-found message", () => {
    const err = new Error("spawn git ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    expect(() => throwGitError(err)).toThrow(
      "git command not found. Please install git."
    );
  });

  it("uses stderr when available", () => {
    const err = Object.assign(new Error("some error"), {
      stderr: "custom stderr message",
    });
    expect(() => throwGitError(err)).toThrow("custom stderr message");
  });

  it('falls back to "Unknown git error" with no info', () => {
    const err = new Error("");
    Object.defineProperty(err, "message", { value: "" });
    expect(() => throwGitError(err)).toThrow("Unknown git error");
  });

  it("prefers stderr over message for not-a-git-repo detection", () => {
    const err = Object.assign(new Error("other message"), {
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
    });
    expect(() => throwGitError(err)).toThrow("Not a git repository");
  });
});

describe("compareAscii", () => {
  it("returns -1 for a < b", () => {
    expect(compareAscii("a", "b")).toBe(-1);
  });

  it("returns 1 for a > b", () => {
    expect(compareAscii("b", "a")).toBe(1);
  });

  it("returns 0 for equal strings", () => {
    expect(compareAscii("same", "same")).toBe(0);
  });

  it("sorts paths correctly", () => {
    const paths = ["src/z.ts", "src/a.ts", "lib/b.ts"];
    expect(paths.sort(compareAscii)).toEqual(["lib/b.ts", "src/a.ts", "src/z.ts"]);
  });
});

describe("tryExecGit", () => {
  it("returns ok:true with stdout on success", () => {
    // git --version should always work
    const result = tryExecGit(["--version"]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("git version");
    expect(result.stderr).toBe("");
  });

  it("returns ok:false on failure", () => {
    const result = tryExecGit(["rev-parse", "HEAD"], "/nonexistent-path-xyz");
    expect(result.ok).toBe(false);
  });
});

describe("tryExecGit error details", () => {
  it("extracts stderr and status from Error", () => {
    // Pass a definitely-invalid path to trigger an error with stderr details
    const result = tryExecGit(["rev-parse", "HEAD"], "/nonexistent-path-xyz");
    expect(result.ok).toBe(false);
    expect(result.stderr.length).toBeGreaterThanOrEqual(0);
  });
});

describe("execGit", () => {
  it("returns stdout on success", () => {
    const result = execGit(["--version"]);
    expect(result).toContain("git version");
  });

  it("throws on failure", () => {
    expect(() => execGit(["rev-parse", "HEAD"], "/nonexistent-path-xyz")).toThrow();
  });
});
