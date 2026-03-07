# 🤖 Codex 配置

## 权限配置

Codex 通过沙箱在 OS 层面控制权限，而非白名单式工具列表。`approval_policy = "never"` 可避免每次操作都弹出确认。

写入 `~/.codex/config.toml`：

```toml
approval_policy = "never"
sandbox_mode = "danger-full-access"
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
| `workspace-write` | 允许在当前工作区读写；工作区外通常不可写 |
| `danger-full-access` | 关闭文件系统沙箱限制（高风险），可访问/修改更多本机路径 |

推荐理解为一个权限梯度：`read-only` < `workspace-write` < `danger-full-access`。

常见搭配建议：

| 目标 | 建议配置 |
|------|----------|
| 最安全（仅查看） | `approval_policy = "on-request"` + `sandbox_mode = "read-only"` |
| 日常开发（推荐） | `approval_policy = "on-request"` + `sandbox_mode = "workspace-write"` |
| 高自动化（谨慎） | `approval_policy = "never"` + `sandbox_mode = "workspace-write"` |
| 几乎不受限（仅在完全信任环境） | `approval_policy = "never"` + `sandbox_mode = "danger-full-access"` |

> 注意：`sandbox_mode` 限制的是文件系统，网络访问由沙箱独立控制，`approval_policy = "never"` 不会绕过网络沙箱。这正是截图中 `curl` 仍然触发询问的原因。

> 额外注意：当你设置 `approval_policy = "never"` 且 `sandbox_mode` 又较严格时，超出沙箱范围的操作会被直接拒绝，而不是弹窗让你临时授权。
