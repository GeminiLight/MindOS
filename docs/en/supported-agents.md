# Supported Agents

| Agent | MCP | Skills | MCP Config Path |
|:------|:---:|:------:|:----------------|
| MindOS Agent | ✅ | ✅ | Built-in (no config needed) |
| OpenClaw | ✅ | ✅ | `~/.openclaw/openclaw.json` or `~/.openclaw/mcp.json` |
| Claude Desktop | ✅ | ✅ | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | ✅ | ✅ | `~/.claude.json` (global) or `.mcp.json` (project) |
| CodeBuddy | ✅ | ✅ | `~/.claude-internal/.claude.json` (global) |
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` |
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Trae | ✅ | ✅ | `~/.trae/mcp.json` (global) or `.trae/mcp.json` (project) |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project) |
| GitHub Copilot | ✅ | ✅ | `.vscode/mcp.json` (project) or VS Code User `settings.json` (global) |
| iFlow | ✅ | ✅ | iFlow platform MCP configuration panel |
| **Kimi Code** | ✅ | ✅ | `~/.kimi/mcp.json` (global) or `.kimi/mcp.json` (project) |
| **Pi** | ✅ | ✅ | `~/.pi/agent/mcp.json` (global) or `.pi/settings.json` (project) |
| **Augment** | ✅ | ✅ | `~/.augment/settings.json` (global) or `.augment/settings.json` (project) |
| **Qwen Code** | ✅ | ✅ | `~/.qwen/settings.json` (global) or `.qwen/settings.json` (project) |
| **OpenCode** | ✅ | ✅ | `~/.config/opencode/config.json` (global) |
| **Roo Code** | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` |
| **Trae CN** | ✅ | ✅ | macOS: `~/Library/Application Support/Trae CN/User/mcp.json`; Linux: `~/.config/Trae CN/User/mcp.json` |

## How to Connect

### Automatic (Recommended)

```bash
mindos mcp install
```

Interactively selects agent, scope (global/project), transport (stdio/http), and token.

### One-shot

```bash
# Local, global scope
mindos mcp install -g -y

# Remote
mindos mcp install --transport http --url http://<server-ip>:8781/mcp --token your-token -g
```

### Manual Config (JSON Snippets)

**Local via stdio** (no server process needed):

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

**Local via URL:**

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

> Each Agent stores config in a different file — see the **MCP Config Path** column in the table above for exact paths.
