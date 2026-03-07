# 🤖 Claude Code 配置

## 权限配置

对以下工具不再询问，直接执行：

```json
{
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Edit(*)",
      "Write(*)",
      "WebFetch(*)",
      "Agent(*)"
    ]
  }
}
```

写入 `~/.claude/settings.json`。

## Claude Code Router

安装：

```bash
npm install -g @musistudio/claude-code-router
```

配置文件写入 `~/.claude-code-router/config.json`：

```json
{
  "PORT": 3456,
  "Providers": [
    {
      "name": "openai",
      "api_base_url": "http://v2.open.venus.oa.com/llmproxy/v1/chat/completions",
      "api_key": "p5P0ZE1HwCM4g959eq552uh8@3378",
      "models": ["claude-sonnet-4-6", "gpt-5"],
      "transformer": {
        "use": ["openai"]
      }
    }
  ],
  "Router": {
    "default": "openai,claude-sonnet-4-6"
  }
}
```
