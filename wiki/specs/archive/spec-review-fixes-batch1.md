# Review Fixes Batch 1 — Code Review 发现项修复

> 来源：Agent Enhancement + Security Hardening 代码 review
> 日期：2026-03-18

## 修复清单

| # | 级别 | 问题 | 文件 | 状态 |
|---|------|------|------|------|
| M1 | 🟡 Major | `compactMessages` 用主模型做摘要，浪费 tokens + 占用 rate limit | `context.ts` | ✅ 加注释 |
| M6 | 🟡 Major | `compactMessages` split 可能切断 assistant-tool 对 → Anthropic 400 | `context.ts` | ✅ 已修 |
| M5 | 🟢 Minor | `MessageList.tsx` 保留废弃 `maxSteps` prop | `MessageList.tsx` | ✅ 已删 |
| N1 | 🟢 Minor | `ToolCallBlock` destructive 列表缺 `rename_file` | `ToolCallBlock.tsx` | ✅ 已修 |
| N2 | 🟢 Minor | `ThinkingBlock` "Thinking" 硬编码英文，缺 i18n | `ThinkingBlock.tsx` | ✅ 已修 |
| N3 | 🟢 Minor | `MODEL_LIMITS` prefix 匹配顺序脆弱 | `context.ts` | ✅ 已修 |
| N4 | 🟢 Minor | `AiTab.tsx` Agent Behavior 区域缺 i18n | `AiTab.tsx` | ✅ 已修 |

---

## M1: compactMessages 用主模型做摘要

### 问题

`compactMessages(modelMessages, model)` 直接复用主模型（如 `claude-sonnet-4-20250514`）。摘要任务只需提取要点，不需要强推理能力。

**影响：**
- 成本：摘要消耗与正常请求相同价格的 tokens
- Rate limit：占用主模型配额，高频对话时可能触发限流
- 延迟：大模型摘要比小模型慢

### 方案

在 `compactMessages` 中引入独立的 compact model 逻辑：

1. 新增 `AgentConfig.compactModel` 配置项（可选，默认回退到主模型）
2. `route.ts` 构建 compact model 实例，传入 `compactMessages`
3. 如果用户未配置 compact model，仍用主模型（行为不变，向后兼容）

**改动范围：**
- `app/lib/settings.ts` — `AgentConfig` 加 `compactModel?: string`
- `app/lib/agent/context.ts` — `compactMessages` 签名不变，调用者传不同 model
- `app/app/api/ask/route.ts` — 构建 compact model 时优先用配置的小模型

**暂缓理由：** 当前用户量小，compact 触发频率低（>70% context 才触发）。记为 backlog，等用户反馈 rate limit 问题再实现。

**本轮处理：** 加代码注释说明 trade-off，不改逻辑。

---

## M6: compactMessages split 切断 assistant-tool 对

### 问题

```typescript
const splitIdx = messages.length - 6;
const earlyMessages = messages.slice(0, splitIdx);
const recentMessages = messages.slice(splitIdx);
```

固定取最后 6 条消息。如果第 6 条（从末尾数）是 `tool` 角色消息，它的前置 `assistant`（含 tool-call）被切到 earlyMessages 里摘要掉了。`recentMessages` 以孤立的 `tool` 开头 → Anthropic API 拒绝。

### 方案

split 后向前调整，确保不切在 assistant-tool 对中间：

```typescript
let splitIdx = messages.length - 6;
// Don't split between assistant (with tool calls) and its tool result.
// Only need to check for orphaned 'tool' messages — an assistant message
// at the split point is safe because its tool results follow it in recentMessages.
// (Orphaned assistants without results can't exist in history: only completed
// tool calls are persisted by the frontend.)
while (splitIdx > 0 && messages[splitIdx]?.role === 'tool') {
  splitIdx--;
}
// Safety: ensure at least 2 early messages to justify compaction
if (splitIdx < 2) {
  return { messages, compacted: false };
}
```

**改动范围：** `app/lib/agent/context.ts` — `compactMessages` 函数内，splitIdx 计算之后加 3 行。

---

## M5: MessageList.tsx 废弃 maxSteps prop

### 问题

`maxSteps` prop 在接口中保留但标记 `// deprecated`，实际已无调用方传入。StepCounter 组件也不再使用。

### 方案

移除 `MessageListProps.maxSteps` 和组件参数中的 `maxSteps`。

**改动范围：** `app/components/ask/MessageList.tsx` — 删除 interface 中的 `maxSteps` 字段和函数参数。

---

## N1: ToolCallBlock destructive 列表缺 rename_file

### 问题

```typescript
const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'move_file', 'write_file']);
```

`rename_file` 改变文件身份（路径变化），与 `move_file` 性质相同但未标记为 destructive。

### 方案

加入 `rename_file`：

```typescript
const DESTRUCTIVE_TOOLS = new Set(['delete_file', 'move_file', 'rename_file', 'write_file']);
```

**改动范围：** `app/components/ask/ToolCallBlock.tsx` — 1 行。

---

## N2: ThinkingBlock "Thinking" 硬编码英文

### 问题

```tsx
<span>Thinking</span>
```

App 其他组件用 `t.ask.*` i18n 键。中文用户看到英文 "Thinking"。

### 方案

i18n.ts 中 `ask` 已有 `thinking: 'Thinking...'` / `'思考中...'`，但用途是 loading 状态文案，不适合复用。新增专用 key：

1. `app/lib/i18n.ts` 中 `ask` 下新增：
   - `thinkingLabel: 'Thinking'`（en）
   - `thinkingLabel: '思考中'`（zh）

2. ThinkingBlock 内部用 `useLocale()` 获取 label

**选择 useLocale() 方式**（而非 props 传入）：
- props 需穿透 3 层（MessageList → AssistantMessageWithParts → ThinkingBlock），收益为零
- `ToolCallBlock` 将来如需 i18n 也会用 context，保持一致
- 组件树中 LocaleContext 已全局可用

**改动范围：**
- `app/lib/i18n.ts` — 加 2 个 key（en + zh）
- `app/components/ask/ThinkingBlock.tsx` — 加 `useLocale()` + 替换硬编码

---

## N3: MODEL_LIMITS prefix 匹配顺序脆弱

### 问题

```typescript
const MODEL_LIMITS: Record<string, number> = {
  'claude': 200_000,
  'gpt-4o': 128_000,
  'gpt-4': 128_000,
  ...
};
```

`Object.entries` 按插入序遍历。当前 `gpt-4o` 在 `gpt-4` 前面所以能正确匹配。但如果有人调整顺序或加新 entry，`gpt-4` 会错误匹配 `gpt-4o-*` 模型名。

### 方案

按 prefix 长度降序排序后匹配，最长优先：

```typescript
const MODEL_LIMIT_ENTRIES = Object.entries(MODEL_LIMITS)
  .sort((a, b) => b[0].length - a[0].length);

export function getContextLimit(model: string): number {
  const lower = model.toLowerCase();
  for (const [prefix, limit] of MODEL_LIMIT_ENTRIES) {
    if (lower.includes(prefix)) return limit;
  }
  return 100_000;
}
```

**改动范围：** `app/lib/agent/context.ts` — `getContextLimit` 函数，~5 行。

---

## N4: AiTab Agent Behavior 区域缺 i18n

### 问题

Agent Behavior 区域所有 label/hint 为硬编码英文：
- "Agent Behavior"
- "Max Steps" / "Maximum tool call steps per request (1-30)"
- "Context Strategy" / "Auto: summarize early messages..."
- "Extended Thinking" / "Show Claude's reasoning process..."
- "Thinking Budget" / "Max tokens for reasoning (1000-50000)"

### 方案

在 `app/lib/i18n.ts` 的 `settings` 下新增 `agent` 命名空间（与后端 `AgentConfig` 对齐，不放在 `settings.ai` 下）：

```typescript
settings: {
  // ...existing ai, knowledge, etc.
  agent: {
    title: 'Agent Behavior',
    maxSteps: 'Max Steps',
    maxStepsHint: 'Maximum tool call steps per request (1-30)',
    contextStrategy: 'Context Strategy',
    contextStrategyHint: 'Auto: summarize early messages when context fills up. Off: no summarization.',
    contextStrategyAuto: 'Auto (compact + prune)',
    contextStrategyOff: 'Off',
    thinking: 'Extended Thinking',
    thinkingHint: "Show Claude's reasoning process (uses more tokens)",
    thinkingBudget: 'Thinking Budget',
    thinkingBudgetHint: 'Max tokens for reasoning (1000-50000)',
  },
}
```

中文版同步翻译。

**改动范围：**
- `app/lib/i18n.ts` — en/zh 各加 ~10 个 key
- `app/components/settings/AiTab.tsx` — 替换硬编码字符串

---

## 执行顺序

1. **M6** — compact split 修复（防 API 400，最高优先）
2. **N3** — prefix 匹配排序（防未来误匹配）
3. **M1** — 加注释说明 trade-off（不改逻辑）
4. **M5** — 删废弃 prop
5. **N1** — 加 rename_file
6. **N2 + N4** — i18n 批量处理（涉及同一个 i18n.ts 文件）

## 验证

- `cd app && npx tsc --noEmit` 无新增错误
- Agent GUI 发送 50+ 条消息 → compact 不报 400
- 切换中英文 → Agent Behavior / ThinkingBlock 显示正确语言
- 破坏性工具（delete/move/rename/write）均显示 amber 高亮
