# Spec: Active Memory（自动知识召回）

> 创建日期：2026-04-12
> 状态：Draft - Pending Review

## 1. 概述

### 1.1 问题陈述

MindOS 作为知识库产品，当前存在一个核心体验缺陷：**用户必须手动告诉 Agent 去搜索知识库**。

当前流程：
```
用户: "我们上次讨论的技术选型是什么？"
Agent: （如果决定搜索）调用 search 工具搜索 "技术选型"
→ 返回结果
Agent: 根据搜索结果回答
```

问题：
1. Agent 可能**不搜索直接编造**（最常见失败模式）
2. 即使搜索了，也多一个 tool call round trip（+1~3s 延迟）
3. 搜索返回的 snippet 只有 ~400 字符，上下文不足

**目标流程（Active Memory）**：
```
用户: "我们上次讨论的技术选型是什么？"
系统: [自动搜索知识库，读取相关段落，注入到 Agent context]
Agent: [直接看到相关笔记原文，立即基于原文回答]
```

### 1.2 需求澄清

**Why?（YAGNI check）**
- 知识库产品的核心差异化——Agent 应该**默认知道**用户的笔记内容
- OpenClaw 2026.4.10 已加入 Active Memory（sub-agent 方案，见下方对比）
- 当前最大失败模式：Agent 不搜索直接编造，用户无法信任

**Simpler?（KISS check）**
- 最简方案：在 system prompt 组装时插入一步 `hybridSearch()`
- 复用现有搜索引擎，不新建索引
- **不引入 sub-agent**（与 OpenClaw 不同），直接注入原文段落

### 1.3 OpenClaw 对比分析

| 维度 | OpenClaw Active Memory | MindOS Active Recall（本方案） |
|------|----------------------|-------------------------------|
| **召回方式** | LLM sub-agent 决定召回什么 | hybridSearch 直接搜索 |
| **注入内容** | sub-agent 生成的 1 句话总结（≤220 字符） | 知识库原文段落（≤3000 tokens） |
| **延迟** | +3~15s（额外 LLM 调用） | +50~300ms（本地搜索） |
| **成本** | 每次回复多一次 API 调用 | 零额外 API 成本 |
| **召回质量** | 更"智能"，但会丢失原文细节 | 原文忠实，但可能不完全匹配意图 |
| **适用场景** | 通用 AI 助手（记住偏好/习惯） | 知识库产品（注入笔记原文） |

**为什么不用 sub-agent 方案**：MindOS 的核心价值是"让 Agent 基于你的笔记回答"，用户需要看到的是原文引用而非 LLM 总结。220 字符的总结会丢失笔记中的关键细节（表格、代码块、数据等）。直接注入原文段落更忠实，且延迟只有 50ms 而非 5s。

### 1.4 关键假设

1. **用户最后一条消息是最佳搜索词**：不做查询改写（query rewriting），直接用原文搜索
2. **Top-5 文件 × ~600 字符/文件 ≈ 3000 tokens**：足够提供有用上下文
3. **默认开启**：作为知识库产品的核心能力，opt-out 而非 opt-in
4. **搜索 snippet 不够长**：BM25 snippet 只有 ~400 字符，需要回读文件获取更长的上下文段落

---

## 2. User Flow

### 2.1 主流程（Happy Path）

```
用户目标：向 Agent 提问，自动获得基于知识库内容的回答

前置条件：
- 用户已配置好 AI Provider
- 知识库中有相关内容
- Active Memory 功能开启（默认开启）

Step 1: 用户在聊天框输入问题并发送
  → 系统反馈：显示 "Thinking..." 加载状态
  → 状态变化：POST /api/ask 被调用

Step 2: 系统自动执行知识库搜索
  → 系统反馈：（无额外 UI 反馈，在后台静默执行）
  → 状态变化：hybridSearch(userQuery) 返回 Top-N 相关文件

Step 3: 系统将搜索结果注入 system prompt
  → 系统反馈：（无额外 UI 反馈）
  → 状态变化：promptParts 追加 "## 🧠 AUTO-RECALLED KNOWLEDGE" 段落

Step 4: LLM 接收完整上下文并生成回答
  → 系统反馈：流式输出 Agent 回复
  → 状态变化：response.body 流式返回

Step 5: 用户看到回答
  → 系统反馈：聊天界面显示完整回复
  → 状态变化：消息添加到会话历史

成功结果：用户获得基于知识库内容的精准回答，无需手动触发搜索
```

### 2.2 异常分支

```
异常 A：知识库为空或搜索无结果
  触发条件：hybridSearch() 返回空数组
  系统处理：跳过注入，正常继续 LLM 调用
  用户看到：Agent 正常回复（可能说"我没有找到相关信息"）

异常 B：搜索超时（>2s）
  触发条件：hybridSearch() 执行时间超过阈值
  系统处理：放弃本次召回，记录 warning log，继续 LLM 调用
  用户看到：正常回复，无感知（优雅降级）

异常 C：用户禁用了 Active Memory
  触发条件：settings.agent.activeMemory.enabled === false
  系统处理：跳过搜索，直接组装 system prompt
  用户看到：传统流程，需要手动让 Agent 搜索

异常 D：Token 预算不足
  触发条件：召回内容超过 maxTokens 配置
  系统处理：按相关性排序截断，只保留 top 结果
  用户看到：正常回复，但可能缺少部分低相关性内容
```

### 2.3 边界场景

```
边界 1：用户消息非常短（如"好的"、"继续"）
  处理：仍然执行搜索，但可能返回空结果或低相关性结果
  结果：不注入低分内容（minScore 过滤）

边界 2：用户消息非常长（>1000 字）
  处理：截取前 500 字符作为搜索词
  原因：搜索引擎对超长查询效果不佳

边界 3：用户已经 @ 了文件（attachedFiles 非空）
  处理：仍然执行 Active Memory，但 attached files 有更高优先级
  原因：用户显式指定的文件比自动召回更重要

边界 4：非 Agent 模式（Chat/Organize 模式）
  处理：不执行 Active Memory
  原因：这些模式有特定用途，不需要知识库自动召回

边界 5：并发请求
  处理：每个请求独立搜索，无共享状态
  原因：请求间相互独立
```

---

## 3. 方案对比

### 方案 A：Pre-flight 静默搜索注入（推荐）

**描述**：在组装 system prompt 时，自动用用户最后一条消息作为 query 搜索知识库，将结果作为 context 注入。

```
┌─────────────────────────────────────────────────────────────┐
│                    POST /api/ask                            │
├─────────────────────────────────────────────────────────────┤
│  1. 解析请求 (messages, attachedFiles, mode...)            │
│  2. 组装 base system prompt                                │
│  3. 加载 bootstrap context                                 │
│  4. 加载 attached files context                            │
│  5. ★ Active Memory: hybridSearch(lastUserMessage)        │  ← 新增
│     └─→ 注入 "## 🧠 AUTO-RECALLED KNOWLEDGE" 段落         │
│  6. 组装最终 systemPrompt                                  │
│  7. 调用 LLM                                               │
└─────────────────────────────────────────────────────────────┘
```

- **用户体验质量**：⭐⭐⭐⭐⭐ — 零额外延迟感知，无需用户操作
- **实现复杂度**：低 — 复用现有 hybridSearch，约 100 行新代码
- **可维护性**：高 — 独立模块，不侵入核心流程
- **风险**：搜索结果可能不相关（通过 minScore 阈值缓解）

### 方案 B：Sub-agent 记忆召回（OpenClaw 方式）

**描述**：在 Agent 回复前，先跑一个 memory sub-agent 来决定召回什么。

```
┌─────────────────────────────────────────────────────────────┐
│  1. 用户消息 → Memory Sub-agent（小模型）                  │
│     └─→ 输出：需要召回的 query 列表                        │
│  2. 批量搜索 → 聚合结果                                    │
│  3. 注入 context                                           │
│  4. 主 Agent 回复                                          │
└─────────────────────────────────────────────────────────────┘
```

- **用户体验质量**：⭐⭐⭐⭐ — 召回更精准，但多一次 LLM 调用
- **实现复杂度**：高 — 需要 sub-agent 编排、额外 prompt
- **可维护性**：中 — 引入 sub-agent 增加复杂度
- **风险**：延迟增加（额外 LLM 调用）、成本增加

### 方案 C：Lazy 工具召回（当前方式增强）

**描述**：不自动注入，但在 system prompt 中强制要求 Agent 每次都先调用 search。

```
System Prompt 追加：
"IMPORTANT: Before answering ANY user question, you MUST first call the search 
tool to find relevant knowledge base content. Never answer from memory alone."
```

- **用户体验质量**：⭐⭐⭐ — 仍需 tool call round trip，延迟更高
- **实现复杂度**：极低 — 只改 prompt
- **可维护性**：高 — 无代码改动
- **风险**：LLM 可能忽略指令、增加 token 消耗

### 方案选择：A

**理由**：
1. 方案 A 的 UX 最好（零额外感知延迟）
2. 实现复杂度可接受（复用现有搜索）
3. 方案 B 虽然更"智能"，但增加的复杂度和延迟不值得
4. 方案 C 的 UX 体验不如 A（多一个 tool call）

---

## 4. 技术设计

### 4.1 数据流

```
POST /api/ask
  │
  ├── 1. 解析请求 (messages, attachedFiles, mode)
  ├── 2. 组装 base system prompt (AGENT_SYSTEM_PROMPT)
  ├── 3. 加载 bootstrap context (INSTRUCTION.md, CONFIG.json, ...)
  ├── 4. 加载 attached files context (@ mentions)
  ├── 5. 加载 uploaded files context
  │
  ├── 6. ★ ACTIVE RECALL (新增)
  │      │
  │      ├── 6a. 提取用户最后一条消息作为 query
  │      ├── 6b. hybridSearch(mindRoot, query, { limit: 10 })
  │      │       └── BM25 + Embedding(if ready) → RRF merge
  │      ├── 6c. 过滤: score < minScore 的结果丢弃
  │      ├── 6d. 去重: 排除已在 attachedFiles 中的文件
  │      ├── 6e. 扩展 snippet: 对 top 结果回读文件，提取 ~800 字符上下文段落
  │      ├── 6f. Token 预算控制: 按分数排序，填满 maxTokens 预算
  │      └── 6g. 注入: promptParts.push("## KNOWLEDGE CONTEXT")
  │
  ├── 7. 组装最终 systemPrompt = promptParts.join('\n\n')
  └── 8. session.prompt(lastUserContent) → LLM 调用
```

### 4.2 类型定义

```typescript
// app/lib/settings.ts — AgentConfig 新增字段
export interface AgentConfig {
  maxSteps?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
  contextStrategy?: 'auto' | 'off';
  reconnectRetries?: number;
  /** Active Recall: 自动知识召回配置 */
  activeRecall?: ActiveRecallConfig;
}

export interface ActiveRecallConfig {
  /** 是否启用。默认 true（作为知识库核心能力默认开启） */
  enabled?: boolean;
  /** 召回内容的最大 token 数。默认 3000 */
  maxTokens?: number;
  /** 最多召回的文件数。默认 5 */
  maxFiles?: number;
  /** 最低相关性分数阈值。默认 0.1 */
  minScore?: number;
}
```

```typescript
// app/lib/agent/active-recall.ts — 新模块
export interface RecallResult {
  /** 知识库中的相对文件路径 */
  path: string;
  /** 扩展后的内容段落（~800字符，非搜索 snippet 的 ~400 字符） */
  content: string;
  /** 搜索相关性分数 */
  score: number;
}

export interface RecallOptions {
  maxTokens: number;
  maxFiles: number;
  minScore: number;
  /** 搜索超时（ms）。默认 2000 */
  timeoutMs: number;
  /** 已经在 context 中的文件路径（@ 附件 + 当前文件），召回时跳过 */
  excludePaths: string[];
}
```

### 4.3 核心函数设计

```typescript
// app/lib/agent/active-recall.ts

import { hybridSearch } from '@/lib/core/hybrid-search';
import { estimateStringTokens } from './context';
import { getFileContent } from '@/lib/fs';

const DEFAULTS = {
  maxTokens: 3000,
  maxFiles: 5,
  minScore: 0.1,
  timeoutMs: 2000,
} as const;

/**
 * 执行主动知识召回。
 *
 * 流程：search → filter → dedup → expand snippets → fit token budget
 *
 * 设计决策：
 * - 使用 hybridSearch 而非 sub-agent：零 API 成本，50ms 延迟
 * - 扩展 snippet：BM25 snippet 只有 ~400 字符，回读文件提取 ~800 字符段落
 * - Token 预算：贪心填充，按分数排序，超出预算则截断最后一条
 */
export async function performActiveRecall(
  mindRoot: string,
  userQuery: string,
  options?: Partial<RecallOptions>,
): Promise<RecallResult[]> {
  const opts = { ...DEFAULTS, ...options };
  const excludeSet = new Set(opts.excludePaths ?? []);

  // 1. 截断过长查询（搜索引擎对 >500 字符的查询效果差）
  const query = userQuery.length > 500 ? userQuery.slice(0, 500) : userQuery;
  if (query.trim().length < 2) return [];  // 太短不搜

  // 2. 带超时的搜索
  let searchResults;
  try {
    searchResults = await Promise.race([
      hybridSearch(mindRoot, query, { limit: opts.maxFiles * 2 }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), opts.timeoutMs),
      ),
    ]);
  } catch {
    return [];  // 超时或异常 → 静默降级
  }

  // 3. 过滤 + 去重（排除已 attached 的文件）
  const filtered = searchResults.filter(
    r => r.score >= opts.minScore && !excludeSet.has(r.path),
  );
  if (filtered.length === 0) return [];

  // 4. 扩展 snippet + token 预算控制
  const results: RecallResult[] = [];
  let usedTokens = 0;

  for (const hit of filtered) {
    if (results.length >= opts.maxFiles) break;

    // 尝试回读文件获取更长的上下文段落
    const content = expandSnippet(mindRoot, hit.path, hit.snippet, query);
    const contentTokens = estimateStringTokens(content);

    if (usedTokens + contentTokens > opts.maxTokens) {
      // 最后一条：截断到剩余预算
      const remaining = opts.maxTokens - usedTokens;
      if (remaining > 100) {  // 至少 100 tokens 才值得加
        results.push({
          path: hit.path,
          content: truncateToTokenBudget(content, remaining),
          score: hit.score,
        });
      }
      break;
    }

    results.push({ path: hit.path, content, score: hit.score });
    usedTokens += contentTokens;
  }

  return results;
}

/**
 * 扩展搜索 snippet：从文件中提取匹配位置周围 ~800 字符的段落。
 *
 * BM25 snippet 只有 ~400 字符（前后各 200）。对于 Active Recall，
 * 我们需要更长的上下文来让 Agent 理解笔记内容。
 *
 * 策略：找到关键词位置，向前后扩展到段落边界（\n\n），最多 800 字符。
 */
function expandSnippet(
  mindRoot: string,
  filePath: string,
  fallbackSnippet: string,
  query: string,
): string {
  const MAX_CHARS = 800;
  let fullContent: string;
  try {
    fullContent = getFileContent(filePath);
  } catch {
    return fallbackSnippet;  // 文件读取失败，用原始 snippet
  }

  if (fullContent.length <= MAX_CHARS) return fullContent;  // 短文件直接全量返回

  // 找到关键词在文件中的位置
  const lower = fullContent.toLowerCase();
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

  let anchor = -1;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) { anchor = idx; break; }
  }
  if (anchor === -1) anchor = 0;  // 没找到关键词，取文件开头

  // 向前后扩展到段落边界
  const half = Math.floor(MAX_CHARS / 2);
  let start = fullContent.lastIndexOf('\n\n', Math.max(0, anchor - half));
  if (start === -1 || anchor - start > half) start = Math.max(0, anchor - half);
  else start += 2;  // 跳过 \n\n

  let end = fullContent.indexOf('\n\n', Math.min(fullContent.length, anchor + half));
  if (end === -1 || end - anchor > half) end = Math.min(fullContent.length, anchor + half);

  let section = fullContent.slice(start, end).trim();
  if (start > 0) section = '...' + section;
  if (end < fullContent.length) section += '...';

  return section;
}

/** 按 token 预算截断。CJK ~1.5 tokens/char，ASCII ~0.25 tokens/char，取中间值 ~3 chars/token */
function truncateToTokenBudget(text: string, maxTokens: number): string {
  const chars = maxTokens * 3;
  if (text.length <= chars) return text;
  return text.slice(0, chars) + '...';
}
```

### 4.4 集成点：route.ts

在 `app/app/api/ask/route.ts` 第 468 行（uploaded files 注入之后、`systemPrompt = promptParts.join()` 之前）插入：

```typescript
// ── Active Recall: auto knowledge context injection ──
if (askMode === 'agent') {
  const arConfig = agentConfig.activeRecall ?? {};
  if (arConfig.enabled !== false) {
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const userQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

    if (userQuery.trim().length > 1) {
      // 已在 context 中的文件：currentFile + attachedFiles
      const excludePaths = [
        ...(currentFile ? [currentFile] : []),
        ...(Array.isArray(attachedFiles) ? attachedFiles : []),
      ];

      try {
        const recalled = await performActiveRecall(getMindRoot(), userQuery, {
          maxTokens: arConfig.maxTokens,
          maxFiles: arConfig.maxFiles,
          minScore: arConfig.minScore,
          excludePaths,
        });

        if (recalled.length > 0) {
          const recallBlock = recalled.map(r =>
            `### ${r.path}\n\n${r.content}`
          ).join('\n\n---\n\n');

          promptParts.push(
            `---\n\n## KNOWLEDGE CONTEXT (auto-recalled)\n\n` +
            `The following notes were automatically found in the knowledge base based on the user's question. ` +
            `Reference this content to provide accurate, grounded answers. ` +
            `Cite the file path when using information from a specific note.\n\n` +
            recallBlock,
          );
        }
      } catch (err) {
        console.warn('[ask] Active recall failed, continuing without:', err);
      }
    }
  }
}
```

### 4.5 集成点：headless.ts

在 `buildSystemPrompt()` 函数中添加同样的逻辑（供 CLI/MCP 使用）。

### 4.6 注入的 prompt 格式示例

```markdown
---

## KNOWLEDGE CONTEXT (auto-recalled)

The following notes were automatically found in the knowledge base based on the user's question. Reference this content to provide accurate, grounded answers. Cite the file path when using information from a specific note.

### tech/architecture-decisions.md

...我们在 2026-03-15 的会议中讨论了技术选型：
- 前端：Next.js 15 + React 19
- 后端：Node.js + pi-coding-agent
- 数据库：SQLite（本地优先）
- 搜索：BM25 + Embedding hybrid

主要考虑因素：
1. 本地优先，不依赖云服务
2. 开发者友好的技术栈...

---

### meetings/2026-03-15.md

...技术选型讨论 @geminitwang @team
决定采用 Next.js 全栈方案，理由是...
```

---

## 5. 影响范围

### 变更文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/lib/agent/active-recall.ts` | **新增** | 核心召回逻辑（~120 行） |
| `app/lib/settings.ts` | 修改 | AgentConfig 新增 `activeRecall` 字段 |
| `app/app/api/ask/route.ts` | 修改 | Agent 模式下注入召回内容（~25 行） |
| `app/lib/agent/headless.ts` | 修改 | CLI 模式同步集成 |
| `__tests__/agent/active-recall.test.ts` | **新增** | 单元测试 |

### 不受影响的模块

| 模块 | 原因 |
|------|------|
| 搜索引擎 (`lib/core/search.ts`, `hybrid-search.ts`) | 只读调用，不修改 |
| 前端 UI | Phase 1 无 UI 变更 |
| MCP Server | 不走 route.ts 路径 |
| Chat/Organize 模式 | 只在 Agent 模式下触发 |

---

## 6. 验收标准

### 6.1 功能验收

| # | 验收项 | Pass 条件 |
|---|--------|-----------|
| 1 | 基本召回 | Agent 模式下，用户提问后，response 的 system prompt 中包含 `## 🧠 AUTO-RECALLED KNOWLEDGE` 段落 |
| 2 | 内容相关 | 召回的内容与用户问题语义相关（人工判断） |
| 3 | Token 控制 | 召回内容不超过配置的 maxTokens |
| 4 | 空结果处理 | 知识库无相关内容时，不注入召回段落，不报错 |
| 5 | 超时处理 | 搜索超过 2s 时，放弃召回，正常继续响应 |
| 6 | 禁用开关 | `settings.agent.activeMemory.enabled = false` 时不执行召回 |
| 7 | 非 Agent 模式 | Chat/Organize 模式下不执行召回 |
| 8 | 与 attached files 共存 | 用户 @ 了文件时，attached files 和 active recall 都出现在 context 中 |

### 6.2 性能验收

| # | 指标 | 目标 |
|---|------|------|
| 1 | 召回延迟（P50） | < 100ms（BM25 only），< 300ms（hybrid） |
| 2 | 召回延迟（P99） | < 500ms |
| 3 | Token 开销 | 召回内容 ≤ 3000 tokens（默认配置） |

### 6.3 测试覆盖

- [ ] `active-recall.test.ts`: performActiveRecall 单元测试
  - 正常召回
  - 空结果
  - 超时
  - Token 截断
  - minScore 过滤
- [ ] `route.test.ts` 集成测试
  - Agent 模式注入召回内容
  - Chat/Organize 模式不注入
  - enabled=false 不注入

---

## 7. 边界 case 与风险

### 边界 case

| Case | 处理 |
|------|------|
| 用户消息很短（"好的"、"继续"、"谢谢"） | query < 2 字符时跳过召回；minScore 过滤低相关结果 |
| 用户消息超长（>500 字） | 截取前 500 字符作为搜索词 |
| 用户 @ 了文件 | excludePaths 去重，不重复注入已 attached 的文件 |
| 知识库为空 | hybridSearch 返回空 → 跳过注入 |
| 知识库有几千个文件 | BM25 仍然 < 100ms；embedding 有索引缓存 |
| 文件在搜索后被删除 | getFileContent 异常 → fallback 到原始 snippet |
| 纯英文知识库 + 中文提问 | BM25 可能匹配差；embedding 模式下语义搜索能弥补 |
| Ollama 小 context window（4K） | 现有 context compaction 机制会处理溢出 |

### 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 召回内容不相关，误导 Agent | 中 | 中 | minScore 阈值；prompt 说明"参考但不盲从" |
| 搜索延迟影响响应速度 | 低 | 中 | 2s 超时兜底；BM25 < 50ms |
| 消耗过多 context token | 低 | 低 | maxTokens 3000（仅占 1.5% of 200K） |
| 与 context compaction 冲突 | 低 | 低 | 召回内容在 system prompt 中，compaction 只压缩 messages |

---

## 8. 实施计划

### Phase 1（MVP）— 本次实施
- [x] 类型定义
- [ ] `active-recall.ts` 核心模块
- [ ] `route.ts` 集成
- [ ] `headless.ts` 集成
- [ ] 单元测试
- [ ] 集成测试

### Phase 2（增强）— 后续
- [ ] Settings UI 配置面板
- [ ] 召回来源指示（告诉用户"以下回答基于 xxx 笔记"）
- [ ] 召回日志/调试面板
- [ ] 查询改写（query rewriting）优化召回效果

---

## 9. 参考

- OpenClaw Active Memory: https://docs.openclaw.ai/concepts/active-memory
- 现有搜索实现: `app/lib/core/hybrid-search.ts`
- 现有 context 管理: `app/lib/agent/context.ts`
- 现有 attached files 注入: `app/app/api/ask/route.ts:430-458`
