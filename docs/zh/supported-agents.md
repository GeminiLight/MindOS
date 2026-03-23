# 支持的 Agent

| Agent | MCP | Skills | MCP 配置文件路径 |
|:------|:---:|:------:|:-----------------|
| MindOS Agent | ✅ | ✅ | 内置（无需配置） |
| OpenClaw | ✅ | ✅ | `~/.openclaw/openclaw.json` 或 `~/.openclaw/mcp.json` |
| Claude Desktop | ✅ | ✅ | macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | ✅ | ✅ | `~/.claude.json`（全局）或 `.mcp.json`（项目级） |
| CodeBuddy | ✅ | ✅ | `~/.claude-internal/.claude.json`（全局） |
| Cursor | ✅ | ✅ | `~/.cursor/mcp.json`（全局）或 `.cursor/mcp.json`（项目级） |
| Windsurf | ✅ | ✅ | `~/.codeium/windsurf/mcp_config.json` |
| Cline | ✅ | ✅ | macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`；Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Trae | ✅ | ✅ | `~/.trae/mcp.json`（全局）或 `.trae/mcp.json`（项目级） |
| Gemini CLI | ✅ | ✅ | `~/.gemini/settings.json`（全局）或 `.gemini/settings.json`（项目级） |
| GitHub Copilot | ✅ | ✅ | `.vscode/mcp.json`（项目级）或 VS Code 用户 `settings.json`（全局） |
| iFlow | ✅ | ✅ | iFlow 平台 MCP 配置面板 |

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
