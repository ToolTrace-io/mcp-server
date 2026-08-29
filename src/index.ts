#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://api.tooltrace.io/v1";
const USER_AGENT = "tooltrace-mcp/0.1.0";

function getApiKey(): string {
  const key = process.env.TOOLTRACE_API_KEY;
  if (!key) {
    throw new Error(
      "TOOLTRACE_API_KEY environment variable is required. " +
        "Get a free key at https://tooltrace.io/signup"
    );
  }
  return key;
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

const server = new McpServer({
  name: "tooltrace",
  version: "0.1.0",
});

// --- Extract ---
server.tool(
  "tooltrace_extract",
  "Extract clean content from a webpage. Returns Markdown, plain text, metadata, links, JSON-LD schema, and content sections. Use this for scraping, RAG ingestion, or content analysis.",
  {
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
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;
    if (params.include) body.include = params.include;

    const result = await callApi("/extract", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Metadata ---
server.tool(
  "tooltrace_metadata",
  "Extract page metadata: title, description, canonical URL, author, publication date, favicon, Open Graph, and Twitter card fields. Lightweight alternative to full extraction.",
  {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/metadata", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Links ---
server.tool(
  "tooltrace_links",
  "Extract all links from a webpage with anchor text, internal/external classification, and normalized URLs.",
  {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    mode: z
      .enum(["normalized", "raw"])
      .default("normalized")
      .describe("'normalized' deduplicates and cleans URLs. 'raw' preserves originals."),
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;

    const result = await callApi("/links", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Schema ---
server.tool(
  "tooltrace_schema",
  "Extract JSON-LD structured data from a webpage. Returns schema.org entities like Article, Product, Organization, FAQ, BreadcrumbList, etc.",
  {
    url: z.string().url().describe("Public webpage URL"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
    mode: z
      .enum(["normalized", "raw"])
      .default("normalized")
      .describe("'normalized' deduplicates entities. 'raw' preserves original JSON-LD blocks."),
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;
    if (params.mode) body.mode = params.mode;

    const result = await callApi("/schema", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- SEO Audit ---
server.tool(
  "tooltrace_seo_audit",
  "Run an SEO audit on a webpage. Returns a score (0-100), weighted checks for metadata, headings, images, canonical signals, robots directives, social tags, schema, and content length, with evidence and recommendations.",
  {
    url: z.string().url().describe("Public webpage URL to audit"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/seo-audit", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Tech Stack ---
server.tool(
  "tooltrace_tech_stack",
  "Detect the technology stack of a website: CMS, frameworks, JavaScript libraries, analytics, CDN, hosting, fonts, security tools, and more. Returns categorized detections with confidence levels.",
  {
    url: z.string().url().describe("Public webpage URL to analyze"),
    render: renderParam,
    wait_until: waitUntilParam,
    wait_for_selector: waitForSelectorParam,
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;
    if (params.wait_until) body.wait_until = params.wait_until;
    if (params.wait_for_selector)
      body.wait_for_selector = params.wait_for_selector;

    const result = await callApi("/tech-stack", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Sitemap Inspector ---
server.tool(
  "tooltrace_sitemap",
  "Inspect a website's sitemap. Discovers sitemap URLs, parses sitemap XML, and returns listed page URLs with last-modified dates and change frequencies.",
  {
    url: z.string().url().describe("Website URL or direct sitemap URL"),
    render: renderParam,
  },
  async (params) => {
    const body: Record<string, unknown> = { url: params.url };
    if (params.render) body.render = params.render;

    const result = await callApi("/sitemap-inspector", body);
    return { content: [{ type: "text" as const, text: formatJson(result) }] };
  }
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
