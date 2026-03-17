# Agent Inspector

> 将 Agent 工具调用日志可视化为可过滤的操作时间线。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `agent-inspector` |
| 图标 | 🔍 |
| Core | No |
| 入口文件 | `.agent-log.json` |
| 匹配规则 | 文件名以 `.agent-log.json` 结尾 |

## 文件格式

**JSON Lines**（每行一个完整 JSON 对象），非标准 JSON 数组：

```jsonl
{"ts":"2025-01-15T10:30:00Z","tool":"mindos_write_file","params":{"path":"Profile/Identity.md","content":"..."},"result":"ok","message":"Written 245 bytes"}
{"ts":"2025-01-15T10:31:00Z","tool":"mindos_read_file","params":{"path":"TODO.md"},"result":"ok","message":"Read 1024 bytes"}
{"ts":"2025-01-15T10:32:00Z","tool":"mindos_search","params":{"query":"meeting notes"},"result":"ok","message":"Found 3 results"}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | ISO 8601 字符串 | 操作时间戳 |
| `tool` | string | 工具名称（如 `mindos_write_file`） |
| `params` | object | 工具参数（路径、内容等） |
| `result` | `"ok"` \| `"error"` | 执行结果 |
| `message` | string（可选） | 结果描述 |

## 交互功能

- 🔍 **操作过滤**：按类型筛选（All / Write / Create / Delete / Read / Search）
- 🎨 **颜色编码**：每种操作类型有独立颜色标识
  - Read: 蓝色 · Write: 琥珀色 · Create: 绿色 · Delete: 红色 · Search: 紫色
- 📂 **展开详情**：点击操作卡片查看完整参数、结果、绝对时间戳
- 🔗 **文件导航**：点击文件路径直接跳转到对应文件
- ⏱️ **相对时间**：显示 "5m ago" 等人类可读时间
- ✅❌ **状态指示**：成功/失败操作的视觉标记

## 适用场景

- 审查 AI Agent 对知识库的修改历史
- 调试 Agent 工具调用链
- 监控 MCP 工具的执行状况
- 回溯某个文件被修改的上下文
