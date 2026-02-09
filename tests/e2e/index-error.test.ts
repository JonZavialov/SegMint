import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Test coverage for src/index.ts error path (the .catch() handler).
 *
 * We mock createServer to throw so main() rejects, triggering the
 * .catch() block that logs and exits.
 */

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockTransport {},
}));

vi.mock("../../src/server.js", () => ({
  createServer: vi.fn(() => {
    throw new Error("boom");
  }),
}));

describe("index.ts error path", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("logs error and exits on startup failure", async () => {
    await import("../../src/index.js");

    // Give the async .catch() time to fire
    await new Promise((r) => setTimeout(r, 200));

    expect(console.error).toHaveBeenCalledWith(
      "Fatal error in main():",
      expect.any(Error),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
