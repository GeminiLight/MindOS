# SPEC: Agent Phase 1 — 工具补齐 + UIMessageStream

> 补齐 7 个知识库工具，将 Agent 流式响应从纯文本切换到 UIMessageStream，前端可视化 tool calls。

## 动机

MindOS Agent 当前仅 9 个工具，缺少 delete/rename/move/backlinks/history/csv 等操作。前端使用 `toTextStreamResponse()` 纯文本流，tool 调用对用户不可见，无法感知 Agent 正在执行什么操作。

## 设计决策

| 决策 | 选项 | 结论 |
|------|------|------|
| 新增工具范围 | 与 MCP 全量对齐 vs 仅补缺少量工具 | **少量补缺**。`read_lines`/`insert_lines`/`update_lines` 脆弱（行号易错位），`bootstrap` 请求时自动加载 |
| 流式协议 | `toTextStreamResponse()` vs `toUIMessageStreamResponse()` | **UIMessageStream**。AI SDK v6 原生支持，包含结构化 tool call 信息 |
| 前端消费方式 | `@ai-sdk/react` useChat vs 手动解析 SSE | **手动解析**。项目未引入 `@ai-sdk/react`（0 import），手动消费控制力更强 |
| 消息类型扩展 | 新建 UIMessage type vs 扩展现有 Message | **扩展 Message**。增加 `parts?: MessagePart[]`，向下兼容 |
| 多轮 tool 历史 | 原样透传 vs 转换为 ModelMessage[] | **转换**。前端 Message 格式与 AI SDK ModelMessage 不同，需要 `convertToModelMessages()` |

## 变更范围

### 1a. 补齐 7 个工具（`app/lib/agent/tools.ts`）

所有 fs 函数已存在于 `app/lib/fs.ts`，包裹为 `tool()` + `logged()` wrapper：

| 新工具 | fs 函数 | 用途 |
|--------|---------|------|
| `delete_file` | `deleteFile()` | 删除文件 |
| `rename_file` | `renameFile()` | 重命名 |
| `move_file` | `moveFile()` | 移动文件（返回受影响的 backlinks） |
| `get_backlinks` | `findBacklinks()` | 反向链接查询 |
| `get_history` | `gitLog()` | Git 提交历史 |
| `get_file_at_version` | `gitShowFile()` | 读历史版本 |
| `append_csv` | `appendCsvRow()` | CSV 追加行 |

破坏性工具（`delete_file`, `move_file`, `write_file`）在 system prompt 中标注警告。

### 1b. UIMessageStream 后端切换（`app/app/api/ask/route.ts`）

- `toTextStreamResponse()` → `toUIMessageStreamResponse()`
- 新增 `convertToModelMessages()`：将前端 `Message[]`（含 `parts`）转换为 AI SDK `ModelMessage[]`
  - assistant message → `{role: 'assistant', content: [TextPart, ToolCallPart]}`（不含 output）
  - completed tool calls → `{role: 'tool', content: [ToolResultPart]}`
  - 跳过 `__error__` 前缀的占位消息
- Body type 从 `ModelMessage[]` 改为 `FrontendMessage[]`

### 1c. 前端 SSE 解析器（新文件 `app/lib/agent/stream-consumer.ts`）

`consumeUIMessageStream(body, onUpdate, signal)` → `Promise<Message>`

- 解析 AI SDK v6 SSE 格式：`d:{json}\n`
- 维护 mutable `parts[]` 和 `toolCalls` Map
- `buildMessage()` 深拷贝所有 parts 后再传给 React（防止 state mutation）
- 每个 `reader.read()` 批次只触发一次 `onUpdate`（防止过度 re-render）
- 支持的 chunk types：`text-start/delta/end`, `tool-input-start/delta/available`, `tool-output-available`, `tool-output-error`, `tool-input-error`, `error`

### 1d. 类型扩展（`app/lib/types.ts`）

```typescript
interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: string;
  state: 'pending' | 'running' | 'done' | 'error';
}
interface TextPart { type: 'text'; text: string; }
type MessagePart = TextPart | ToolCallPart;
interface Message {
  role: 'user' | 'assistant';
  content: string;
  parts?: MessagePart[];  // 新增，可选，向下兼容
}
```

### 1e. Tool Call 可视化组件（新文件 `app/components/ask/ToolCallBlock.tsx`）

可折叠的 tool call 渲染：
- 收起态：图标 + 工具名 + 参数摘要 + 状态（spinner/✓/✗）
- 展开态：完整 JSON input + truncated output
- 16 个工具各有对应 emoji 图标

### 1f. 消息列表适配（`app/components/ask/MessageList.tsx`）

- 新增 `AssistantMessageWithParts`：交替渲染 text + tool call parts
- 最后一个 part 是 running/pending tool-call 时，显示 trailing spinner（"Executing tool…"）
- 无 `parts` 时 fallback 到纯 `content` 渲染

### 1g. AskModal 适配（`app/components/AskModal.tsx`）

- 手动 `reader.read()` + 拼字符串 → `consumeUIMessageStream()`
- 错误处理检查 `parts` 和 `content`（之前只检查 `content`）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/lib/types.ts` | 修改 | 新增 ToolCallPart, TextPart, MessagePart；Message 加 parts 字段 |
| `app/lib/agent/tools.ts` | 修改 | 新增 7 个工具定义 |
| `app/lib/agent/prompt.ts` | 修改 | system prompt 加新工具策略、破坏性操作警告、复杂任务协议 |
| `app/app/api/ask/route.ts` | 修改 | toUIMessageStreamResponse + convertToModelMessages |
| `app/lib/agent/stream-consumer.ts` | **新建** | UIMessageStream SSE 解析器 |
| `app/components/ask/ToolCallBlock.tsx` | **新建** | Tool call 可视化组件 |
| `app/components/ask/MessageList.tsx` | 修改 | AssistantMessageWithParts + trailing spinner |
| `app/components/AskModal.tsx` | 修改 | 使用 consumeUIMessageStream |

## 向下兼容

- `Message.parts` 为可选字段，旧消息（无 parts）仍通过 `content` 渲染
- `ChatSession` 使用 `Message[]`，`parts` 会被序列化到 session 存储
- 加载旧 session（无 parts 的消息）时，`AssistantMessageWithParts` fallback 到纯文本

## 验收标准

- [ ] Agent 可执行 16 个工具（原 9 + 新 7）
- [ ] 前端消息列表中 tool call 显示为可折叠块（图标 + 名称 + 状态）
- [ ] 展开 tool call 可看到 input JSON 和 output
- [ ] 纯文本对话（无 tool call）仍正常渲染
- [ ] 多轮对话中 AI 能正确回忆之前的 tool 调用结果
- [ ] 用户中断（abort）后，已有 tool call 结果保留显示
- [ ] `tsc --noEmit` 和 `next build` 通过
