# 配置参考

MindOS 配置存储在 `~/.mindos/config.json`，`mindos onboard` 时自动生成。

## 示例

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

## 字段说明

| 字段 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `mindRoot` | `~/MindOS` | **必填**。知识库根目录的绝对路径 |
| `port` | `3456` | 可选。Web 服务端口 |
| `mcpPort` | `8781` | 可选。MCP 服务端口 |
| `authToken` | — | 可选。保护 App `/api/*` 和 MCP `/mcp` 的 Bearer Token 认证。供 Agent / MCP 客户端使用，暴露到网络时建议设置 |
| `webPassword` | — | 可选。为 Web UI 添加登录密码保护。供浏览器访问，与 `authToken` 相互独立 |
| `startMode` | `start` | 启动模式：`daemon`（后台服务，开机自启）、`start`（前台）或 `dev` |
| `ai.provider` | `anthropic` | 当前使用的 provider：`anthropic` 或 `openai` |
| `ai.providers.anthropic.apiKey` | — | Anthropic API Key |
| `ai.providers.anthropic.model` | `claude-sonnet-4-6` | Anthropic 模型 ID |
| `ai.providers.openai.apiKey` | — | OpenAI API Key |
| `ai.providers.openai.model` | `gpt-5.4` | OpenAI 模型 ID |
| `ai.providers.openai.baseUrl` | — | 可选。用于代理或 OpenAI 兼容 API 的自定义接口地址 |
| `sync.enabled` | `false` | 启用/禁用 Git 自动同步 |
| `sync.provider` | `git` | 同步方式（目前仅支持 `git`） |
| `sync.remote` | `origin` | Git 远程仓库名 |
| `sync.branch` | `main` | 同步分支 |
| `sync.autoCommitInterval` | `30` | 文件变更后自动 commit+push 的延迟秒数 |
| `sync.autoPullInterval` | `300` | 自动从远程 pull 的间隔秒数 |

## 说明

- 多个 provider 可以同时配置，切换时只需修改 `ai.provider` 字段，无需重新填写 API Key。
- Shell 环境变量（`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等）优先级高于配置文件。
- 运行 `mindos config set <key> <val>` 可更新单个字段，无需手动编辑文件。
- 运行 `mindos config show` 可查看当前配置（API Key 脱敏显示）。
