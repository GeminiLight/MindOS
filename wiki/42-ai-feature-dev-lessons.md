# AI 功能开发经验沉淀

> 来自 AI Organize 功能多轮迭代的教训。目标：让未来类似功能一轮搞定。

## 教训 1：给 AI Agent 的 Prompt 必须是指令式，不能是描述式

**多轮交互过程：** 用户报告"上传什么文件 AI 都不做任何更改"→ 排查整条数据链路（文件读取 → hook → API → SSE → 工具调用）→ 最终发现 AI 只回复了文字，从未调用写工具。

**根因：** Prompt 写的是 `"请阅读 xxx，提取关键信息整理到知识库中合适的位置"`。AI 理解为"分析内容并告诉用户结果"，只输出 `text_delta`，不调用任何写工具。

**修复前后对比：**

| 修复前（描述式） | 修复后（指令式） |
|---|---|
| 请阅读 xxx，提取关键信息整理到知识库中合适的位置 | 你**必须**：1. 读取内容 2. 整理为 Markdown 3. **保存到知识库** — 不要只做文字回复 |

**规则：**
- 凡是需要 AI Agent 执行工具操作的 prompt，必须包含 **"你必须"** + **动作动词**（保存/创建/写入/更新/删除）
- 末尾加 **反面约束**：`不要只做文字回复。你必须实际写入知识库。`
- 如果有目标位置，明确传入（如 `targetSpace`），不要让 AI 猜

## 教训 2：Prompt 中不要限定具体工具名

**多轮交互过程：** 第一版修复写了 `"使用 create_file 工具"`，用户指出 AI 也可能需要 `update_section`、`insert_after_heading`、`append_to_file` 等方式。

**规则：**
- 描述期望结果（`保存到知识库——可以创建新文件，也可以更新已有文件`），不要写具体工具名
- AI Agent 有工具列表和描述，它会自己选择合适的工具

## 教训 3：Modal 标题必须区分所有终态

**多轮交互过程：** 用户截图 → AI Organize 网络错误，但标题仍显示"整理完成"→ 用户困惑。

**根因：** 标题渲染逻辑没有区分 `phase === 'error'` 和 `phase === 'done'`，都走了 `organizeReviewTitle`。

**规则：**
- Modal/Dialog 有多个终态时（成功/失败/空结果），标题文案必须逐一映射
- 自检 checklist：枚举所有 `phase` 值 × 所有 `step` 值的组合，每个组合的标题是否正确？

```
step=organize_review × phase=done    → "整理完成" ✅
step=organize_review × phase=error   → "整理失败" ✅（之前漏了）
step=organize_review × phase=done + changes=0 → "整理完成"（body 说明无更改）
```

## 教训 4：AI 输出必须过滤内部标签

**多轮交互过程：** 用户截图 → "no changes" 状态下显示了 AI 的 `<thinking>` 标签和英文内部推理。

**根因：** `text_delta` 事件包含 AI 的 `<thinking>...</thinking>` 内容，直接拼接到 `summary` 后展示给用户。

**规则：**
- 所有面向用户的 AI 输出（summary、description 等）必须经过 `stripThinkingTags()` 清洗
- 正则：`/<thinking>[\s\S]*?<\/thinking>/gi`（完整块）+ `/<thinking>[\s\S]*$/gi`（未闭合的尾部）
- 全局扫描：`grep -r "summary" --include="*.tsx"` 找到所有展示 AI 文本的地方，确认都有清洗

## 教训 5：长时间异步操作必须有分阶段反馈

**多轮交互过程：** 用户报告"AI 正在分析和整理你的文件... 这个时间很长，用户完全无感知"。

**根因：** Organizing 阶段只有静态文案 + spinner。AI 在分析/思考阶段（10-30s）没有 `tool_start` 事件，UI 完全静止。

**方案模板（适用于任何 SSE 长操作）：**

| 组件 | 作用 | 实现 |
|------|------|------|
| **分阶段文案** | 告诉用户"在干嘛" | 从 SSE 事件类型推断 stage（text_delta→分析, tool_start→读取/写入） |
| **经过时间** | 证明"没卡死" | `setInterval` 每秒 +1，`tabular-nums` 防抖 |
| **Thinking 超时** | 填补无事件空窗 | 5s 无事件 → 显示"AI 正在深度思考..." |
| **取消按钮** | 给用户逃生通道 | 调用 `AbortController.abort()` |

**规则：**
- 任何可能超过 3s 的异步操作，必须有动态反馈（不能只是 spinner + 静态文案）
- 如果有 SSE/WebSocket 流，从事件中提取阶段信息给用户
- 始终提供取消/中断能力

## 教训 6：纯函数提取 = 可测试

**经验：** `deriveStageHint(eventType, toolName, args)` 作为纯函数从 `consumeOrganizeStream` 中提取出来，可以独立写 10 个单元测试，不需要 mock SSE 流。

**规则：**
- 涉及映射/转换逻辑时，优先提取为纯函数（输入 → 输出，无副作用）
- 纯函数放在 hook 文件中 `export`，测试直接 import 调用
- Hook 内部只负责状态管理和调用纯函数

## 速查：AI 功能 Code Review Checklist

新增/修改 AI 功能时逐条过：

- [ ] Prompt 是否指令式？是否有明确的动作要求？
- [ ] Prompt 是否避免了限定具体工具名？
- [ ] 所有面向用户的 AI 输出是否经过 `stripThinkingTags()` 清洗？
- [ ] Modal/Dialog 标题是否覆盖了所有终态（成功/失败/空/取消）？
- [ ] 长时间操作是否有分阶段动态反馈？
- [ ] 是否提供了取消/中断能力？
- [ ] 映射/转换逻辑是否提取为可测试的纯函数？
