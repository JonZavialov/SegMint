import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

function createTempRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "segmint-e2e-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });

  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@test.com"]);
  git(["config", "core.autocrlf", "false"]);
  git(["config", "commit.gpgsign", "false"]);

  writeFileSync(join(dir, "file.txt"), "initial content\n");
  git(["add", "."]);
  git(["commit", "-m", "initial commit"]);

  writeFileSync(join(dir, "file.txt"), "modified content\n");
  git(["add", "."]);
  git(["commit", "-m", "second commit"]);

  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("MCP server E2E (in-process)", () => {
  let client: Client;
  let dir: string;
  let cleanup: () => void;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    ({ dir, cleanup } = createTempRepo());
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    process.chdir(dir);
    process.env.SEGMINT_EMBEDDING_PROVIDER = "local";

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    await client.close();
    cleanup();
  });

  it("lists all tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "apply_commit",
      "diff_between_refs",
      "generate_pr",
      "group_changes",
      "list_changes",
      "log",
      "propose_commits",
      "repo_status",
      "show_commit",
    ]);
  });

  it("doc-contract: tool names match CLAUDE.md tool table", async () => {
    // Read CLAUDE.md and extract tool names from the MCP Tool Contracts table
    const claudeMd = readFileSync(
      join(__dirname, "..", "..", "CLAUDE.md"),
      "utf8"
    );
    // Extract the MCP Tool Contracts section
    const toolSection = claudeMd.split("## MCP Tool Contracts")[1]?.split("\n##")[0] ?? "";
    // Match lines starting with "| `tool_name` |" — first column only (anchored to line start)
    const toolMatches = toolSection.matchAll(/^\| `(\w+)` \|/gm);
    const docToolNames = [...toolMatches].map((m) => m[1]).sort();
    expect(docToolNames.length).toBeGreaterThan(0);

    // Compare against actual server tool list
    const result = await client.listTools();
    const serverToolNames = result.tools.map((t) => t.name).sort();
    expect(docToolNames).toEqual(serverToolNames);
  });

  it("repo_status returns structured data", async () => {
    const result = await client.callTool({
      name: "repo_status",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.is_git_repo).toBe(true);
    expect(sc.head).toBeDefined();
  });

  it("list_changes returns structured data", async () => {
    // Add unstaged change
    writeFileSync(join(dir, "file.txt"), "e2e modified\n");
    const result = await client.callTool({
      name: "list_changes",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();
    // Restore for other tests
    writeFileSync(join(dir, "file.txt"), "modified content\n");
  });

  it("log returns commits", async () => {
    const result = await client.callTool({
      name: "log",
      arguments: { limit: 5 },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { commits: unknown[] };
    expect(sc.commits.length).toBeGreaterThanOrEqual(1);
  });

  it("show_commit returns commit details", async () => {
    const result = await client.callTool({
      name: "show_commit",
      arguments: { sha: "HEAD" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { commit: Record<string, unknown> };
    expect(sc.commit.sha).toBeTruthy();
    expect(sc.commit.subject).toBeTruthy();
  });

  it("diff_between_refs returns changes", async () => {
    const result = await client.callTool({
      name: "diff_between_refs",
      arguments: { base: "HEAD~1", head: "HEAD" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { changes: unknown[] };
    expect(sc.changes.length).toBeGreaterThanOrEqual(1);
  });

  it("group_changes with unknown IDs returns error", async () => {
    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: ["nonexistent-id"] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("Unknown change IDs");
  });

  it("group_changes with single valid change (skip-embeddings path)", async () => {
    // Create a staged change so list_changes returns at least one change
    writeFileSync(join(dir, "gc-single.txt"), "single change content\n");
    execFileSync("git", ["add", "gc-single.txt"], { cwd: dir });

    // Get the change IDs
    const listResult = await client.callTool({
      name: "list_changes",
      arguments: {},
    });
    const sc = listResult.structuredContent as { changes: Array<{ id: string }> };
    expect(sc.changes.length).toBeGreaterThanOrEqual(1);

    // Group with just one change — exercises the single-change shortcut path
    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: [sc.changes[0].id] },
    });
    expect(result.isError).toBeFalsy();
    const groups = (result.structuredContent as { groups: unknown[] }).groups;
    expect(groups).toHaveLength(1);

    // Cleanup
    execFileSync("git", ["reset", "HEAD", "gc-single.txt"], { cwd: dir });
    execFileSync("git", ["checkout", "--", "."], { cwd: dir }).toString();
    // Remove the file if it still exists
    try { rmSync(join(dir, "gc-single.txt")); } catch { /* ignore */ }
  });

  it("group_changes with multiple valid changes (embedding+clustering path)", async () => {
    // Create multiple staged changes
    writeFileSync(join(dir, "gc-a.txt"), "change a content\n");
    writeFileSync(join(dir, "gc-b.txt"), "change b content\n");
    execFileSync("git", ["add", "gc-a.txt", "gc-b.txt"], { cwd: dir });

    // Get the change IDs
    const listResult = await client.callTool({
      name: "list_changes",
      arguments: {},
    });
    const sc = listResult.structuredContent as { changes: Array<{ id: string }> };
    expect(sc.changes.length).toBeGreaterThanOrEqual(2);

    // Group with multiple changes — exercises embedding + clustering path
    const changeIds = sc.changes.map((c) => c.id);
    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: changeIds },
    });
    expect(result.isError).toBeFalsy();
    const groups = (result.structuredContent as { groups: Array<{ id: string; change_ids: string[] }> }).groups;
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // All input change IDs should appear in some group
    const allGroupedIds = groups.flatMap((g) => g.change_ids).sort();
    expect(allGroupedIds).toEqual(changeIds.sort());

    // Cleanup
    execFileSync("git", ["reset", "HEAD", "gc-a.txt", "gc-b.txt"], { cwd: dir });
    try { rmSync(join(dir, "gc-a.txt")); } catch { /* ignore */ }
    try { rmSync(join(dir, "gc-b.txt")); } catch { /* ignore */ }
  });

  it("propose_commits with valid mock IDs", async () => {
    const result = await client.callTool({
      name: "propose_commits",
      arguments: { group_ids: ["group-1", "group-2"] },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { commits: unknown[] };
    expect(sc.commits.length).toBeGreaterThanOrEqual(1);
  });

  it("propose_commits with unknown IDs returns error", async () => {
    const result = await client.callTool({
      name: "propose_commits",
      arguments: { group_ids: ["bad-group"] },
    });
    expect(result.isError).toBe(true);
  });

  it("apply_commit with valid mock ID", async () => {
    const result = await client.callTool({
      name: "apply_commit",
      arguments: { commit_id: "commit-1" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { success: boolean };
    expect(sc.success).toBe(true);
  });

  it("apply_commit with unknown ID returns error", async () => {
    const result = await client.callTool({
      name: "apply_commit",
      arguments: { commit_id: "bad-commit" },
    });
    expect(result.isError).toBe(true);
  });

  it("generate_pr with valid mock IDs", async () => {
    const result = await client.callTool({
      name: "generate_pr",
      arguments: { commit_ids: ["commit-1", "commit-2"] },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { title: string; description: string };
    expect(sc.title).toBeTruthy();
    expect(sc.description).toBeTruthy();
  });

  it("diff_between_refs with invalid refs returns error", async () => {
    const result = await client.callTool({
      name: "diff_between_refs",
      arguments: { base: "nonexistent-ref-xyz", head: "HEAD" },
    });
    expect(result.isError).toBe(true);
  });

  it("show_commit with invalid sha returns error", async () => {
    const result = await client.callTool({
      name: "show_commit",
      arguments: { sha: "0000000000000000000000000000000000000000" },
    });
    expect(result.isError).toBe(true);
  });

  it("log with invalid ref returns error", async () => {
    const result = await client.callTool({
      name: "log",
      arguments: { ref: "nonexistent-ref-xyz" },
    });
    expect(result.isError).toBe(true);
  });

  it("generate_pr with unknown IDs returns error", async () => {
    const result = await client.callTool({
      name: "generate_pr",
      arguments: { commit_ids: ["bad-commit"] },
    });
    expect(result.isError).toBe(true);
  });
});
