# Supported Agents

## Agent List

### CLI / Terminal Agents

| Agent | MCP | Skills | MCP Config Path | Skill Path |
|:------|:---:|:------:|:----------------|:-----------|
| MindOS Agent | ✅ | ✅ | Built-in (no config needed) | Built-in (no config needed) |
| Claude Code | ✅ | ✅ | `~/.claude.json` (global) or `.mcp.json` (project) | `~/.claude/skills/` (global) or `.claude/skills/` (project) |
| OpenClaw | ✅ | ✅ | `~/.openclaw/mcp.json` (global) | `~/.openclaw/skills/` (global) |
| CodeBuddy | ✅ | ✅ | `~/.codebuddy/mcp.json` (global) | `~/.codebuddy/skills/` (global) or `.codebuddy/skills/` (project) |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json` (global) or `.gemini/settings.json` (project) | `~/.agents/skills/` (universal) |
| Kimi Code | ✅ | ✅ | `~/.kimi/mcp.json` (global) or `.kimi/mcp.json` (project) | `~/.agents/skills/` (universal) |
| Codex | ✅ | ✅ | `~/.codex/config.toml` (global, TOML format, key: `mcp_servers`) | `~/.agents/skills/` (universal) |
| OpenCode | ✅ | ✅ | `~/.config/opencode/config.json` (global) | `~/.agents/skills/` (universal) |
| iFlow CLI | ✅ | ✅ | `~/.iflow/settings.json` (global) or `.iflow/settings.json` (project) | `~/.iflow/skills/` (global) or `.iflow/skills/` (project) |
| Pi | ✅ | ✅ | `~/.pi/agent/mcp.json` (global) or `.pi/settings.json` (project) | `~/.pi/skills/` (global) or `.pi/skills/` (project) |
| Qoder | ✅ | ✅ | `~/.qoder.json` (global) | `~/.qoder/skills/` (global) or `.qoder/skills/` (project) |
| Antigravity | ✅ | ✅ | `~/.gemini/antigravity/mcp_config.json` (global) or `.antigravity/mcp_config.json` (project) | `~/.antigravity/skills/` (global) or `.antigravity/skills/` (project) |

### IDE / Editor Agents

| Agent | MCP | Skills | MCP Config Path | Skill Path |
|:------|:---:|:------:|:----------------|:-----------|
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) | `~/.agents/skills/` (universal) |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` (global) | `~/.windsurf/skills/` (global) or `.windsurf/skills/` (project) |
| GitHub Copilot (VS Code) | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/mcp.json`; Linux: `~/.config/Code/User/mcp.json` (global, key: `servers`) or `.vscode/mcp.json` (project) | `~/.agents/skills/` (universal) |
| Trae | ✅ | ✅ | `~/.trae/mcp.json` (global) or `.trae/mcp.json` (project) | `~/.trae/skills/` (global) or `.trae/skills/` (project) |
| Trae CN | ✅ | ✅ | macOS: `~/Library/Application Support/Trae CN/User/mcp.json`; Linux: `~/.config/Trae CN/User/mcp.json` (global) or `.trae/mcp.json` (project) | `~/.trae/skills/` (global) or `.trae/skills/` (project) |
| Augment | ✅ | ✅ | `~/.augment/settings.json` (global) or `.augment/settings.json` (project) | `~/.augment/skills/` (global) or `.augment/skills/` (project) |
| Qwen Code | ✅ | ✅ | `~/.qwen/settings.json` (global) or `.qwen/settings.json` (project) | `~/.qwen/skills/` (global) or `.qwen/skills/` (project) |

### VS Code Extension Agents

| Agent | MCP | Skills | MCP Config Path | Skill Path |
|:------|:---:|:------:|:----------------|:-----------|
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `~/.agents/skills/` (universal) |
| Roo Code | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`; or `.roo/mcp.json` (project) | `~/.roo/skills/` (global) or `.roo/skills/` (project) |

### Early Support (MCP only, Skills not yet supported)

| Agent | MCP | Skills | MCP Config Path | Skill Path |
|:------|:---:|:------:|:----------------|:-----------|
| QClaw | ✅ | - | `~/.qclaw/mcp.json` (global) | - |
| WorkBuddy | ✅ | - | `~/.workbuddy/mcp.json` (global) | - |
| Lingma | ✅ | - | `~/.lingma/mcp.json` (global) | - |
| CoPaw | ✅ | - | `~/.copaw/config.json` (global, nested key: `mcp.clients`) | - |

> **Note:** Windows users — for agents that reference `~/Library/Application Support/...` (macOS) or `~/.config/...` (Linux), the Windows equivalent is `%APPDATA%/...`. The `mindos mcp install` command handles this automatically.

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

**Codex (TOML format):**

```toml
[mcp_servers.mindos]
command = "mindos"
args = ["mcp"]

[mcp_servers.mindos.env]
MCP_TRANSPORT = "stdio"
```

> Each Agent stores config in a different file — see the **MCP Config Path** column in the tables above for exact paths.
>
> Maintenance rules and checklist: `wiki/refs/agent-config-registry.md`

## Troubleshooting

### Tools not appearing after install

Some agents (Cursor, Windsurf, Trae, Cline, Roo Code) **do not hot-reload** MCP config. You must fully quit and restart the agent after running `mindos mcp install`.

### `mindos` command not found (macOS)

GUI-based agents (Cursor, Windsurf) may not inherit your shell PATH. If stdio transport fails:

1. Find your mindos path: `which mindos`
2. Use the full path in config, e.g. `"command": "/opt/homebrew/bin/mindos"`

### Windows: command fails to start

On Windows, `npx` is a `.cmd` script. If stdio transport fails, try wrapping in `cmd`:

```json
{
  "mcpServers": {
    "mindos": {
      "command": "cmd",
      "args": ["/c", "mindos", "mcp"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}
```

### Cursor: tool limit

Cursor has a ~40 tool limit across all MCP servers combined. If you have many servers installed, MindOS tools may be silently dropped. Disable unused servers to free up slots.

### GitHub Copilot: config key is `servers`, not `mcpServers`

GitHub Copilot uses `"servers"` as the top-level key instead of `"mcpServers"`:

```json
{
  "servers": {
    "mindos": {
      "type": "stdio",
      "command": "mindos",
      "args": ["mcp"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}
```

### CoPaw: nested config structure

CoPaw uses a nested config path `mcp.clients` inside `~/.copaw/config.json`:

```json
{
  "mcp": {
    "clients": {
      "mindos": {
        "type": "stdio",
        "command": "mindos",
        "args": ["mcp"],
        "env": { "MCP_TRANSPORT": "stdio" }
      }
    }
  }
}
```
