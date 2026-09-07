#!/usr/bin/env node

/**
 * stdio entry point: the npm package's bin.
 *
 * One process, one caller, so the API key comes from the environment. The
 * tools themselves live in server.ts and are shared with the HTTP transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

async function main() {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
