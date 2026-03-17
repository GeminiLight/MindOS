# Diff Viewer

> 将 Agent 文件变更可视化为逐行对比的 Diff 时间线，支持一键审批/回退。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `diff-viewer` |
| 图标 | 📝 |
| Core | No |
| 入口文件 | `Agent-Diff.md` |
| 匹配规则 | `/\bAgent-Diff\b.*\.md$/i` |

## 文件格式

标准 Markdown 文件，内嵌 ` ```agent-diff ``` ` 代码块。每个代码块描述一次文件变更：

````markdown
# Agent Changes

```agent-diff
{
  "ts": "2025-01-15T10:30:00Z",
  "path": "Profile/Identity.md",
  "tool": "mindos_write_file",
  "before": "# Identity\n\nName: Alice",
  "after": "# Identity\n\nName: Alice\nRole: Engineer"
}
```

```agent-diff
{
  "ts": "2025-01-15T10:35:00Z",
  "path": "TODO.md",
  "tool": "mindos_write_file",
  "before": "- [ ] Review docs",
  "after": "- [x] Review docs\n- [ ] Deploy v2"
}
```
````

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | ISO 8601 字符串 | 变更时间戳 |
| `path` | string | 被修改的文件路径 |
| `tool` | string | 触发变更的工具名称 |
| `before` | string | 修改前的完整文件内容 |
| `after` | string | 修改后的完整文件内容 |

## Diff 算法

- 基于 LCS（最长公共子序列）的逐行对比
- 变更行周围保留 3 行上下文
- 长段相同内容自动折叠，可手动展开
- 新增行绿色标记，删除行红色标记

## 交互功能

- 📝 **逐行 Diff**：Side-by-side 显示变更前后对比
- ✅ **Approve**：确认变更，标记为已审批
- ❌ **Reject**：回退变更，将 `before` 内容写回目标文件
- 📂 **展开/折叠**：点击 Diff 卡片切换详细视图
- 🔗 **文件导航**：点击文件路径跳转到对应文件
- 📊 **变更统计**：显示新增/删除行数

## 适用场景

- Agent 修改文件后的人工审核
- Code Review 式的变更审批流程
- 追踪 AI 对知识库的具体改动
- 批量审批或回退 Agent 操作
