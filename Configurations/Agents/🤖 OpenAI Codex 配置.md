# 🤖 Codex 配置

## 自动执行配置

Codex 通过沙箱在 OS 层面控制权限，而非白名单式工具列表。`approval_policy = "never"` 可避免每次操作都弹出确认。

写入 `~/.codex/config.toml`：

```toml
approval_policy = "never"
sandbox_mode = "workspace-write"
```

### approval_policy 说明

| 值 | 行为 |
|----|------|
| `on-request` | 每次敏感操作前询问（默认） |
| `never` | 在沙箱限制内自动执行，不询问 |

### sandbox_mode 说明

| 值 | 行为 |
|----|------|
| `read-only` | 只读，不允许写文件 |
| `workspace-write` | 允许在项目目录内读写 |

> 注意：`sandbox_mode` 限制的是文件系统，网络访问由沙箱独立控制，`approval_policy = "never"` 不会绕过网络沙箱。这正是截图中 `curl` 仍然触发询问的原因。
