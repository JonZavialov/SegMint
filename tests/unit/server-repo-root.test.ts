import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const mockResolveGitRoot = vi.fn();

vi.mock("../../src/exec-git.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/exec-git.js")>("../../src/exec-git.js");
  return {
    ...actual,
    resolveGitRoot: (...args: unknown[]) => mockResolveGitRoot(...args),
    tryResolveGitRoot: () => undefined,
  };
});

describe("server repo-root tools", () => {
  let client: Client;

  beforeAll(async () => {
    const { createServer } = await import("../../src/server.js");
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-repo-root", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("get_repo_root returns undefined when unset", async () => {
    const result = await client.callTool({ name: "get_repo_root", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { repo_root?: string }).repo_root).toBeUndefined();
  });

  it("set_repo_root catch block handles non-Error throw", async () => {
    mockResolveGitRoot.mockImplementation(() => {
      throw "bad path";
    });

    const result = await client.callTool({
      name: "set_repo_root",
      arguments: { path: "/tmp/does-not-matter" },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toBe("bad path");
  });
});
