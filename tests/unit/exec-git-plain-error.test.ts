import { describe, it, expect, vi } from "vitest";

/**
 * Test tryExecGit when the caught Error lacks stderr/status properties.
 * This exercises the false branches of "stderr" in err and "status" in err.
 */

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => {
    // Throw a plain Error without stderr or status
    throw new Error("plain error without stderr");
  }),
}));

describe("tryExecGit with plain Error (no stderr/status)", () => {
  it("returns empty stderr and undefined code", async () => {
    const { tryExecGit } = await import("../../src/exec-git.js");
    const result = tryExecGit(["--version"]);
    expect(result.ok).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.code).toBeUndefined();
  });
});
