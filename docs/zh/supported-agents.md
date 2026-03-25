# 支持的 Agent

| Agent | MCP | Skills | MCP 配置文件路径 | Skill 配置路径 |
|:------|:---:|:------:|:-----------------|:---------------|
| MindOS Agent | ✅ | ✅ | 内置（无需配置） | 内置（无需配置） |
| OpenClaw | ✅ | ✅ | `~/.openclaw/openclaw.json` 或 `~/.openclaw/mcp.json` | `skills/`（项目级）或 `~/.openclaw/skills/`（全局） |
| Claude Code | ✅ | ✅ | `~/.claude.json`（全局）或 `.mcp.json`（项目级） | `.claude/skills/`（项目级）或 `~/.claude/skills/`（全局） |
| CodeBuddy | ✅ | ✅ | `~/.codebuddy/mcp.json`（全局） | `.codebuddy/skills/`（项目级）或 `~/.codebuddy/skills/`（全局） |
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json`（全局）或 `.cursor/mcp.json`（项目级） | `.cursor/skills/`（项目级）或 `~/.cursor/skills/`（全局） |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` | `.windsurf/skills/`（项目级）或 `~/.windsurf/skills/`（全局） |
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`；Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `.agents/skills/`（通用路径） |
| Trae | ✅ | ✅ | `~/.trae/mcp.json`（全局）或 `.trae/mcp.json`（项目级） | `.trae/skills/`（项目级）或 `~/.trae/skills/`（全局） |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json`（全局）或 `.gemini/settings.json`（项目级） | `.agents/skills/`（通用路径） |
| GitHub Copilot | ✅ | ✅ | `.vscode/mcp.json`（项目级）或 VS Code 用户 `settings.json`（全局） | `.agents/skills/`（通用路径） |
| Kimi Code | ✅ | ✅ | `~/.kimi/mcp.json`（全局）或 `.kimi/mcp.json`（项目级） | `.agents/skills/`（通用路径） |
| Qoder | ✅ | ✅ | `~/.qoder.json`（全局） | `.qoder/skills/`（项目级）或 `~/.qoder/skills/`（全局） |
| Pi | ✅ | ✅ | `~/.pi/agent/mcp.json`（全局）或 `.pi/settings.json`（项目级） | `.pi/skills/`（项目级）或 `~/.pi/skills/`（全局） |
| Augment | ✅ | ✅ | `~/.augment/settings.json`（全局）或 `.augment/settings.json`（项目级） | `.augment/skills/`（项目级）或 `~/.augment/skills/`（全局） |
| Qwen Code | ✅ | ✅ | `~/.qwen/settings.json`（全局）或 `.qwen/settings.json`（项目级） | `.qwen/skills/`（项目级）或 `~/.qwen/skills/`（全局） |
| Roo Code | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`；Linux: `~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `.roo/skills/`（项目级）或 `~/.roo/skills/`（全局） |
| VS Code | ✅ | ✅ | `.vscode/mcp.json`（项目级）或 VS Code 用户 `settings.json`（全局，`mcp.servers` 嵌套） | `.agents/skills/`（通用路径） |
| Codex | ✅ | ✅ | `~/.codex/config.toml`（全局，TOML 格式） | `.agents/skills/`（通用路径） |

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

> 各 Agent 的配置文件路径不同，详见上方表格中的 **MCP 配置文件路径** 列。
