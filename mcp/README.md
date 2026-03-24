# MindOS MCP Server

Pure HTTP client wrapper that maps 22 MCP tools to the App REST API via `fetch`. Zero business logic — all operations are delegated to the App.

## Architecture

```
Claude Code / Agent  ──HTTP/stdio──▶  MCP Server  ──fetch──▶  App REST API (/api/*)
```

The MCP server is a **protocol adapter** (~500 lines):
- Receives MCP tool calls via Streamable HTTP (default) or stdio transport
- Translates each call to the corresponding App API endpoint
- Returns the result back to the agent

No filesystem access, no business logic, no dependencies on `lib/core/`.

## Running

The MCP server starts automatically alongside the app:

```bash
mindos start   # starts app + MCP server together
```

Or run MCP server only:

```bash
mindos mcp     # HTTP mode (default, port 8781)
MCP_TRANSPORT=stdio mindos mcp   # stdio mode
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MINDOS_URL` | `http://localhost:3456` | App server base URL |
| `AUTH_TOKEN` | — | Optional: bearer token (must match App's `AUTH_TOKEN`) |
| `MCP_TRANSPORT` | `http` | Transport mode: `http` or `stdio` |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address (`0.0.0.0` for remote access) |
| `MCP_PORT` | `8781` | HTTP listen port (configurable via `mindos onboard`) |
| `MCP_ENDPOINT` | `/mcp` | HTTP endpoint path |

## MCP Tools (22)

| Tool | App API | Description |
|------|---------|-------------|
| `mindos_list_files` | `GET /api/files` | List all files in the knowledge base |
| `mindos_read_file` | `GET /api/file?path=...` | Read file content (with offset/limit pagination) |
| `mindos_write_file` | `POST /api/file` op=save_file | Overwrite file content |
| `mindos_create_file` | `POST /api/file` op=create_file | Create a new .md or .csv file |
| `mindos_create_space` | `POST /api/file` op=create_space | Create a Mind Space (README + INSTRUCTION scaffold) |
| `mindos_rename_space` | `POST /api/file` op=rename_space | Rename a Space directory (folder only) |
| `mindos_delete_file` | `POST /api/file` op=delete_file | Delete a file |
| `mindos_rename_file` | `POST /api/file` op=rename_file | Rename a file (same directory) |
| `mindos_move_file` | `POST /api/file` op=move_file | Move a file to a new path |
| `mindos_search_notes` | `GET /api/search?q=...` | Full-text search across all files |
| `mindos_get_recent` | `GET /api/recent-files` | Get recently modified files |
| `mindos_read_lines` | `GET /api/file?op=read_lines` | Read file as numbered line array |
| `mindos_insert_lines` | `POST /api/file` op=insert_lines | Insert lines at a position |
| `mindos_update_lines` | `POST /api/file` op=update_lines | Replace a range of lines |
| `mindos_append_to_file` | `POST /api/file` op=append_to_file | Append content to end of file |
| `mindos_insert_after_heading` | `POST /api/file` op=insert_after_heading | Insert after a Markdown heading |
| `mindos_update_section` | `POST /api/file` op=update_section | Replace a Markdown section |
| `mindos_append_csv` | `POST /api/file` op=append_csv | Append a row to a CSV file |
| `mindos_get_backlinks` | `GET /api/backlinks?path=...` | Find files referencing a given path |
| `mindos_bootstrap` | `GET /api/bootstrap` | Load startup context (INSTRUCTION, CONFIG, etc.) |
| `mindos_get_history` | `GET /api/git?op=history` | Get git commit history for a file |
| `mindos_get_file_at_version` | `GET /api/git?op=show` | Read file content at a specific commit |

## Agent Integration

Add to your Agent's MCP config (field names vary by client):

**Local (HTTP):**
```json
{
  "mcpServers": {
    "mindos": {
      "url": "http://localhost:8781/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

**Local (stdio):**
```json
{
  "mcpServers": {
    "mindos": {
      "type": "stdio",
      "command": "mindos",
      "args": ["mcp"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}
```

**Remote:**
```json
{
  "mcpServers": {
    "mindos": {
      "url": "http://<server-ip>:8781/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

## Tech Stack

TypeScript · @modelcontextprotocol/sdk · zod
