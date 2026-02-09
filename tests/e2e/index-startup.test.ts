import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test coverage for src/index.ts startup path.
 *
 * We mock StdioServerTransport and createServer to verify the wiring
 * without actually starting a stdio transport.
 */

const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockTransport {},
}));

vi.mock("../../src/server.js", () => ({
  createServer: vi.fn(() => ({
    connect: mockConnect,
  })),
}));

describe("index.ts startup", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("calls createServer and connects transport", async () => {
    // Dynamic import triggers the module's main() call
    await import("../../src/index.js");

    // Give the async main() time to complete
    await new Promise((r) => setTimeout(r, 200));

    const { createServer } = await import("../../src/server.js");
    expect(createServer).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalled();
  });
});
