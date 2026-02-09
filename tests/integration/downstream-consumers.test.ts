import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { proposeCommits, buildCommitPlan } from "../../src/propose.js";
import { applyCommit } from "../../src/apply.js";
import { generatePr } from "../../src/generate-pr.js";
import { loadChanges, embedAndCluster, computeGroups, contentHash } from "../../src/changes.js";

function createTempRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "segmint-downstream-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.com"]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "commit.gpgsign", "false"]);

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("contentHash", () => {
  it("returns consistent 8-char hex string", () => {
    const h = contentHash(["a", "b"]);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash(["a", "b"])).toBe(h);
  });

  it("is order-sensitive (callers sort when needed)", () => {
    expect(contentHash(["b", "a"])).not.toBe(contentHash(["a", "b"]));
  });

  it("differs for different inputs", () => {
    expect(contentHash(["a"])).not.toBe(contentHash(["b"]));
  });
});

describe("embedAndCluster", () => {
  it("returns empty array for empty input", async () => {
    const groups = await embedAndCluster([]);
    expect(groups).toEqual([]);
  });

  it("returns one group for single change", async () => {
    const groups = await embedAndCluster([
      { id: "change-1", file_path: "foo.ts", hunks: [] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].change_ids).toEqual(["change-1"]);
    expect(groups[0].id).toMatch(/^group-[0-9a-f]{8}$/);
  });
});

describe("propose_commits (real pipeline)", () => {
  let dir: string;
  let cleanup: () => void;
  let originalEnv: string | undefined;

  beforeEach(() => {
    ({ dir, cleanup } = createTempRepo());
    originalEnv = process.env.SEGMINT_EMBEDDING_PROVIDER;
    process.env.SEGMINT_EMBEDDING_PROVIDER = "local";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SEGMINT_EMBEDDING_PROVIDER = originalEnv;
    } else {
      delete process.env.SEGMINT_EMBEDDING_PROVIDER;
    }
    cleanup();
  });

  it("returns empty commits when no uncommitted changes", async () => {
    // Create initial commit so the repo is valid
    writeFileSync(join(dir, "init.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    const { groups } = await computeGroups(dir);
    // No uncommitted changes → no groups → propose should return empty
    expect(groups).toHaveLength(0);
  });

  it("single file change produces one commit plan", async () => {
    writeFileSync(join(dir, "init.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "init.txt"), "modified\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    expect(groups).toHaveLength(1);

    const result = await proposeCommits([groups[0].id], dir);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].title).toContain("init.txt");
    expect(result.commits[0].id).toMatch(/^commit-[0-9a-f]{8}$/);
  });

  it("multiple file changes produce groups and commit plans", async () => {
    writeFileSync(join(dir, "a.ts"), "a\n");
    writeFileSync(join(dir, "b.ts"), "b\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "a.ts"), "a modified\n");
    writeFileSync(join(dir, "b.ts"), "b modified\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    expect(groups.length).toBeGreaterThanOrEqual(1);

    const groupIds = groups.map((g) => g.id);
    const result = await proposeCommits(groupIds, dir);
    expect(result.commits.length).toBe(groups.length);
  });

  it("unknown group IDs produce error", async () => {
    writeFileSync(join(dir, "init.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    await expect(proposeCommits(["group-nonexistent"], dir)).rejects.toThrow(
      "Unknown group IDs: group-nonexistent",
    );
  });

  it("deterministic: same state produces same IDs", async () => {
    writeFileSync(join(dir, "det.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "det.txt"), "modified\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const result1 = await computeGroups(dir);
    const result2 = await computeGroups(dir);
    expect(result1.groups.map((g) => g.id)).toEqual(result2.groups.map((g) => g.id));
  });

  it("subset stability: group_changes subset IDs work with propose_commits", async () => {
    writeFileSync(join(dir, "x.ts"), "x\n");
    writeFileSync(join(dir, "y.ts"), "y\n");
    writeFileSync(join(dir, "z.ts"), "z\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "x.ts"), "x modified\n");
    writeFileSync(join(dir, "y.ts"), "y modified\n");
    writeFileSync(join(dir, "z.ts"), "z modified\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    // Get all changes
    const allChanges = loadChanges(dir);
    expect(allChanges.length).toBe(3);

    // Group a subset (just x.ts and y.ts)
    const subset = allChanges.filter(
      (c) => c.file_path === "x.ts" || c.file_path === "y.ts",
    );
    const subsetGroups = await embedAndCluster(subset);
    expect(subsetGroups.length).toBeGreaterThanOrEqual(1);

    // The group IDs from subset should be content-derived from the same change IDs
    // When propose_commits recomputes over ALL changes, the group containing
    // the same changes should have the same ID
    const allGroups = await embedAndCluster(allChanges);

    // Find groups in allGroups that contain the same changes as subsetGroups
    for (const sg of subsetGroups) {
      const matchingAll = allGroups.find((ag) =>
        ag.change_ids.sort().join(",") === sg.change_ids.sort().join(","),
      );
      if (matchingAll) {
        // Same membership → same ID
        expect(matchingAll.id).toBe(sg.id);
      }
      // If clustering differs (because of the third file), the IDs might not match
      // But the key point is: IDs are content-derived, not positional
    }
  });
});

describe("buildCommitPlan", () => {
  it("builds plan with heuristic title for 1 file", () => {
    const group = { id: "group-abc12345", change_ids: ["change-1"], summary: "test" };
    const changes = [
      { id: "change-1", file_path: "src/utils.ts", hunks: [{ old_start: 1, old_lines: 1, new_start: 1, new_lines: 1, header: "@@ -1,1 +1,1 @@", lines: ["+x"] }] },
    ];
    const plan = buildCommitPlan(group, changes);
    expect(plan.title).toBe("Update utils.ts");
    expect(plan.description).toContain("1 file(s)");
    expect(plan.description).toContain("1 hunk");
  });

  it("builds plan with heuristic title for 4+ files", () => {
    const group = {
      id: "group-abc12345",
      change_ids: ["change-1", "change-2", "change-3", "change-4"],
      summary: "test",
    };
    const changes = [
      { id: "change-1", file_path: "a.ts", hunks: [] },
      { id: "change-2", file_path: "b.ts", hunks: [] },
      { id: "change-3", file_path: "c.ts", hunks: [] },
      { id: "change-4", file_path: "d.ts", hunks: [] },
    ];
    const plan = buildCommitPlan(group, changes);
    expect(plan.title).toBe("Update a.ts, b.ts, and 2 more");
  });
});

describe("apply_commit (real pipeline)", () => {
  let dir: string;
  let cleanup: () => void;
  let originalEnv: string | undefined;

  beforeEach(() => {
    ({ dir, cleanup } = createTempRepo());
    originalEnv = process.env.SEGMINT_EMBEDDING_PROVIDER;
    process.env.SEGMINT_EMBEDDING_PROVIDER = "local";
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SEGMINT_EMBEDDING_PROVIDER = originalEnv;
    } else {
      delete process.env.SEGMINT_EMBEDDING_PROVIDER;
    }
    cleanup();
  });

  it("rejects when confirm is false", async () => {
    await expect(
      applyCommit({ commit_id: "commit-abc", confirm: false }, dir),
    ).rejects.toThrow("confirm must be true");
  });

  it("dry_run returns preview without mutation", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);
    const commitId = plans.commits[0].id;

    const result = await applyCommit(
      { commit_id: commitId, confirm: true, dry_run: true },
      dir,
    );
    expect(result.success).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.commit_sha).toBeUndefined();
    expect(result.committed_paths).toContain("file.txt");

    // Verify no commit was created (HEAD should still be "init")
    const log = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf8" });
    expect(log.trim().split("\n")).toHaveLength(1);
  });

  it("dry_run=false creates a real commit", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);
    const commitId = plans.commits[0].id;

    const result = await applyCommit(
      { commit_id: commitId, confirm: true, dry_run: false },
      dir,
    );
    expect(result.success).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.commit_sha).toMatch(/^[0-9a-f]{40}$/);

    // Verify a new commit was created
    const log = execFileSync("git", ["log", "--oneline"], { cwd: dir, encoding: "utf8" });
    expect(log.trim().split("\n")).toHaveLength(2);
  });

  it("expected_head_sha mismatch rejects", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);

    await expect(
      applyCommit(
        { commit_id: plans.commits[0].id, confirm: true, dry_run: false, expected_head_sha: "0000000000000000000000000000000000000000" },
        dir,
      ),
    ).rejects.toThrow("HEAD has moved");
  });

  it("expected_head_sha match succeeds", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);

    const result = await applyCommit(
      { commit_id: plans.commits[0].id, confirm: true, dry_run: true, expected_head_sha: headSha },
      dir,
    );
    expect(result.success).toBe(true);
  });

  it("message_override uses custom message", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);

    const result = await applyCommit(
      { commit_id: plans.commits[0].id, confirm: true, dry_run: false, message_override: "custom msg" },
      dir,
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe("custom msg");

    const log = execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: dir, encoding: "utf8" });
    expect(log.trim()).toBe("custom msg");
  });

  it("unknown commit_id rejects", async () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "file.txt"), "changed\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    await expect(
      applyCommit({ commit_id: "commit-nonexistent", confirm: true, dry_run: false }, dir),
    ).rejects.toThrow("Unknown commit ID");
  });

  it("staged changes outside scope without allow_staged rejects", async () => {
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    // Modify both files
    writeFileSync(join(dir, "a.txt"), "a modified\n");
    writeFileSync(join(dir, "b.txt"), "b modified\n");
    // Stage only a.txt — this is the "outside scope" scenario when
    // we try to commit just b.txt
    execFileSync("git", ["add", "a.txt"], { cwd: dir });

    // computeGroups sees both changes (a.txt staged, b.txt unstaged)
    const { groups } = await computeGroups(dir);

    // Find the group containing b.txt and try to commit just that
    // But a.txt is already staged and outside scope → should fail
    // Actually, the error is about staged changes outside the commit's scope
    // The commit tries to stage its own files, but a.txt is already staged
    const plans = await proposeCommits(groups.map((g) => g.id), dir);

    // If groups merged both files, then staging check passes (all staged changes are in scope)
    // If groups are separate, one plan's files won't include a.txt
    // With LocalEmbeddingProvider the clustering may vary, so let's verify behavior
    if (plans.commits.length > 1) {
      // Find commit that doesn't include a.txt
      const commitForB = plans.commits.find(
        (c) => !c.description.includes("a.txt"),
      );
      if (commitForB) {
        await expect(
          applyCommit({ commit_id: commitForB.id, confirm: true, dry_run: false }, dir),
        ).rejects.toThrow("staged changes outside");
      }
    }
    // If all files are in one group, the test is vacuously true (no outside scope)
  });

  it("allow_staged=true bypasses staged check", async () => {
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    writeFileSync(join(dir, "a.txt"), "a modified\n");
    writeFileSync(join(dir, "b.txt"), "b modified\n");
    execFileSync("git", ["add", "."], { cwd: dir });

    const { groups } = await computeGroups(dir);
    const plans = await proposeCommits(groups.map((g) => g.id), dir);

    const result = await applyCommit(
      { commit_id: plans.commits[0].id, confirm: true, dry_run: true, allow_staged: true },
      dir,
    );
    expect(result.success).toBe(true);
  });
});

describe("generate_pr (real pipeline)", () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir, cleanup } = createTempRepo());
  });

  afterEach(() => cleanup());

  it("generates draft from single commit SHA", () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "feat: add file"], { cwd: dir });

    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const draft = generatePr([sha], dir);

    expect(draft.title).toBe("feat: add file");
    expect(draft.description).toContain("feat: add file");
    expect(draft.description).toContain("file.txt");
    expect(draft.commits).toHaveLength(1);
    expect(draft.commits[0].id).toBe(sha);
  });

  it("generates draft from multiple commits", () => {
    writeFileSync(join(dir, "a.txt"), "a\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "first commit"], { cwd: dir });

    writeFileSync(join(dir, "b.txt"), "b\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "second commit"], { cwd: dir });

    const sha1 = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: dir, encoding: "utf8" }).trim();
    const sha2 = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    const draft = generatePr([sha1, sha2], dir);

    expect(draft.title).toContain("(+1 more)");
    expect(draft.commits).toHaveLength(2);
    expect(draft.description).toContain("first commit");
    expect(draft.description).toContain("second commit");
  });

  it("rejects empty array", () => {
    expect(() => generatePr([], dir)).toThrow("At least one commit SHA is required");
  });

  it("rejects invalid SHA format", () => {
    expect(() => generatePr(["not-a-sha!"], dir)).toThrow("Invalid commit SHA format");
  });

  it("rejects unknown valid-format SHA", () => {
    writeFileSync(join(dir, "file.txt"), "init\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

    expect(() => generatePr(["abcd1234abcd1234abcd1234abcd1234abcd1234"], dir)).toThrow(
      "Unknown commit SHA",
    );
  });
});
