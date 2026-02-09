import { describe, it, expect, vi } from "vitest";

/**
 * Test the non-Error catch branch in tryExecGit (line 62 of exec-git.ts).
 *
 * This requires mocking child_process.execFileSync at the module level
 * since ESM exports are not configurable at runtime.
 */

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    throw "string-thrown-value";
  }),
}));

describe("tryExecGit with non-Error throw", () => {
  it("returns stderr as String(err) when catch receives non-Error", async () => {
    const { tryExecGit } = await import("../../src/exec-git.js");
    const result = tryExecGit(["--version"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("string-thrown-value");
  });
});
