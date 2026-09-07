# ToolTrace MCP Server

Give AI agents a complete web intelligence toolkit. This [Model Context Protocol](https://modelcontextprotocol.io/) server connects Claude Code, Claude Desktop, Cursor, VS Code, Codex, Windsurf and any other MCP client to the [ToolTrace](https://tooltrace.io) API.

One tool per ToolTrace endpoint: scrape any page to clean Markdown, read metadata and JSON-LD, extract links, run on-page SEO audits, detect a site's tech stack, and check XML sitemaps. Free tier included, no card required.

**Setup guide:** [tooltrace.io/mcp](https://tooltrace.io/mcp)

## Tools

| Tool | Description |
|------|-------------|
| `tooltrace_extract` | Extract clean Markdown, text, metadata, links, JSON-LD, and sections from any webpage |
| `tooltrace_metadata` | Get page title, description, canonical URL, Open Graph, and Twitter card fields |
| `tooltrace_links` | Extract all internal and external links with anchor text |
| `tooltrace_schema` | Extract JSON-LD structured data (Article, Product, FAQ, etc.) |
| `tooltrace_seo_audit` | Run an SEO audit with scored checks and recommendations |
| `tooltrace_tech_stack` | Detect CMS, frameworks, analytics, CDN, hosting, and more |
| `tooltrace_sitemap` | Inspect and parse XML sitemaps |

## Two ways to connect

**Hosted**, for clients that take a connector URL. Nothing to install or update:

```
https://mcp.tooltrace.io/mcp
```

```bash
claude mcp add --transport http tooltrace https://mcp.tooltrace.io/mcp \
  --header "Authorization: Bearer your-api-key"
```

Also listed on [Smithery](https://smithery.ai/servers/malikrashidk55/tooltrace).

**Local**, over stdio, for clients that run a process. Use this when your client
does not speak HTTP, or when you would rather your API key never left your own
machine. That is the quick start below.

Both expose the same tools and bill the same credits.

## Quick start

### 1. Get a free API key

Sign up at [tooltrace.io/signup](https://tooltrace.io/signup). The free plan includes 1,000 credits per month.

### 2. Install

```bash
npm install -g @tooltrace/mcp-server
```

### 3. Configure your MCP client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tooltrace": {
      "command": "tooltrace-mcp",
      "env": {
        "TOOLTRACE_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add tooltrace tooltrace-mcp -e TOOLTRACE_API_KEY=your-api-key
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tooltrace": {
      "command": "tooltrace-mcp",
      "env": {
        "TOOLTRACE_API_KEY": "your-api-key"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "tooltrace": {
      "command": "tooltrace-mcp",
      "env": {
        "TOOLTRACE_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.tooltrace]
command = "tooltrace-mcp"
env = { TOOLTRACE_API_KEY = "your-api-key" }
```

**Windsurf** (`mcp_config.json`):

```json
{
  "mcpServers": {
    "tooltrace": {
      "command": "tooltrace-mcp",
      "env": {
        "TOOLTRACE_API_KEY": "your-api-key"
      }
    }
  }
}
```

**Any other MCP client:** run `tooltrace-mcp` over stdio and set the
`TOOLTRACE_API_KEY` environment variable. Full per-client setup guide at
[tooltrace.io/mcp](https://tooltrace.io/mcp).

### Run with npx (no install)

```bash
TOOLTRACE_API_KEY=your-api-key npx @tooltrace/mcp-server
```

## Usage examples

Once connected, your AI agent can:

- "Extract the main content from this blog post as Markdown"
- "What technologies does competitor.com use?"
- "Run an SEO audit on our landing page"
- "Get all the links from this documentation page"
- "Extract the JSON-LD schema from this product page"
- "Check the sitemap for this website"

## Rendering modes

All tools support a `render` parameter:

- **`never`**: Fast static fetch, 1 credit. Best for server-rendered pages.
- **`auto`** (default): Starts static, renders in browser if needed. 1 or 5 credits.
- **`always`**: Full browser rendering, 5 credits. For JavaScript-heavy SPAs.

## Development

```bash
git clone https://github.com/ToolTrace-io/mcp-server.git
cd mcp-server
npm install
npm run build
TOOLTRACE_API_KEY=your-key node dist/index.js
```

## License

MIT
