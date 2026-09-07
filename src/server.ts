/**
 * The tool surface, shared by both transports.
 *
 * stdio serves one person from one process, so an API key in the environment
 * is fine there. Over HTTP a single process serves many callers, each with
 * their own key, so the key travels in request-scoped storage instead and the
 * environment is only a fallback for the stdio case.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

// Overridable so the server can be pointed at a local API in tests or by
// anyone self-hosting the stack.
const API_BASE = process.env.TOOLTRACE_API_BASE ?? "https://api.tooltrace.io/v1";
const USER_AGENT = `tooltrace-mcp/${VERSION}`;

/** Holds the caller's API key for the duration of one request. */
export const apiKeyStore = new AsyncLocalStorage<string>();

export function runWithApiKey<T>(apiKey: string, fn: () => T): T {
  return apiKeyStore.run(apiKey, fn);
}

function getApiKey(): string {
  const scoped = apiKeyStore.getStore();
  if (scoped) return scoped;

  const fromEnv = process.env.TOOLTRACE_API_KEY;
  if (fromEnv) return fromEnv;

  throw new Error(
    "TOOLTRACE_API_KEY environment variable is required. " +
      "Get a free key at https://tooltrace.io/signup"
  );
}

async function callApi(
  endpoint: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ToolTrace-Key": getApiKey(),
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ToolTrace API ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Shared parameter schemas
const renderParam = z
  .enum(["never", "auto", "always"])
  .default("auto")
  .describe(
    "Rendering mode. 'never' = fast static fetch (1 credit). " +
      "'auto' = static first, browser if needed. " +
      "'always' = browser rendering (5 credits)."
  );

const waitUntilParam = z
  .enum(["domcontentloaded", "load", "networkidle"])
  .optional()
  .describe("Browser navigation milestone. Only used with browser rendering.");

const waitForSelectorParam = z
  .string()
  .max(200)
  .optional()
  .describe("CSS selector to wait for on rendered pages.");

// --- Tool metadata -----------------------------------------------------------

/** Every tool fetches and analyses a URL. None mutate anything, the same input
 *  yields the same result, and they reach arbitrary external sites. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// Response shapes generated from the live api.tooltrace.io OpenAPI document, so
// they cannot drift from what the API actually returns. Every field is optional:
// `include` alone means most of an extract response is absent on any given call,
// and a schema stricter than reality fails validation and breaks the tool it was
// meant to describe.
const EXTRACT_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().optional(),
  markdown: z.string().optional(),
  text: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  links: z.array(z.record(z.string(), z.unknown())).optional(),
  schema: z.array(z.unknown()).optional(),
  sections: z.array(z.record(z.string(), z.unknown())).optional(),
  raw_html: z.string().optional(),
  word_count: z.number().int().optional(),
  content_hash: z.string().optional(),
};

const METADATA_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

const LINKS_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().optional(),
  count: z.number().int().optional(),
  links: z.array(z.record(z.string(), z.unknown())).optional(),
};

const SCHEMA_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  mode: z.string().optional(),
  count: z.number().int().optional(),
  schema: z.array(z.unknown()).optional(),
};

const SEO_AUDIT_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  score: z.number().int().optional(),
  checks: z.array(z.record(z.string(), z.unknown())).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};

const TECH_STACK_OUTPUT = {
  fetch: z.record(z.string(), z.unknown()).optional(),
  url: z.string().optional(),
  domain: z.string().optional(),
  technologies_detected: z.number().int().optional(),
  categories: z.record(z.string(), z.unknown()).optional(),
};

const SITEMAP_OUTPUT = {
  requested_url: z.string().optional(),
  discovery_method: z.string().optional(),
  documents: z.array(z.record(z.string(), z.unknown())).optional(),
  discovered_urls: z.number().int().optional(),
  inspected_urls: z.number().int().optional(),
  inspection_complete: z.boolean().optional(),
  limit_reason: z.string().optional(),
  summary: z.record(z.string(), z.unknown()).optional(),
  findings: z.array(z.record(z.string(), z.unknown())).optional(),
  urls_included: z.boolean().optional(),
  urls: z.array(z.record(z.string(), z.unknown())).optional(),
};


/** A fresh server instance. HTTP builds one per request; stdio builds one. */
export function createServer(): McpServer {
const server = new McpServer({
    name: "tooltrace",
    version: VERSION,
  });

// --- Extract ---
server.registerTool(
  "tooltrace_extract",
  {
    title: "Extract webpage content",
    description: "Extract clean content from a webpage. Returns Markdown, plain text, metadata, links, JSON-LD schema, and content sections. Use this for scraping, RAG ingestion, or content analysis.",
    annotations: READ_ONLY,
    outputSchema: EXTRACT_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL to extract"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    mode: z
      .enum(["structured", "raw", "both"])
      .default("structured")
      .describe("'structured' for parsed data, 'raw' for HTML, 'both' for everything."),
    include: z
      .array(
        z.enum(["markdown", "text", "metadata", "links", "schema", "sections"])
      )
      .default(["markdown", "metadata", "sections"])
      .describe("Which fields to include in the response."),
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;
    if (params.include) body.include = params.include;

    const result = await callApi("/extract", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- Metadata ---
server.registerTool(
  "tooltrace_metadata",
  {
    title: "Read page metadata",
    description: "Extract page metadata: title, description, canonical URL, author, publication date, favicon, Open Graph, and Twitter card fields. Lightweight alternative to full extraction.",
    annotations: READ_ONLY,
    outputSchema: METADATA_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/metadata", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- Links ---
server.registerTool(
  "tooltrace_links",
  {
    title: "Extract page links",
    description: "Extract all links from a webpage with anchor text, internal/external classification, and normalized URLs.",
    annotations: READ_ONLY,
    outputSchema: LINKS_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    mode: z
      .enum(["normalized", "raw"])
      .default("normalized")
      .describe("'normalized' deduplicates and cleans URLs. 'raw' preserves originals."),
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;

    const result = await callApi("/links", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- Schema ---
server.registerTool(
  "tooltrace_schema",
  {
    title: "Extract JSON-LD structured data",
    description: "Extract JSON-LD structured data from a webpage. Returns schema.org entities like Article, Product, Organization, FAQ, BreadcrumbList, etc.",
    annotations: READ_ONLY,
    outputSchema: SCHEMA_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    mode: z
      .enum(["normalized", "raw"])
      .default("normalized")
      .describe("'normalized' deduplicates entities. 'raw' preserves original JSON-LD blocks."),
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;

    const result = await callApi("/schema", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- SEO Audit ---
server.registerTool(
  "tooltrace_seo_audit",
  {
    title: "Audit on-page SEO",
    description: "Run an SEO audit on a webpage. Returns a score (0-100), weighted checks for metadata, headings, images, canonical signals, robots directives, social tags, schema, and content length, with evidence and recommendations.",
    annotations: READ_ONLY,
    outputSchema: SEO_AUDIT_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL to audit"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/seo-audit", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- Tech Stack ---
server.registerTool(
  "tooltrace_tech_stack",
  {
    title: "Detect the tech stack behind a site",
    description: "Detect the technology stack of a website: CMS, frameworks, JavaScript libraries, analytics, CDN, hosting, fonts, security tools, and more. Returns categorized detections with confidence levels.",
    annotations: READ_ONLY,
    outputSchema: TECH_STACK_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Public webpage URL to analyze"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/tech-stack", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

// --- Sitemap Inspector ---
server.registerTool(
  "tooltrace_sitemap",
  {
    title: "Check an XML sitemap",
    description: "Inspect a website's sitemap. Discovers sitemap URLs, parses sitemap XML, and returns listed page URLs with last-modified dates and change frequencies.",
    annotations: READ_ONLY,
    outputSchema: SITEMAP_OUTPUT,
    inputSchema: {
    url: z.string().url().describe("Website URL or direct sitemap URL"),
    render: renderParam,
    },
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;

    const result = await callApi("/sitemap-inspector", body);
    return {
      content: [{ type: "text" as const, text: formatJson(result) }],
      structuredContent: result as Record<string, unknown>,
    };
  }
);

  return server;
}
