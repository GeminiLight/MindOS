# 支持的 Agent

## Agent 列表

### CLI / 终端类 Agent

| Agent | MCP | Skills | MCP 配置文件路径 | Skill 路径 |
|:------|:---:|:------:|:-----------------|:-----------|
| MindOS Agent | ✅ | ✅ | 内置（无需配置） | 内置（无需配置） |
| Claude Code | ✅ | ✅ | `~/.claude.json`（全局）或 `.mcp.json`（项目级） | `~/.claude/skills/`（全局）或 `.claude/skills/`（项目级） |
| OpenClaw | ✅ | ✅ | `~/.openclaw/mcp.json`（全局） | `~/.openclaw/skills/`（全局） |
| CodeBuddy | ✅ | ✅ | `~/.codebuddy/mcp.json`（全局） | `~/.codebuddy/skills/`（全局）或 `.codebuddy/skills/`（项目级） |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json`（全局）或 `.gemini/settings.json`（项目级） | `~/.agents/skills/`（通用） |
| Kimi Code | ✅ | ✅ | `~/.kimi/mcp.json`（全局）或 `.kimi/mcp.json`（项目级） | `~/.agents/skills/`（通用） |
| Codex | ✅ | ✅ | `~/.codex/config.toml`（全局，TOML 格式，键名：`mcp_servers`） | `~/.agents/skills/`（通用） |
| OpenCode | ✅ | ✅ | `~/.config/opencode/config.json`（全局） | `~/.agents/skills/`（通用） |
| iFlow CLI | ✅ | ✅ | `~/.iflow/settings.json`（全局）或 `.iflow/settings.json`（项目级） | `~/.iflow/skills/`（全局）或 `.iflow/skills/`（项目级） |
| Pi | ✅ | ✅ | `~/.pi/agent/mcp.json`（全局）或 `.pi/settings.json`（项目级） | `~/.pi/skills/`（全局）或 `.pi/skills/`（项目级） |
| Qoder | ✅ | ✅ | `~/.qoder.json`（全局） | `~/.qoder/skills/`（全局）或 `.qoder/skills/`（项目级） |
| Antigravity | ✅ | ✅ | `~/.gemini/antigravity/mcp_config.json`（全局）或 `.antigravity/mcp_config.json`（项目级） | `~/.antigravity/skills/`（全局）或 `.antigravity/skills/`（项目级） |

### IDE / 编辑器类 Agent

| Agent | MCP | Skills | MCP 配置文件路径 | Skill 路径 |
|:------|:---:|:------:|:-----------------|:-----------|
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json`（全局）或 `.cursor/mcp.json`（项目级） | `~/.agents/skills/`（通用） |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json`（全局） | `~/.windsurf/skills/`（全局）或 `.windsurf/skills/`（项目级） |
| GitHub Copilot (VS Code) | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/mcp.json`；Linux: `~/.config/Code/User/mcp.json`（全局，键名：`servers`）或 `.vscode/mcp.json`（项目级） | `~/.agents/skills/`（通用） |
| Trae | ✅ | ✅ | `~/.trae/mcp.json`（全局）或 `.trae/mcp.json`（项目级） | `~/.trae/skills/`（全局）或 `.trae/skills/`（项目级） |
| Trae CN | ✅ | ✅ | macOS: `~/Library/Application Support/Trae CN/User/mcp.json`；Linux: `~/.config/Trae CN/User/mcp.json`（全局）或 `.trae/mcp.json`（项目级） | `~/.trae/skills/`（全局）或 `.trae/skills/`（项目级） |
| Augment | ✅ | ✅ | `~/.augment/settings.json`（全局）或 `.augment/settings.json`（项目级） | `~/.augment/skills/`（全局）或 `.augment/skills/`（项目级） |
| Qwen Code | ✅ | ✅ | `~/.qwen/settings.json`（全局）或 `.qwen/settings.json`（项目级） | `~/.qwen/skills/`（全局）或 `.qwen/skills/`（项目级） |

### VS Code 扩展类 Agent

| Agent | MCP | Skills | MCP 配置文件路径 | Skill 路径 |
|:------|:---:|:------:|:-----------------|:-----------|
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`；Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `~/.agents/skills/`（通用） |
| Roo Code | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`；Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`；或 `.roo/mcp.json`（项目级） | `~/.roo/skills/`（全局）或 `.roo/skills/`（项目级） |

### 早期支持（仅 MCP，暂不支持 Skills）

| Agent | MCP | Skills | MCP 配置文件路径 | Skill 路径 |
|:------|:---:|:------:|:-----------------|:-----------|
| QClaw | ✅ | - | `~/.qclaw/mcp.json`（全局） | - |
| WorkBuddy | ✅ | - | `~/.workbuddy/mcp.json`（全局） | - |
| Lingma | ✅ | - | `~/.lingma/mcp.json`（全局） | - |
| CoPaw | ✅ | - | `~/.copaw/config.json`（全局，嵌套键：`mcp.clients`） | - |

> **注意：** Windows 用户 — 对于引用 `~/Library/Application Support/...`（macOS）或 `~/.config/...`（Linux）的 Agent，Windows 对应路径为 `%APPDATA%/...`。`mindos mcp install` 命令会自动处理。

## 连接方式

### 自动安装（推荐）

```bash
mindos mcp install
```

交互式引导选择 agent、scope（全局/项目）、transport（stdio/http）和 token。

### 一键安装

```bash
# 本机，全局
mindos mcp install -g -y

# 远程
mindos mcp install --transport http --url http://<服务器IP>:8781/mcp --token your-token -g
```

### 手动配置（JSON 片段）

**本机 stdio**（无需启动服务进程）：

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

**本机 URL：**

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

**远程：**

```json
{
  "mcpServers": {
    "mindos": {
      "url": "http://<服务器IP>:8781/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

**Codex（TOML 格式）：**

```toml
[mcp_servers.mindos]
command = "mindos"
args = ["mcp"]

[mcp_servers.mindos.env]
MCP_TRANSPORT = "stdio"
```

> 各 Agent 的配置文件路径不同，详见上方表格中的 **MCP 配置文件路径** 列。
>
> 维护规则与校对清单：`wiki/refs/agent-config-registry.md`

## 常见问题

### 安装后 Tools 不出现

部分 Agent（Cursor、Windsurf、Trae、Cline、Roo Code）**不会热加载** MCP 配置。运行 `mindos mcp install` 后，必须完全退出并重启该 Agent。

### macOS 下 `mindos` 命令找不到

GUI 类 Agent（Cursor、Windsurf）可能不继承 shell PATH。如果 stdio 传输失败：

1. 查找 mindos 路径：`which mindos`
2. 在配置中使用完整路径，例如 `"command": "/opt/homebrew/bin/mindos"`

### Windows 下命令启动失败

Windows 上 `npx` 是 `.cmd` 脚本。如果 stdio 传输失败，用 `cmd` 包一层：

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

### Cursor：Tool 数量限制

Cursor 所有 MCP server 合计最多 ~40 个 tool。如果安装了很多 server，MindOS 的 tool 可能被静默丢弃。禁用不用的 server 来释放名额。

### GitHub Copilot：配置键名是 `servers` 而非 `mcpServers`

GitHub Copilot 使用 `"servers"` 作为顶层键名，而非 `"mcpServers"`：

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

### CoPaw：嵌套配置结构

CoPaw 在 `~/.copaw/config.json` 中使用嵌套路径 `mcp.clients`：

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
