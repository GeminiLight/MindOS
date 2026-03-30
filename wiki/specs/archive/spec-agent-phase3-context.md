# SPEC: Agent Phase 3 — 上下文管理

> Token 估算 + 自动裁剪 + 会话 Compact，防止长对话 token 溢出。

## 动机

当前每次请求带全量 messages，无任何 token 控制。长对话（尤其包含多次 tool call 的结果）会快速逼近 context limit，导致 API 报错或被截断。

## 设计决策

| 决策 | 选项 | 结论 |
|------|------|------|
| Token 估算方式 | tiktoken 精确计算 vs 字符数近似 | **字符数近似**（1 token ≈ 4 chars）。不引入 tiktoken 依赖，精度够用于裁剪决策 |
| 裁剪时机 | 前端发送前 vs 后端收到后 | **后端收到后**。前端不需要知道 token 逻辑 |
| 裁剪策略 | AI SDK `pruneMessages()` vs 手动实现 | **先调研 `pruneMessages()`**，若 API 不满足需求则手动：保留 system + 最近 N 轮 + 早期轮摘要 |
| Compact 触发 | 消息条数 vs token 估算 | **token 估算 > 70% context limit**。条数不可靠（短消息 50 条可能才 5k tokens，一条 tool output 可能 10k tokens） |
| Compact 方式 | 前 N 条替换为 LLM 摘要 vs 直接截断 | **LLM 摘要**。保留关键上下文，比截断信息损失小 |
| Compact 模型 | 用户配置模型 vs 专用小模型 | **复用用户配置模型**。不引入额外模型配置，compact prompt 本身很短，成本可控 |
| Compact 执行位置 | 后端同步（请求中） vs 异步 API | **后端同步**。在 `route.ts` 中检测 → compact → 再调 `streamText`。延迟可接受 |
| Compact 持久化 | 写回前端 session vs 仅请求内生效 | **仅请求内生效**。后端无法直接写回前端 session storage，前端仍保留完整消息用于展示。compact 只影响发给 AI 的 messages |

## 变更范围

### 3a. Token 估算工具（新文件 `app/lib/agent/context.ts`）

```typescript
/** Rough token estimate: 1 token ≈ 4 chars */
export function estimateTokens(messages: FrontendMessage[]): number

/** Context limit by model family */
export function getContextLimit(model: string): number
// claude-sonnet → 200k, gpt-4o → 128k, default → 100k

/** Check if messages exceed threshold */
export function needsCompact(messages: FrontendMessage[], model: string, threshold?: number): boolean
// threshold default 0.7 (70%)
```

### 3b. 自动裁剪（`route.ts`）

在 `convertToModelMessages` 之后、`streamText` 之前：

1. `estimateTokens(messages)` 估算当前 token 数
2. 如果 > 70% context limit：
   - 尝试 `pruneMessages()`（如果 AI SDK 提供）
   - 否则手动裁剪：保留 system + 最近 6 轮 + 将更早的消息压缩为单条 summary
3. 如果裁剪后仍 > 90%：截断最早的消息（硬裁剪兜底）

### 3c. 会话 Compact（`route.ts` 或新 API）

当 `needsCompact` 为 true 时：
1. 取前 N 条消息（占总量的 60%）
2. 用用户配置的同一模型（`getModel()`）生成摘要，compact prompt: "Summarize the key points, decisions, and file operations from this conversation in under 500 words."
3. 替换为单条 `{ role: 'assistant', content: '[Summary of earlier conversation]\n...' }`
4. 仅在当前请求的 `modelMessages` 中替换，**不持久化**。前端 session 保留完整消息用于展示

**前端指示**：compact 后在消息列表中显示 "Earlier messages summarized" 分隔线。

### 3d. Tool output 截断（按类型差异化）

长 tool output 在历史消息中占大量 token。在 `convertToModelMessages` 中对非最后一轮的 tool output 差异化截断：

| Tool 类型 | 截断阈值 | 理由 |
|-----------|----------|------|
| `search`, `list_files`, `get_recent` | 500 chars | 列表类结果，历史轮只需知道"找到了什么" |
| `read_file`, `get_file_at_version` | 2000 chars | 文件内容有上下文价值，但不需要全文 |
| `write_file`, `create_file`, `delete_file`, `rename_file`, `move_file`, `append_to_file`, `insert_after_heading`, `update_section`, `append_csv` | 200 chars | 写操作只需知道成功/失败 |
| `get_backlinks`, `get_history` | 500 chars | 同列表类 |

最后一轮的 tool output 保持完整（当前上下文需要）。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/lib/agent/context.ts` | **新建** | token 估算 + needsCompact + compact 逻辑 |
| `app/app/api/ask/route.ts` | 修改 | 裁剪/compact 管道 |
| `app/lib/agent/index.ts` | 修改 | barrel export context 模块 |
| `app/components/ask/MessageList.tsx` | 修改 | compact 分隔线 UI |
| `app/lib/types.ts` | 修改 | Message 可能新增 `compacted?: boolean` 标记 |

## 不做的事

- **精确 token 计算**：不引入 tiktoken，字符近似够用
- **用户侧配置 context 策略**：Phase 4 加 Settings
- **自动 compact 触发的前端提示**：静默执行，不弹确认

## 验收标准

- [ ] 50+ 轮对话（含多次 tool call）不报 token 溢出错误
- [ ] 后端日志输出 token 估算值和裁剪决策
- [ ] compact 后早期消息以摘要形式保留（非直接删除）
- [ ] 历史 tool output 在传给 AI 前被截断，减少 token 占用
- [ ] `tsc --noEmit` 通过
