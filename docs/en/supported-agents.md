# Supported Agents

| Agent | MCP | Skills | MCP Config Path | Skill Config Path |
|:------|:---:|:------:|:----------------|:------------------|
| MindOS Agent | ✅ | ✅ | Built-in (no config needed) | Built-in (no config needed) |
| OpenClaw | ✅ | ✅ | `~/.openclaw/openclaw.json` or `~/.openclaw/mcp.json` | `skills/` (project) or `~/.openclaw/skills/` (global) |
| Claude Code | ✅ | ✅ | `~/.claude.json` (global) or `.mcp.json` (project) | `.claude/skills/` (project) or `~/.claude/skills/` (global) |
| CodeBuddy | ✅ | ✅ | `~/.codebuddy/mcp.json` (global) | `.codebuddy/skills/` (project) or `~/.codebuddy/skills/` (global) |
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) | `.cursor/skills/` (project) or `~/.cursor/skills/` (global) |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/skills/` (project) or `~/.windsurf/skills/` (global) |
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `.agents/skills/` (universal path) |
| Trae | ✅ | ✅ | `~/.trae/mcp.json` (global) or `.trae/mcp.json` (project) | `.trae/skills/` (project) or `~/.trae/skills/` (global) |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project) | `.agents/skills/` (universal path) |
| GitHub Copilot | ✅ | ✅ | `.vscode/mcp.json` (project) or VS Code User `settings.json` (global) | `.agents/skills/` (universal path) |
| Kimi Code | ✅ | ✅ | `~/.kimi/mcp.json` (global) or `.kimi/mcp.json` (project) | `.agents/skills/` (universal path) |
| Qoder | ✅ | ✅ | `~/.qoder.json` (global) | `.qoder/skills/` (project) or `~/.qoder/skills/` (global) |
| Pi | ✅ | ✅ | `~/.pi/agent/mcp.json` (global) or `.pi/settings.json` (project) | `.pi/skills/` (project) or `~/.pi/skills/` (global) |
| Augment | ✅ | ✅ | `~/.augment/settings.json` (global) or `.augment/settings.json` (project) | `.augment/skills/` (project) or `~/.augment/skills/` (global) |
| Qwen Code | ✅ | ✅ | `~/.qwen/settings.json` (global) or `.qwen/settings.json` (project) | `.qwen/skills/` (project) or `~/.qwen/skills/` (global) |
| OpenCode | ✅ | ✅ | `~/.config/opencode/config.json` (global) | `.agents/skills/` (universal path) |
| Roo Code | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `.roo/skills/` (project) or `~/.roo/skills/` (global) |
| VS Code | ✅ | ✅ | `.vscode/mcp.json` (project) or VS Code User `settings.json` (global, nested `mcp.servers`) | `.agents/skills/` (universal path) |
| Codex | ✅ | ✅ | `~/.codex/config.toml` (global, TOML format) | `.agents/skills/` (universal path) |

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
>
> Maintenance rules and checklist: `wiki/refs/agent-config-registry.md`
