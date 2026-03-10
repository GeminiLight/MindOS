# MindOS MCP Server

MCP (Model Context Protocol) server for MindOS — exposes your local knowledge base as a standardized toolset that any compatible Agent can use.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (requires MIND_ROOT env var)
MIND_ROOT=/path/to/your/my-mind npm start

# Development mode (auto-reload)
MIND_ROOT=/path/to/your/my-mind npm run dev
```

## Transports

MindOS MCP supports:

- `stdio` (default): local process transport.
- `Streamable HTTP`: URL-based transport for remote clients.

### Run with stdio (default)

```bash
MIND_ROOT=/path/to/your/my-mind npm start
```

### Run with Streamable HTTP

```bash
MIND_ROOT=/path/to/your/my-mind \
MCP_TRANSPORT=http \
MCP_HOST=0.0.0.0 \
MCP_PORT=8787 \
MCP_ENDPOINT=/mcp \
MCP_API_KEY=your-strong-token \
npm start
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Agent Configuration

Register in your Agent client's MCP config:

### Local stdio

```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/MindOS/mcp/dist/index.js"],
      "env": {
        "MIND_ROOT": "/path/to/MindOS/my-mind"
      }
    }
  }
}
```

### Remote URL (Streamable HTTP)

```json
{
  "mcpServers": {
    "mindos-remote": {
      "url": "http://<server-ip>:8787/mcp",
      "headers": {
        "Authorization": "Bearer your-strong-token"
      }
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add mindos -- node /path/to/MindOS/mcp/dist/index.js
```

## Tools (20)

| Tool | Description |
|------|-------------|
| `mindos_bootstrap` | Load startup context (INSTRUCTION + README + CONFIG) in one call |
| `mindos_list_files` | Full file tree of the knowledge base |
| `mindos_read_file` | Read file content with pagination |
| `mindos_write_file` | Overwrite file (protected files blocked) |
| `mindos_create_file` | Create new .md/.csv file |
| `mindos_delete_file` | Delete file (protected files blocked) |
| `mindos_rename_file` | Rename file in-place |
| `mindos_move_file` | Move file + report affected backlinks |
| `mindos_search_notes` | Full-text search with scope/type/date filters |
| `mindos_get_recent` | Recently modified files |
| `mindos_get_backlinks` | Find all files referencing a given file |
| `mindos_get_history` | Git commit history for a file |
| `mindos_get_file_at_version` | Read file at a specific git commit |
| `mindos_append_csv` | Append row to CSV file |
| `mindos_read_lines` | Read file as numbered lines |
| `mindos_insert_lines` | Insert lines at position |
| `mindos_update_lines` | Replace line range |
| `mindos_append_to_file` | Append content to file end |
| `mindos_insert_after_heading` | Insert content after a heading |
| `mindos_update_section` | Replace a markdown section |

## Environment Variables

| Variable | Required | Description |
|:---------|:--------:|:------------|
| `MIND_ROOT` | Yes | Absolute path to the knowledge base root directory |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` (`streamable-http` also accepted) |
| `MCP_HOST` | No | HTTP bind host (default: `127.0.0.1`) |
| `MCP_PORT` | No | HTTP bind port (default: `8787`) |
| `MCP_ENDPOINT` | No | HTTP MCP endpoint path (default: `/mcp`) |
| `MCP_HTTP_STATEFUL` | No | `true` to enable stateful sessions, default `false` (stateless) |
| `MCP_API_KEY` | No | Bearer token for HTTP auth. Strongly recommended in remote mode |

## Tech Stack

- **Runtime:** Node.js ≥ 18
- **Protocol:** [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) v1.6+
- **Validation:** Zod
- **Language:** TypeScript

## Project Structure

```
mcp/
├── src/
│   └── index.ts      # All tool definitions and handlers
├── dist/              # Compiled output
├── package.json
└── tsconfig.json
```
