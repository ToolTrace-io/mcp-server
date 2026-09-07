/**
 * Streamable HTTP entry point: the remote MCP server.
 *
 * Runs stateless. Every request builds its own server and transport and
 * discards them afterwards, because none of the ToolTrace tools carry state
 * between calls. That removes session bookkeeping entirely and means any
 * number of processes can serve the same endpoint.
 *
 * Each caller presents their own ToolTrace API key as a bearer token, so usage
 * meters against that account exactly as a direct API call would. There is no
 * shared service key and therefore no shared quota.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer, runWithApiKey } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);
const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 1_000_000;

/** Permissive CORS is safe here: authentication is a bearer token, never a
 *  cookie, so a hostile page cannot borrow a visitor's credentials. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-tooltrace-key, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

/** A JSON-RPC shaped error, which is what an MCP client knows how to read. */
function sendRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * The caller's ToolTrace key, from either accepted header.
 *
 * Authorization: Bearer is the documented path and what a client configured by
 * hand will send. X-ToolTrace-Key is the header the REST API already uses, and
 * is what a gateway maps a plain key onto without making the user type a
 * "Bearer " prefix themselves.
 *
 * Deliberately not read from the query string. A key in a URL ends up in proxy
 * access logs, browser history and referrers, and the MCP specification says
 * tokens must not travel there.
 */
function callerApiKey(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }

  const direct = req.headers["x-tooltrace-key"];
  const value = Array.isArray(direct) ? direct[0] : direct;
  if (value && value.trim()) return value.trim();

  return null;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const apiKey = callerApiKey(req);
  if (!apiKey) {
    // Deliberately no WWW-Authenticate header. In the MCP authorization spec
    // that header means "this server uses OAuth, go discover its authorization
    // server", and a client that sees it starts a sign-in flow, probes
    // /.well-known/oauth-* , gets 404s, and hangs waiting for an OAuth round
    // trip that will never happen. Authentication here is a static API key
    // supplied through client config, so a plain 401 is the honest answer.
    sendRpcError(
      res,
      401,
      -32001,
      "Missing API key. Send it as 'Authorization: Bearer <your ToolTrace key>' " +
        "or 'X-ToolTrace-Key: <your ToolTrace key>'. " +
        "Get a free key at https://tooltrace.io/signup"
    );
    return;
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err) {
    sendRpcError(res, 400, -32700, `Could not parse request: ${(err as Error).message}`);
    return;
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    // Stateless: no session ids to issue, track or expire.
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  for (const [header, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(header, value);
  }

  try {
    await server.connect(transport);
    // The key lives in async-local storage for exactly this request, so tool
    // handlers read the caller's own credential rather than a process-wide one.
    await runWithApiKey(apiKey, () => transport.handleRequest(req, res, body));
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      sendRpcError(res, 500, -32603, "Internal server error");
    }
  }
}

const httpServer = createHttpServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (path === "/health" || path === "/") {
    sendJson(res, 200, { status: "ok", transport: "streamable-http" });
    return;
  }

  if (path !== MCP_PATH) {
    sendJson(res, 404, { error: "not_found", message: `Use POST ${MCP_PATH}` });
    return;
  }

  if (req.method !== "POST") {
    // Stateless operation has no stream to resume, so there is nothing for GET
    // or DELETE to act on.
    sendRpcError(res, 405, -32000, `Use POST ${MCP_PATH}`, { Allow: "POST, OPTIONS" });
    return;
  }

  void handleMcp(req, res);
});

httpServer.listen(PORT, () => {
  console.log(`ToolTrace MCP server listening on :${PORT}${MCP_PATH}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
