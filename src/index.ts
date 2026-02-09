#!/usr/bin/env node
/**
 * Segmint MCP Server — stdio entrypoint.
 *
 * Creates the server via createServer() and connects it to a stdio transport.
 * All tool registrations live in server.ts.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Segmint MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
