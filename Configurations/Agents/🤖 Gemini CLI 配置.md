# 🤖 Gemini CLI 配置

## 权限配置

对以下工具不再询问，直接执行：

```json
{
  "tools": {
    "allowed": [
      "run_shell_command",
      "read_file",
      "write_file",
      "replace",
      "grep_search",
      "glob",
      "web_search",
      "codebase_investigator",
      "activate_skill"
    ]
  }
}
```

写入 `~/.gemini/settings.json`。
