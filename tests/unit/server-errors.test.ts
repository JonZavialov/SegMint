import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * Test server.ts error catch blocks that can't easily be triggered in E2E tests.
 *
 * Mocks the underlying modules to throw, exercising the try/catch error paths
 * in all tool handlers.
 */

// Mock modules to throw errors on demand
const mockLoadChanges = vi.fn();
const mockResolveChangeIds = vi.fn();
const mockEmbedAndCluster = vi.fn();
const mockGetRepoStatus = vi.fn();
const mockGetLog = vi.fn();
const mockGetCommit = vi.fn();
const mockGetDiffBetweenRefs = vi.fn();
const mockGetBlame = vi.fn();
const mockProposeCommits = vi.fn();
const mockApplyCommit = vi.fn();
const mockGeneratePr = vi.fn();

vi.mock("../../src/changes.js", () => ({
  loadChanges: (...args: unknown[]) => mockLoadChanges(...args),
  resolveChangeIds: (...args: unknown[]) => mockResolveChangeIds(...args),
  embedAndCluster: (...args: unknown[]) => mockEmbedAndCluster(...args),
}));

vi.mock("../../src/status.js", () => ({
  getRepoStatus: (...args: unknown[]) => mockGetRepoStatus(...args),
}));

vi.mock("../../src/history.js", () => ({
  getLog: (...args: unknown[]) => mockGetLog(...args),
}));

vi.mock("../../src/show.js", () => ({
  getCommit: (...args: unknown[]) => mockGetCommit(...args),
}));

vi.mock("../../src/diff.js", () => ({
  getDiffBetweenRefs: (...args: unknown[]) => mockGetDiffBetweenRefs(...args),
}));

vi.mock("../../src/blame.js", () => ({
  getBlame: (...args: unknown[]) => mockGetBlame(...args),
}));

vi.mock("../../src/propose.js", () => ({
  proposeCommits: (...args: unknown[]) => mockProposeCommits(...args),
}));

vi.mock("../../src/apply.js", () => ({
  applyCommit: (...args: unknown[]) => mockApplyCommit(...args),
}));

vi.mock("../../src/generate-pr.js", () => ({
  generatePr: (...args: unknown[]) => mockGeneratePr(...args),
}));

describe("server.ts error catch blocks", () => {
  let client: Client;

  beforeAll(async () => {
    const { createServer } = await import("../../src/server.js");
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-errors", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  // ---- list_changes ----

  it("list_changes catch block returns isError on throw", async () => {
    mockLoadChanges.mockImplementation(() => {
      throw new Error("git failed");
    });

    const result = await client.callTool({
      name: "list_changes",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("git failed");
  });

  it("list_changes catch with non-Error value", async () => {
    mockLoadChanges.mockImplementation(() => {
      throw "string error";
    });

    const result = await client.callTool({
      name: "list_changes",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("string error");
  });

  // ---- repo_status ----

  it("repo_status catch block returns isError on throw", async () => {
    mockGetRepoStatus.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    const result = await client.callTool({
      name: "repo_status",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("not a git repo");
  });

  it("repo_status catch with non-Error value", async () => {
    mockGetRepoStatus.mockImplementation(() => {
      throw 42;
    });

    const result = await client.callTool({
      name: "repo_status",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("42");
  });

  // ---- log ----

  it("log catch block returns isError on throw", async () => {
    mockGetLog.mockImplementation(() => {
      throw new Error("bad ref");
    });

    const result = await client.callTool({
      name: "log",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("bad ref");
  });

  it("log catch with non-Error value", async () => {
    mockGetLog.mockImplementation(() => {
      throw "log string error";
    });

    const result = await client.callTool({
      name: "log",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("log string error");
  });

  // ---- show_commit ----

  it("show_commit catch block returns isError on throw", async () => {
    mockGetCommit.mockImplementation(() => {
      throw new Error("unknown sha");
    });

    const result = await client.callTool({
      name: "show_commit",
      arguments: { sha: "abc" },
    });
    expect(result.isError).toBe(true);
  });

  it("show_commit catch with non-Error value", async () => {
    mockGetCommit.mockImplementation(() => {
      throw "show string error";
    });

    const result = await client.callTool({
      name: "show_commit",
      arguments: { sha: "abc" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("show string error");
  });

  // ---- diff_between_refs ----

  it("diff_between_refs catch block returns isError on throw", async () => {
    mockGetDiffBetweenRefs.mockImplementation(() => {
      throw new Error("bad ref");
    });

    const result = await client.callTool({
      name: "diff_between_refs",
      arguments: { base: "a", head: "b" },
    });
    expect(result.isError).toBe(true);
  });

  it("diff_between_refs catch with non-Error value", async () => {
    mockGetDiffBetweenRefs.mockImplementation(() => {
      throw "diff string error";
    });

    const result = await client.callTool({
      name: "diff_between_refs",
      arguments: { base: "a", head: "b" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("diff string error");
  });

  // ---- group_changes ----

  it("group_changes catch block on embedAndCluster failure", async () => {
    mockResolveChangeIds.mockReturnValue({
      changes: [
        { id: "change-1", file_path: "a.ts", hunks: [] },
        { id: "change-2", file_path: "b.ts", hunks: [] },
      ],
      unknown: [],
    });
    mockEmbedAndCluster.mockRejectedValue(new Error("OPENAI_API_KEY not set"));

    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: ["change-1", "change-2"] },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toBe("OPENAI_API_KEY not set");
  });

  it("group_changes catch with non-Error value", async () => {
    mockResolveChangeIds.mockReturnValue({
      changes: [
        { id: "change-1", file_path: "a.ts", hunks: [] },
        { id: "change-2", file_path: "b.ts", hunks: [] },
      ],
      unknown: [],
    });
    mockEmbedAndCluster.mockRejectedValue("group string error");

    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: ["change-1", "change-2"] },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("group string error");
  });

  it("group_changes single change returns one group via embedAndCluster", async () => {
    mockResolveChangeIds.mockReturnValue({
      changes: [{ id: "change-1", file_path: "a.ts", hunks: [] }],
      unknown: [],
    });
    mockEmbedAndCluster.mockResolvedValue([
      { id: "group-abc12345", change_ids: ["change-1"], summary: "Changes in a.ts" },
    ]);

    const result = await client.callTool({
      name: "group_changes",
      arguments: { change_ids: ["change-1"] },
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].change_ids).toEqual(["change-1"]);
    expect(parsed.groups[0].summary).toBe("Changes in a.ts");
  });

  // ---- blame ----

  it("blame catch block returns isError on throw", async () => {
    mockGetBlame.mockImplementation(() => {
      throw new Error("no such path");
    });

    const result = await client.callTool({
      name: "blame",
      arguments: { path: "missing.txt" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("no such path");
  });

  it("blame catch with non-Error value", async () => {
    mockGetBlame.mockImplementation(() => {
      throw "blame string error";
    });

    const result = await client.callTool({
      name: "blame",
      arguments: { path: "missing.txt" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("blame string error");
  });

  // ---- propose_commits ----

  it("propose_commits catch block returns isError on throw", async () => {
    mockProposeCommits.mockRejectedValue(new Error("Unknown group IDs: bad-id"));

    const result = await client.callTool({
      name: "propose_commits",
      arguments: { group_ids: ["bad-id"] },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("Unknown group IDs: bad-id");
  });

  it("propose_commits catch with non-Error value", async () => {
    mockProposeCommits.mockRejectedValue("propose string error");

    const result = await client.callTool({
      name: "propose_commits",
      arguments: { group_ids: ["x"] },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("propose string error");
  });

  // ---- apply_commit ----

  it("apply_commit catch block returns isError on throw", async () => {
    mockApplyCommit.mockRejectedValue(new Error("confirm must be true"));

    const result = await client.callTool({
      name: "apply_commit",
      arguments: { commit_id: "commit-abc", confirm: false },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("confirm must be true");
  });

  it("apply_commit catch with non-Error value", async () => {
    mockApplyCommit.mockRejectedValue("apply string error");

    const result = await client.callTool({
      name: "apply_commit",
      arguments: { commit_id: "commit-abc", confirm: true },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("apply string error");
  });

  // ---- generate_pr ----

  it("generate_pr catch block returns isError on throw", async () => {
    mockGeneratePr.mockImplementation(() => {
      throw new Error("At least one commit SHA is required");
    });

    const result = await client.callTool({
      name: "generate_pr",
      arguments: { commit_shas: [] },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("At least one commit SHA is required");
  });

  it("generate_pr catch with non-Error value", async () => {
    mockGeneratePr.mockImplementation(() => {
      throw "generate string error";
    });

    const result = await client.callTool({
      name: "generate_pr",
      arguments: { commit_shas: ["abc123"] },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("generate string error");
  });
});
