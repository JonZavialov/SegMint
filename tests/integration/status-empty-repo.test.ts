import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { getRepoStatus } from "../../src/status.js";

describe("getRepoStatus with no commits", () => {
  it("returns branch head with undefined name/sha for fresh repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "segmint-empty-status-"));
    try {
      execFileSync("git", ["init"], { cwd: dir, encoding: "utf8" });
      const status = getRepoStatus(dir);
      expect(status.is_git_repo).toBe(true);
      expect(status.head.type).toBe("branch");
      expect(status.head.name).toBeTruthy();
      expect(status.head.sha).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
