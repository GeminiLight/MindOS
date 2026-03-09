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

## Agent Configuration

Register in your Agent client's MCP config:

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

**Claude Code:**
```bash
claude mcp add mindos -- node /path/to/MindOS/mcp/dist/index.js
```

## Tools (20)

| Tool | Description |
|------|-------------|
| `mindos_bootstrap` | Load startup context (INSTRUCTION + README) in one call |
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
