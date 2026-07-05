# Supported Agents

## Agent List

### CLI / Terminal Agents

| Agent | MCP | Skills | MCP Config Path (Global) | Skill Path (Global) |
|:------|:---:|:------:|:-------------------------|:--------------------|
| MindOS Agent | ✅ | ✅ | Built-in (no config needed) | Built-in (no config needed) |
| Claude Code | ✅ | ✅ | `~/.claude.json` | `~/.claude/skills/` |
| OpenClaw | ✅ | ✅ | `~/.openclaw/mcp.json` | `~/.openclaw/skills/` |
| CodeBuddy | ✅ | ✅ | `~/.codebuddy/mcp.json` | `~/.codebuddy/skills/` |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json` | `~/.agents/skills/` |
| Kimi Code | ✅ | ✅ | `~/.kimi/mcp.json` | `~/.agents/skills/` |
| Codex | ✅ | ✅ | `~/.codex/config.toml` (TOML, key: `mcp_servers`) | `~/.agents/skills/` |
| OpenCode | ✅ | ✅ | `~/.config/opencode/config.json` | `~/.agents/skills/` |
| Kilo Code | ✅ | ✅ | `~/.config/kilo/kilo.jsonc` (key: `mcp`, entry type: `local` / `remote`; also detects `kilo.json`) | `~/.agents/skills/` |
| Warp | ✅ | ✅ | `~/.warp/.mcp.json` | `~/.agents/skills/` |
| Pi | ✅ | ✅ | `~/.pi/agent/mcp.json` | `~/.pi/skills/` |
| Qoder | ✅ | ✅ | `~/.qoder.json` | `~/.qoder/skills/` |
| Antigravity | ✅ | ✅ | `~/.gemini/antigravity/mcp_config.json` | `~/.antigravity/skills/` |

### IDE / Editor Agents

| Agent | MCP | Skills | MCP Config Path (Global) | Skill Path (Global) |
|:------|:---:|:------:|:-------------------------|:--------------------|
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json` | `~/.agents/skills/` |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` | `~/.windsurf/skills/` |
| GitHub Copilot (VS Code) | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/mcp.json`; Linux: `~/.config/Code/User/mcp.json` (key: `servers`) | `~/.agents/skills/` |
| Trae | ✅ | ✅ | `~/.trae/mcp.json` | `~/.trae/skills/` |
| Trae CN | ✅ | ✅ | macOS: `~/Library/Application Support/Trae CN/User/mcp.json`; Linux: `~/.config/Trae CN/User/mcp.json` | `~/.trae/skills/` |
| Augment | ✅ | ✅ | `~/.augment/settings.json` | `~/.augment/skills/` |
| Qwen Code | ✅ | ✅ | `~/.qwen/settings.json` | `~/.qwen/skills/` |

### VS Code Extension Agents

| Agent | MCP | Skills | MCP Config Path (Global) | Skill Path (Global) |
|:------|:---:|:------:|:-------------------------|:--------------------|
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `~/.agents/skills/` |
| Roo Code | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`; Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `~/.roo/skills/` |

### Early Support (MCP only, Skills not yet supported)

| Agent | MCP | Skills | MCP Config Path (Global) | Skill Path (Global) |
|:------|:---:|:------:|:-------------------------|:--------------------|
| QClaw | ✅ | - | `~/.qclaw/mcp.json` | - |
| WorkBuddy | ✅ | - | `~/.workbuddy/mcp.json` | - |
| Lingma | ✅ | - | `~/.lingma/mcp.json` | - |
| CoPaw | ✅ | - | `~/.copaw/config.json` (nested key: `mcp.clients`) | - |
| Hermes | ✅ | - | `~/.hermes/config.yaml` (YAML, key: `mcp_servers`) | - |

> **Note:** The paths above are the **global (recommended)** install locations. Some agents also support project-level config (e.g. Claude Code: `.mcp.json`, Cursor: `.cursor/mcp.json`, Trae: `.trae/mcp.json`). Use `mindos mcp install` without `-g` to choose project scope interactively.
>
> **Windows users:** For agents that reference `~/Library/Application Support/...` (macOS) or `~/.config/...` (Linux), the Windows equivalent is `%APPDATA%/...`. The `mindos mcp install` command handles this automatically.

## How to Connect

### Automatic (Recommended)

```bash
mindos mcp install -g
```

Interactively selects agent, transport (stdio/http), and token. Installs MCP config to global scope and copies the packaged MindOS Skill into the agent's skill workspace.

### One-shot

```bash
# Local, global scope
mindos mcp install -g -y

# Verify MCP + command + Skill readiness
mindos doctor agents codex

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

**Kilo Code (`mcp` key with local / remote entries):**

```json
{
  "mcp": {
    "mindos": {
      "type": "local",
      "command": ["mindos", "mcp"],
      "environment": { "MCP_TRANSPORT": "stdio" },
      "enabled": true
    }
  }
}
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

### Hermes: YAML config

Hermes uses YAML and the `mcp_servers` key in `~/.hermes/config.yaml`. Use `mindos mcp install` to write the correct structure automatically.
