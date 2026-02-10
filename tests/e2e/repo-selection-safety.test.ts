import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

function createTempRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.com"]);

  writeFileSync(join(dir, "file-a.txt"), "one\n");
  writeFileSync(join(dir, "file-b.txt"), "two\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);

  writeFileSync(join(dir, "file-a.txt"), "one changed in second commit\n");
  git(["add", "file-a.txt"]);
  git(["commit", "-m", "second"]);

  writeFileSync(join(dir, "file-a.txt"), "one changed\n");
  writeFileSync(join(dir, "file-c.txt"), "new file\n");

  return dir;
}

function canonicalPath(value: string): string {
  const resolved = resolve(value);
  const real = realpathSync.native(resolved);
  const unixLike = real.replace(/\\/g, "/");
  return process.platform === "win32" ? unixLike.toLowerCase() : unixLike;
}

describe("repo selection safety", () => {
  let client: Client;
  let originalCwd: string;
  let nonGitDir: string;
  let repoDir: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    nonGitDir = mkdtempSync(join(tmpdir(), "segmint-non-git-"));
    for (let i = 0; i < 300; i++) {
      writeFileSync(join(nonGitDir, `noise-${String(i).padStart(3, "0")}.txt`), "noise\n");
    }

    repoDir = createTempRepo("segmint-safe-repo-");

    process.chdir(nonGitDir);
    process.env.SEGMINT_EMBEDDING_PROVIDER = "local";

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "repo-selection-test", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await client.close();
    rmSync(nonGitDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns SEGMINT_NO_REPO before set_repo_root", async () => {
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [
      { name: "repo_status", arguments: {} },
      { name: "list_changes", arguments: {} },
      { name: "log", arguments: {} },
      { name: "show_commit", arguments: { sha: "HEAD" } },
      { name: "diff_between_refs", arguments: { base: "HEAD~1", head: "HEAD" } },
      { name: "blame", arguments: { path: "file-a.txt" } },
      { name: "group_changes", arguments: { change_ids: ["change-1"] } },
      { name: "propose_commits", arguments: { group_ids: ["group-1"] } },
      { name: "apply_commit", arguments: { commit_id: "commit-1", confirm: true } },
      { name: "generate_pr", arguments: { commit_shas: ["deadbeef"] } },
    ];

    for (const call of toolCalls) {
      const result = await client.callTool(call);
      expect(result.isError).toBe(true);
      const sc = result.structuredContent as { code?: string } | undefined;
      expect(sc?.code).toBe("SEGMINT_NO_REPO");
    }

    const invalidSet = await client.callTool({
      name: "set_repo_root",
      arguments: { path: join(nonGitDir, "missing-dir") },
    });
    expect(invalidSet.isError).toBe(true);
  });

  it("operates against configured repo independent of process cwd", async () => {
    const setResult = await client.callTool({
      name: "set_repo_root",
      arguments: { path: join(repoDir, ".") },
    });
    expect(setResult.isError).toBeFalsy();

    const rootResult = await client.callTool({ name: "get_repo_root", arguments: {} });
    expect(
      canonicalPath((rootResult.structuredContent as { repo_root?: string }).repo_root ?? "")
    ).toBe(canonicalPath(repoDir));

    const repoStatus = await client.callTool({ name: "repo_status", arguments: {} });
    expect(repoStatus.isError).toBeFalsy();
    const repoStatusSc = repoStatus.structuredContent as { repo_root: string };
    expect(canonicalPath(repoStatusSc.repo_root)).toBe(canonicalPath(repoDir));

    const listChanges = await client.callTool({ name: "list_changes", arguments: {} });
    expect(listChanges.isError).toBeFalsy();

    const log = await client.callTool({ name: "log", arguments: { limit: 5 } });
    expect(log.isError).toBeFalsy();

    const show = await client.callTool({ name: "show_commit", arguments: { sha: "HEAD" } });
    expect(show.isError).toBeFalsy();

    const diff = await client.callTool({
      name: "diff_between_refs",
      arguments: { base: "HEAD~1", head: "HEAD" },
    });
    expect(diff.isError).toBeFalsy();

    const blame = await client.callTool({ name: "blame", arguments: { path: "file-a.txt" } });
    expect(blame.isError).toBeFalsy();

    const changes = (listChanges.structuredContent as { changes: Array<{ id: string }> }).changes;
    const group = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: changes.map((c) => c.id) },
    });
    expect(group.isError).toBeFalsy();
  });
});
