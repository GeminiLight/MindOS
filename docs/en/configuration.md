# Configuration Reference

MindOS configuration is stored at `~/.mindos/config.json`, auto-generated during `mindos onboard`.

## Example

```json
{
  "mindRoot": "~/MindOS",
  "port": 3456,
  "mcpPort": 8781,
  "authToken": "",
  "webPassword": "",
  "startMode": "daemon",
  "ai": {
    "provider": "anthropic",
    "providers": {
      "anthropic": { "apiKey": "sk-ant-...", "model": "claude-sonnet-4-6" },
      "openai":    { "apiKey": "sk-...",     "model": "gpt-5.4", "baseUrl": "" }
    }
  },
  "sync": {
    "enabled": true,
    "provider": "git",
    "remote": "origin",
    "branch": "main",
    "autoCommitInterval": 30,
    "autoPullInterval": 300
  }
}
```

## Fields

| Field | Default | Description |
| :--- | :--- | :--- |
| `mindRoot` | `~/MindOS` | **Required**. Absolute path to the knowledge base root. |
| `port` | `3456` | Optional. Web app port. |
| `mcpPort` | `8781` | Optional. MCP server port. |
| `authToken` | — | Optional. Protects App `/api/*` and MCP `/mcp` with bearer token auth. For Agent / MCP clients. Recommended when exposed to a network. |
| `webPassword` | — | Optional. Protects the web UI with a login page. For browser access. Independent from `authToken`. |
| `startMode` | `start` | Start mode: `daemon` (background service, auto-starts on boot), `start` (foreground), or `dev`. |
| `ai.provider` | `anthropic` | Active provider: `anthropic` or `openai`. |
| `ai.providers.anthropic.apiKey` | — | Anthropic API key. |
| `ai.providers.anthropic.model` | `claude-sonnet-4-6` | Anthropic model ID. |
| `ai.providers.openai.apiKey` | — | OpenAI API key. |
| `ai.providers.openai.model` | `gpt-5.4` | OpenAI model ID. |
| `ai.providers.openai.baseUrl` | — | Optional. Custom endpoint for proxy or OpenAI-compatible APIs. |
| `sync.enabled` | `false` | Enable/disable automatic Git sync. |
| `sync.provider` | `git` | Sync provider (currently only `git`). |
| `sync.remote` | `origin` | Git remote name. |
| `sync.branch` | `main` | Git branch to sync. |
| `sync.autoCommitInterval` | `30` | Seconds after file change to auto-commit+push. |
| `sync.autoPullInterval` | `300` | Seconds between auto-pull from remote. |

## Notes

- Multiple providers can be configured simultaneously — switch between them by changing `ai.provider`.
- Shell env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) take precedence over config file values.
- Run `mindos config set <key> <val>` to update a single field without editing the file.
- Run `mindos config show` to view current config with API keys masked.
