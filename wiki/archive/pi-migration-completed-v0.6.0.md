# Spec: Migrate App Agent to pi-agent-core

> Status: ✅ Implemented (v0.6.0)
> Author: geminitwang + claude
> Date: 2026-03-20

## 目标

将 MindOS Web App 的 agent 从 Vercel AI SDK（`streamText` + `ai/tool`）迁移到 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`，获得：状态机管理、tool hooks、中断/转向、统一多 provider、更细粒度的事件流。

## 现状分析

### 当前架构（Vercel AI SDK）

```
前端                         后端 (Next.js API Route)
──────────                   ──────────────────────────
AskModal.tsx                 POST /api/ask
  ↓ fetch(/api/ask)            ↓
  ↓                          1. 读 SKILL.md + bootstrap 文件
  ↓                          2. 拼接 system prompt（5 层）
  ↓                          3. convertToModelMessages() — 前端 Message[] → AI SDK ModelMessage[]
  ↓                             ↓ 脏活：orphaned tool call 补空 result、reasoning 过滤、parts 展开
  ↓                          4. truncateToolOutputs() — 压缩历史 tool 输出
  ↓                          5. compactMessages() — 超 70% context 时 LLM 摘要
  ↓                          6. hardPrune() — 超 90% context 时丢弃早期消息
  ↓                          7. streamText({ model, system, messages, tools })
  ↓                             ↓ onStepFinish: loop 检测
  ↓                             ↓ prepareStep: 注入 loop 警告
  ↓                          8. result.toUIMessageStreamResponse() → SSE
  ↓ SSE (d:{json}\n)
stream-consumer.ts
  ↓ 解析 text-delta / tool-input / tool-output / reasoning
  ↓ 构建 Message { parts: [TextPart, ToolCallPart, ReasoningPart] }
  ↓
React state (messages[])
```

### 涉及文件（9 个核心文件）

| 文件 | 行数 | 职责 |
|------|------|------|
| `app/api/ask/route.ts` | 343 | API 路由：context 加载、prompt 拼接、streamText 调用 |
| `lib/agent/model.ts` | 18 | Model factory（OpenAI / Anthropic） |
| `lib/agent/tools.ts` | ~350 | 15 个 tool 定义（Zod schema + execute） |
| `lib/agent/prompt.ts` | 47 | System prompt 常量 |
| `lib/agent/context.ts` | 317 | Token 估算、truncate、compact、hardPrune |
| `lib/agent/log.ts` | 44 | Agent op 日志（JSONL） |
| `lib/agent/stream-consumer.ts` | 214 | 前端 SSE 解析器 |
| `lib/agent/index.ts` | 7 | Re-exports |
| `hooks/useAskSession.ts` | ~200 | Session 管理（与 agent 无关，不改） |

### 当前依赖

```
"ai": "^6.0.116"                — Vercel AI SDK (streamText, tool, ModelMessage, etc.)
"@ai-sdk/anthropic": "^3.0.58" — Anthropic provider
"@ai-sdk/openai": "^3.0.41"    — OpenAI provider
"zod": "^3.23.8"                — Tool parameter validation
```

### 当前痛点

1. **无 Agent 抽象**：手动 `streamText()` + `onStepFinish` 拼凑 agent loop，状态管理散落在闭包中
2. **无 tool hooks**：tool 安全检查（`assertWritable`）只能嵌在每个 tool 的 execute 里
3. **不可中断**：用户无法在 agent 执行 tool 时打断
4. **context 管理与 route 耦合**：truncate/compact/prune 逻辑混在 API route 里
5. **SSE 格式由 AI SDK 决定**：前端 `stream-consumer.ts` 强绑 AI SDK 的 `d:{json}` 格式
6. **loop 检测是 hack**：`prepareStep` 注入假 user message 来警告 loop

---

## 方案

### Agent 实例生命周期

**v1 采用 per-request 模式**：每次 POST /api/ask 创建新 Agent，request 结束销毁。

```
POST /api/ask
  ↓ 前端传入 messages[]
  ↓ new Agent({ initialState: { messages: toAgentMessages(messages), ... } })
  ↓ agent.prompt(lastUserMessage)
  ↓ stream 完成 → Agent GC
```

理由：
- 当前 session 管理在前端（`useAskSession.ts` 持久化 messages 到 server JSON），改为后端 Agent 持久化是另一个大工程
- per-request 与当前 `streamText()` 行为一致，零用户感知风险
- pi 的 `steer()`/`followUp()` 需要长期存活的 Agent 实例，放到 v2 做

**v2 规划（后续）**：per-session Agent Map，支持 steer/followUp，需要解决 GC、重启恢复、多 tab 冲突。

### 新架构（pi-agent-core）

```
前端                            后端 (Next.js API Route)
──────────                      ──────────────────────────
AskModal.tsx                    POST /api/ask
  ↓ fetch(/api/ask)               ↓
  ↓                             1. 读 SKILL.md + bootstrap + skill-rules
  ↓                             2. 拼接 system prompt
  ↓                             3. 两层消息转换
  ↓                                a. toAgentMessages() — 前端 Message[] → AgentMessage[]
  ↓                                   （orphaned tool call 补空 result、reasoning 过滤、parts 展开）
  ↓                                b. convertToLlm — AgentMessage[] → pi-ai Message[]
  ↓                                   （交给 Agent 内部自动调用）
  ↓                             4. 创建 Agent 实例（per-request）
  ↓                                const agent = new Agent({
  ↓                                  initialState: { systemPrompt, model, tools, messages },
  ↓                                  transformContext,    ← compact + prune
  ↓                                  convertToLlm,       ← AgentMessage → LLM Message
  ↓                                  beforeToolCall,      ← 安全检查
  ↓                                  afterToolCall,       ← logging
  ↓                                  toolExecution: 'parallel',
  ↓                                })
  ↓                             5. agent.subscribe(event => SSE push)
  ↓                             6. await agent.prompt(userMessage)
  ↓                             7. Stream 结束，Agent 销毁
  ↓ SSE (MindOS 自定义格式)
stream-consumer.ts (重写)
  ↓ 解析 pi 事件：message_update / tool_execution_* / agent_end
  ↓ 构建 Message { parts: [...] }
  ↓
React state (messages[])
```

### 两层消息转换（明确拆分）

```
前端 Message[]                     ← AskModal 传入
  ↓ toAgentMessages()              ← route.ts 里做（替代当前 convertToModelMessages）
  ↓   - user message: { role: 'user', content, timestamp }
  ↓   - assistant parts → text blocks + tool calls
  ↓   - orphaned tool calls → 补空 toolResult
  ↓   - reasoning parts → 过滤（不送回 LLM）
  ↓
AgentMessage[]                     ← pi-agent-core 内部使用
  ↓ convertToLlm()                 ← Agent 内部自动调用
  ↓   - 可用 defaultConvertToLlm，或自定义
  ↓
pi-ai Message[]                    ← 发给 LLM
```

### 核心映射

| 当前实现 | pi-agent-core 对应 | 改动方式 |
|---------|-------------------|---------|
| `streamText()` loop | `new Agent()` + `agent.prompt()` | 替换 |
| `tool()` + Zod schema | `AgentTool` + TypeBox schema | 重写 tool 定义 |
| `getModel()` (ai-sdk) | `getModel('anthropic', model)` (pi-ai) | 替换 |
| `convertToModelMessages()` | `toAgentMessages()` (第一层，手写) + `convertToLlm` (第二层，pi 内部) | 拆分两层 |
| `truncateToolOutputs()` + `compactMessages()` + `hardPrune()` | `transformContext` hook | 移入 Agent config |
| `onStepFinish` + `prepareStep` loop 检测 | `agent.subscribe('turn_end')` + `agent.steer()` | 事件驱动 |
| `result.toUIMessageStreamResponse()` | `agent.subscribe()` + 自定义 SSE | 重写 |
| `assertWritable()` 散落在 tools | `beforeToolCall` 统一拦截 | 集中 |
| `logged()` wrapper | `afterToolCall` hook | 集中 |
| `generateText()` (compact) | `complete()` from pi-ai | 替换 |

---

## 数据流 / 状态流

### Tool 调用流（改动重点）

```
之前：
  streamText → model 返回 tool call → AI SDK 自动执行 tool.execute()
  → tool 内部 try-catch + logging → 返回 string → AI SDK 继续

之后：
  agent.prompt() → model 返回 tool call
  → beforeToolCall({ toolCall, args })
    → 安全检查（write-protection）
    → 可 block 返回
  → tool.execute(toolCallId, params, signal, onUpdate)
    → 返回 { content: [...], details: {...} }
  → afterToolCall({ toolCall, result })
    → logging
  → agent 继续下一轮
```

### Context 管理流（改动重点）

```
之前：
  route.ts 手动调用：
  messages → truncateToolOutputs() → needsCompact? → compactMessages() → hardPrune() → streamText()

之后：
  Agent 内部在每次 LLM 调用前自动调用 transformContext：
  messages → transformContext(messages, signal)
    → truncateToolOutputs()     ← 适配 AgentMessage 类型
    → needsCompact?
      → compactMessages()       ← 通过闭包拿 model：
                                   const compactModel = agent.state.model;
                                   await complete(compactModel, compactContext);
    → hardPrune()
    → 返回处理后的 AgentMessage[]
  → convertToLlm(messages)
    → 转为 pi-ai 的 Message 格式
  → 发送给 LLM
```

compact 需要 model 实例来调 LLM 做摘要。`transformContext(messages, signal)` 签名没有 model 参数。
解决：Agent 创建时在闭包中 capture model factory，compact 从闭包取。

```typescript
function createTransformContext(getCompactModel: () => Model<any>) {
  return async (messages: AgentMessage[], signal: AbortSignal): Promise<AgentMessage[]> => {
    let result = truncateToolOutputs(messages);
    if (needsCompact(result, systemPrompt, modelName)) {
      result = await compactMessages(result, getCompactModel(), signal);
    }
    return hardPrune(result, systemPrompt, modelName);
  };
}

// 在 route.ts 里：
const agent = new Agent({
  // ...
  transformContext: createTransformContext(() => agent.state.model),
});
```

### SSE 事件流（改动重点）

pi-agent-core 的事件是内部 JS 对象，不会自动变成 SSE。后端需要 `agent.subscribe()` → 格式化 → push 到 `ReadableStream`。

**MindOS SSE 格式定义**（前后端契约）：

```typescript
// 后端 → 前端的 SSE data line 格式
type MindOSSSEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; output: string; isError: boolean }
  | { type: 'done'; usage?: { input: number; output: number; cost?: number } }
  | { type: 'error'; message: string }
```

**后端 SSE 转换**：

```typescript
const encoder = new TextEncoder();
const stream = new ReadableStream({
  start(controller) {
    agent.subscribe((event) => {
      let sse: MindOSSSEvent | null = null;

      if (event.type === 'message_update') {
        const e = event.assistantMessageEvent;
        if (e.type === 'text_delta') {
          sse = { type: 'text_delta', delta: e.delta };
        } else if (e.type === 'thinking_delta') {
          sse = { type: 'thinking_delta', delta: e.delta };
        }
      } else if (event.type === 'tool_execution_start') {
        sse = { type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args };
      } else if (event.type === 'tool_execution_end') {
        sse = { type: 'tool_end', toolCallId: event.toolCallId, output: formatOutput(event.result), isError: event.isError };
      } else if (event.type === 'agent_end') {
        sse = { type: 'done', usage: extractUsage(event) };
      }

      if (sse) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify(sse)}\n\n`));
      }
    });

    agent.prompt(userMessage).then(() => controller.close()).catch(err => {
      controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: 'error', message: err.message })}\n\n`));
      controller.close();
    });
  }
});

return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
});
```

**前端解析**（stream-consumer.ts 重写）：

```
之前：解析 AI SDK 私有格式（d:{json}\n，20+ 种事件类型）
之后：解析 6 种 MindOS 自定义事件，格式完全可控
```

好处：不再绑定任何 SDK 的 SSE 私有格式。未来换 agent 框架，只改后端转换层，前端不动。

---

## 影响范围

### 变更文件

| 文件 | 改动 |
|------|------|
| `lib/agent/model.ts` | **重写**：`@ai-sdk` → `@mariozechner/pi-ai` 的 `getModel()` |
| `lib/agent/tools.ts` | **重写**：Zod → TypeBox，`tool()` → `AgentTool` 接口 |
| `lib/agent/to-agent-messages.ts` | **新建**：前端 Message[] → AgentMessage[]（从 route.ts 抽出） |
| `lib/agent/context.ts` | **重构**：`ModelMessage` → `AgentMessage`，`generateText` → `complete` |
| `lib/agent/prompt.ts` | **不变**（system prompt 内容不改） |
| `lib/agent/log.ts` | **微调**：entry 类型适配新 tool result 格式 |
| `lib/agent/stream-consumer.ts` | **重写**：解析 MindOS 自定义 SSE 格式（6 种事件） |
| `lib/agent/index.ts` | **更新** re-exports |
| `app/api/ask/route.ts` | **大幅重写**：streamText → Agent 实例化 + subscribe → SSE |
| `components/AskModal.tsx` | **微调**：适配新 SSE 消费接口 |
| `package.json` | **更新依赖**（移除 ai-sdk，新增 pi） |

### 不受影响的模块

| 模块 | 原因 |
|------|------|
| `hooks/useAskSession.ts` | 只管 session CRUD，不碰 agent |
| `lib/fs.ts` | 文件系统操作层，与 agent 无关 |
| `lib/core.ts` | `assertNotProtected` 逻辑不变，调用点从 tool 内部移到 `beforeToolCall` |
| `lib/settings.ts` | 设置读取不变 |
| MCP server (`mcp/`) | 独立进程，不受影响 |
| SKILL.md / skill-rules | 不变 |
| 前端 UI 组件 | Message 类型保持兼容 |

### 破坏性变更

- **无**。前端 `Message` 类型不变（`role` + `content` + `parts`），只是 SSE 解析逻辑重写。用户无感知。

---

## 边界 case 与风险

### 边界 case

1. **Tool 执行超时**：pi-agent-core 的 tool execute 接收 `signal: AbortSignal`，需要在 fs 操作中传递
2. **并发 tool 调用**：设为 `toolExecution: 'parallel'`，但 fs 写操作可能冲突 → `beforeToolCall` 对写操作串行化
3. **流中断**：用户关闭页面 → `agent.abort()` → tool 收到 signal → 清理
4. **provider 切换**：pi-ai 的 `getModel()` 支持运行时切换，但 API key 管理要适配 `getApiKey` hook
5. **thinking/reasoning**：pi-agent-core 内置 `thinkingLevel`，替代当前手动拼的 `providerOptions.anthropic.thinking`
6. **compact 用的 model**：通过闭包 capture `agent.state.model`，在 `transformContext` 内部调 `complete()` 做摘要
7. **loop 检测**：`beforeToolCall` 是 per-call 粒度，没有跨步骤历史。正确做法：`agent.subscribe('turn_end')` 在闭包维护 `stepHistory[]`，检测到 loop 后调 `agent.steer()` 注入警告（比 `prepareStep` hack 更优雅）
8. **orphaned tool calls**：前端可能传来 stream 中断导致的 running/pending tool call（无 output）。`toAgentMessages()` 必须补空 toolResult，否则 LLM API 拒绝请求
9. **`ai` 包残留引用**：`context.ts` 的 `generateText` import、`ModelMessage` 类型引用等。Phase 5 必须 `grep 'from .ai' app/` 确认零残留

### 风险

| 风险 | 缓解 |
|------|------|
| pi v0.60，API 可能 breaking | pin 确切版本（如 `0.60.0`），升级前测试 |
| TypeBox 替代 Zod | TypeBox 是 pi 的标准，必须迁移。两者能力等价，机械替换 |
| pi-ai 不提供 token counting | 保留现有 char/4 估算（已够用），pi-ai 的 `usage` 字段可用于 post-hoc 统计 |
| SSE 格式变化影响前端 | 定义 MindOS 自己的 SSE 格式（6 种事件），前后端解耦于任何 SDK |
| `transformContext` 内部需要异步 LLM 调用（compact） | pi 的 transformContext 是 async，通过闭包 capture model |
| OpenAI baseURL 自定义 | Phase 1 第一步验证。若 pi-ai 不支持，通过 `streamFn` 自定义 proxy 或 fork |
| `ai` 包残留引用导致两套 SDK 共存 | Phase 5 用 grep 验证零残留后再移除依赖 |

---

## 验收标准

### 功能对等
- [x] 所有 15 个 tool 功能不变（list/read/write/create/delete/rename/move/append/insert/update/search/recent/backlinks/history/csv）
- [x] System prompt 内容不变
- [x] Context 管理三阶段（truncate → compact → prune）效果不变
- [x] Thinking/reasoning 在 Anthropic provider 下正常工作
- [x] OpenAI provider 正常工作（含 baseURL 自定义）
- [x] Tool 执行 error 不会 crash stream
- [x] Loop 检测功能保留（3 次重复→警告）
- [x] 前端 Message 类型兼容（TextPart + ToolCallPart + ReasoningPart）
- [x] 用户中断（abort）正常工作

### 迁移彻底
- [x] `grep -r "from 'ai'" app/lib/` — 零匹配
- [x] `grep -r "@ai-sdk" app/` — 零匹配
- [x] `package.json` 无 `ai` / `@ai-sdk/*` 依赖
- [x] SSE 格式为 MindOS 自定义（不绑定任何 SDK 私有协议）

### 测试
- [ ] `npm test` 通过（测试文件需适配新 AgentMessage 签名）
- [ ] 手动 E2E 测试矩阵 10 项全部通过（见 Phase 5）

---

## 依赖变更

### 移除

```
"ai": "^6.0.116"
"@ai-sdk/anthropic": "^3.0.58"
"@ai-sdk/openai": "^3.0.41"
```

### 新增

```
"@mariozechner/pi-agent-core": "^0.60.0"
"@mariozechner/pi-ai": "^0.60.0"
"@sinclair/typebox": "^0.34.0"    ← pi 的 tool schema 标准
```

### 保留

```
"zod": "^3.23.8"     ← 其他地方可能用到，暂不移除
```

---

## 实现步骤

### Phase 0：验证可行性（spike）

0. 安装 `@mariozechner/pi-ai`，在独立脚本中测试：
   - `getModel('openai', modelName)` 是否支持 `baseURL` 自定义
   - `getModel('anthropic', modelName)` + `complete()` + `stream()` 基本工作
   - `AgentTool` 的 execute 签名和 error 行为
   - 确认 `@sinclair/typebox` 版本兼容

   **Gate**：如果 baseURL 自定义不支持，需要评估 workaround 再继续。

### Phase 1：基础替换（model + tools）

1. 安装新依赖 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` + `@sinclair/typebox`
2. 重写 `lib/agent/model.ts`：`getModel('anthropic', modelName)` / `getModel('openai', modelName)`
   - 适配 `getApiKey` hook 或直接传 apiKey
   - OpenAI baseURL 通过 spike 确认的方式配置
3. 重写 `lib/agent/tools.ts`：15 个 tool 从 `tool()` + Zod → `AgentTool` + TypeBox
   - execute 签名：`(toolCallId, params, signal, onUpdate) => AgentToolResult`
   - 返回 `{ content: [{ type: 'text', text: resultString }], details: { ... } }`
   - 移除内联 `assertWritable()`（Phase 4 移到 beforeToolCall）
   - 移除 `logged()` wrapper（Phase 4 移到 afterToolCall）
   - **暂时保留** try-catch error handling 直到 Phase 4

### Phase 2：Agent 核心（route + context）

4. 新建 `lib/agent/to-agent-messages.ts`：前端 Message[] → AgentMessage[]
   - 从当前 `convertToModelMessages()` 迁移逻辑
   - 处理 orphaned tool calls（补空 toolResult）
   - 过滤 reasoning parts
5. 重构 `lib/agent/context.ts`：
   - 所有类型从 `ModelMessage` 改为 `AgentMessage`
   - `compactMessages()` 内部 `generateText()` → `complete()` from pi-ai
   - 导出 `createTransformContext()` 工厂函数（闭包 capture model）
6. 重写 `app/api/ask/route.ts`：
   - `toAgentMessages()` 转换前端消息
   - 创建 per-request Agent 实例
   - 配置 `transformContext`、`convertToLlm`（用 `defaultConvertToLlm` 或自定义）
   - `agent.subscribe()` → MindOS SSE 格式 → `ReadableStream`
   - `agent.prompt()` → 等待完成 → `controller.close()`
   - 错误处理

### Phase 3：前端适配

7. 重写 `lib/agent/stream-consumer.ts`：解析 MindOS SSE 格式（6 种事件）
   - `text_delta` → TextPart
   - `thinking_delta` → ReasoningPart
   - `tool_start` + `tool_end` → ToolCallPart
   - `done` → 最终 Message
   - `error` → 错误显示
8. 更新 `components/AskModal.tsx`：适配新 SSE 消费接口（如果签名变化）

### Phase 4：增强（利用 pi 新能力）

9. `agent.abort()` 集成到前端 abort 逻辑
10. Loop 检测：`agent.subscribe('turn_end')` + 闭包 `stepHistory[]` + `agent.steer()` 警告
11. 写保护统一到 `beforeToolCall`（对所有写 tool 名检查 `assertNotProtected`）
12. Logging 统一到 `afterToolCall`（替代散落在 15 个 tool 里的 `logged()` wrapper）
13. Thinking level 用 `agent.setThinkingLevel()` 配置（替代手动 `providerOptions`）

### Phase 5：清理与验证

14. `grep -r "from 'ai'" app/lib/` — 确认 `ai` 包零残留引用
15. `grep -r "@ai-sdk" app/` — 确认 provider 包零残留引用
16. 移除 AI SDK 依赖（`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`）
17. 移除 `zod` 如果无其他使用方（`grep -r "from 'zod'" app/`）
18. 更新 `lib/agent/index.ts` re-exports
19. `npm test` 全部通过
20. 手动 E2E 测试矩阵：

| 测试场景 | 验证点 |
|---------|-------|
| 简单问答 | text streaming 正常 |
| 读文件 | tool call + result 显示 |
| 写文件 | write-protection 拦截 + 正常写入 |
| 多 tool 调用 | 并行执行 + 结果正确 |
| 长会话 | compact 触发 + 消息不丢失 |
| Anthropic thinking | reasoning 部分正确显示 |
| 用户中断 | abort 不 crash |
| Tool 报错 | error 不 crash stream |
| Loop | 3 次重复后警告 |
| OpenAI provider | 切换 provider 正常工作 |

---

## 不做的事（v1）

- **不改 MCP server**：MCP 是独立进程，用自己的 SDK，不受影响
- **不改 Message 类型**：前端的 `Message` / `MessagePart` 类型保持不变
- **不改 session 管理**：`useAskSession.ts` 不碰
- **不改 SKILL.md / skill-rules**：规则层不变
- **不做 per-session Agent**：v1 是 per-request，无 steer/followUp
- **不做 pi-web-ui**：暂不用 pi 的前端组件库，保持现有 UI
- **不做 Google/xAI/Mistral provider**：只迁移 OpenAI + Anthropic，其他 provider 作为后续增强

## 后续规划（v2）

- **per-session Agent Map**：后端维持 Agent 实例，支持 steer/followUp/中途转向
- **更多 provider**：Google Gemini、xAI 等（pi-ai 已内置支持）
- **tool streaming**：利用 `onUpdate` 在 tool 执行中 push 进度（如大文件读取进度条）
- **pi-web-ui 组件**：评估替换自研 chat UI
