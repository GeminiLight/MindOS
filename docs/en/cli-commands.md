# CLI Commands

## Core

| Command | Description |
| :--- | :--- |
| `mindos` | Start using the mode saved in `~/.mindos/config.json` |
| `mindos onboard` | Interactive setup (config, template, start mode) |
| `mindos onboard --install-daemon` | Onboard + install and start background service |
| `mindos start` | Start app + MCP server (foreground, production mode) |
| `mindos start --daemon` | Install + start as a background OS service (survives terminal close, auto-restarts on crash) |
| `mindos dev` | Start app + MCP server (dev mode, hot reload) |
| `mindos dev --turbopack` | Dev mode with Turbopack (faster HMR) |
| `mindos open` | Open the Web UI in the default browser |
| `mindos stop` | Stop running MindOS processes |
| `mindos restart` | Stop then start again |
| `mindos build` | Manually build for production |
| `mindos status` | Show service status overview (supports `--json`) |

## Knowledge

| Command | Description |
| :--- | :--- |
| `mindos file list` | List all files in knowledge base |
| `mindos file read <path>` | Read file content |
| `mindos file create <path>` | Create a new file |
| `mindos file delete <path>` | Delete a file |
| `mindos file search "<query>"` | Search files by name |
| `mindos space list` | List all spaces |
| `mindos space create <name>` | Create a new space |
| `mindos space info <name>` | Show space details |
| `mindos search "<query>"` | Search knowledge base via API |
| `mindos ask "<question>"` | Ask AI a question using your knowledge base |
| `mindos agent list` | List detected AI Agents |
| `mindos agent info <name>` | Show Agent details and MCP config |
| `mindos api <METHOD> <path>` | Raw API passthrough (GET/POST/PUT/DELETE) |

> All knowledge commands support `--json` for AI agent consumption.

## MCP

| Command | Description |
| :--- | :--- |
| `mindos mcp` | Start MCP server only |
| `mindos mcp install` | Auto-install MCP config into your Agent (interactive) |
| `mindos mcp install -g -y` | One-shot global install with defaults |
| `mindos token` | Show auth token and per-agent MCP config snippets |

## Sync

| Command | Description |
| :--- | :--- |
| `mindos sync` | Show sync status (alias for `sync status`) |
| `mindos sync init` | Interactive setup for Git remote sync |
| `mindos sync status` | Show sync status: last sync, unpushed commits, conflicts |
| `mindos sync now` | Manually trigger a full sync (commit + push + pull) |
| `mindos sync on` | Enable automatic sync |
| `mindos sync off` | Disable automatic sync |
| `mindos sync conflicts` | List unresolved conflict files |

## Background Service (Gateway)

| Command | Description |
| :--- | :--- |
| `mindos gateway install` | Install background service (systemd on Linux, LaunchAgent on macOS) |
| `mindos gateway uninstall` | Remove background service |
| `mindos gateway start` | Start the background service |
| `mindos gateway stop` | Stop the background service |
| `mindos gateway status` | Show background service status |
| `mindos gateway logs` | Tail background service logs |

## Maintenance

| Command | Description |
| :--- | :--- |
| `mindos doctor` | Health check (config, ports, build, daemon status) |
| `mindos update` | Update MindOS to the latest version |
| `mindos uninstall` | Fully uninstall MindOS (stop, remove daemon, npm uninstall) |
| `mindos logs` | Tail service logs (`~/.mindos/mindos.log`) |
| `mindos config show` | Print current config (API keys masked) |
| `mindos config validate` | Validate config file |
| `mindos config set <key> <val>` | Update a single config field |
