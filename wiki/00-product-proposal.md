<!-- Last verified: 2026-03-31 | Current stage: P1 -->

# 产品建议书 (Product Proposal): MindOS

## 核心品牌主张

**让你的每次思考都在增值。**

在 AI 时代，心负责判断，手交给 Agent。MindOS 让你的判断不再随对话消散，而是持续积累、被所有 AI 复用。

---

## 一句话介绍 (Elevator Pitch)

**MindOS 把你的判断、偏好和方法论沉淀成所有 Agent 都能复用的本地认知资产。**

### 面向用户的定位

> **你每天都在教 AI——纠正它的错误、告诉它你的偏好、交代项目背景。但关掉对话，这些全丢了。**
>
> MindOS 把你对 AI 说的每一次纠正和判断留下来，让所有 AI 工具下次直接照做。用的越久，AI 越准。

**品类定义：** 认知复利引擎——不是笔记工具，不是 AI 记忆，而是让人的判断持续积累、被 AI 复用、由人治理的认知资产平台。

**定位边界：**
- 不是"给笔记加 AI"（Obsidian 的读者是人，MindOS 的读者是人和 Agent）
- 不是"给 Agent 加记忆"（MemOS 是 AI 自动记的黑箱，MindOS 是人主动沉淀且可审计的）
- 是**人和 AI 之间的治理层**：人写下判断 → Agent 读取执行 → 纠正回流 → 判断持续增值

---

## 愿景 (Vision)

### EN

**Cognitive Compound Engine** — Your judgment compounds with every AI interaction.

1. **Share Once, Reuse Everywhere** — Write your project context once. Every Agent reads it through MCP. No more re-explaining.
2. **You See Everything** — Every Agent read/write is logged as local plain text. You audit, correct, or delete anytime in the GUI.
3. **Corrections Stick** — When you correct an AI, that correction becomes a rule. Next time, every Agent follows it automatically.

### ZH

**认知复利引擎** — 你的每次判断都在增值。

1. **写一次，全复用** — 项目背景写一次，所有 Agent 通过 MCP 自动读取。不用重复交代。
2. **你看得见一切** — Agent 的每次读写都记录为本地纯文本。你随时在 GUI 中审查、修正、删除。
3. **纠正会被记住** — 你纠正了 AI，这个纠正自动变成规则。下次所有 Agent 都照做。

**底层原则：本地优先。** 所有数据以本地纯文本存储，确保隐私与数据主权。

---

## 痛点分析 (Problem)

> 证据状态：以下痛点来自创始人经验和内测群反馈（N≈10），尚未经过系统化用户观察验证。

| 痛点 | 用户的话 | 频率 |
|------|---------|------|
| 上下文割裂 | "每次换工具就要把背景重讲一遍" | 每天多次 |
| 治理黑箱 | "AI 记了什么我完全不知道，也改不了" | 每次使用 |
| 判断断流 | "我纠正了 AI 100 次同样的错，它还是犯" | 每次对话 |

**真实竞争对手：** 不是某个产品，而是用户当前的"多工具拼接"现状——在 Claude / Cursor / Gemini CLI / 笔记之间来回切换，靠人手搬运上下文。

## 解决方案 (Solution)

| 痛点 | MindOS 怎么做（具体机制） |
|------|-------------------------|
| 上下文割裂 | 所有 Agent 通过 MCP 协议读写同一份本地 Markdown 文件。用户写一次项目背景，10+ Agent 零配置直连读取。 |
| 治理黑箱 | Agent 每次读写生成审计日志（本地 JSON），GUI 提供 Agent Inspector 面板可按时间/操作类型过滤查看。用户可直接编辑或删除任何记录。 |
| 判断断流 | 对话中的纠正通过"经验沉淀"功能（一键或 AI 自动提取）写入对应 Space 文件，变成 Skill/SOP 规则。下次所有 Agent 自动遵守。 |

---

## Why Now

Vibe Coding 时代，"做出来"不再稀缺，"想清楚"才稀缺。

AI 能写代码、做设计、跑流程，但所有 AI 工具只负责输出，不负责沉淀。MCP 协议的标准化（2025-2026）使得跨 Agent 共享上下文第一次成为可能。

---

## 核心概念 (Core Concepts)

| 概念 | 人话版 | 正式定义 |
|------|--------|---------|
| **Space** | 文件夹。你按项目/主题分文件夹，Agent 也按同样的结构读写。 | 按用户思维方式组织的知识分区，Agent 遵循同样结构自动读写。 |
| **Instruction** | 规则文件。你写一次"不要用 any 类型"，所有 Agent 都遵守。 | 所有 Agent 共同遵守的治理规则，写一次全局生效。 |
| **Skill** | 执行手册。告诉 Agent "怎么帮我整理项目资料"的步骤说明。 | 沉淀的判断转化为可复用的 Agent 执行指南，可从对话经验中自动生成。 |

三者形成完整链路：**结构层（Space）→ 控制层（Instruction）→ 执行层（Skill）**

用户认知渐进：
- P1：只需理解 Space（"这就是文件夹，Agent 能读"）
- P1.5：理解 Instruction（"写规则，Agent 照做"）
- P2：理解 Skill（"我的纠正自动变成 Agent 的执行手册"）

---

## 目标用户 (Target User)

**核心 Persona：** 同时使用 3+ Agent 的独立开发者/创始人——管理复杂 SOP、产品路线图和技术架构，需要跨 Agent 共享上下文。

**扩展用户：**
- **AI-native 小团队（3-15 人）** — 共享 SOP、Profile、项目记忆给团队 Agent
- **系统性思考者** — 重度 Markdown 用户（本地知识库 500+ 文件），追求本地控制与隐私

---

## 用户旅程 (User Journey)

| 场景 | 现状痛点 | MindOS 怎么做 |
|------|---------|--------------|
| 首次上手 | 工具配置复杂，门槛高 | `npm i -g @geminilight/mindos && mindos onboard`，30 秒浏览器可用 |
| 跨 Agent 工作 | 每换一个 Agent 就要重新交代背景 | `mindos token` 一键生成配置，粘到任意 Agent 即连通 |
| 审查 Agent 行为 | 不知道 AI 记住了什么、改了什么 | Agent Inspector 实时日志 + GUI 中审查/修正/删除 |
| 沉淀工作流 | 对话最佳实践关掉就丢了 | 对话经验沉淀为 Skill/SOP，Agent 自动更新关联文件 |
| 感受认知复利 | 用了 100 次 AI，工作流还是第一天 | "你已积累 47 条判断规则，Agent 输出质量提升 3x" |

---

## 核心功能 (Features)

- **MCP Server** — stdio + HTTP 双传输，兼容 10+ Agent（Claude Code, Cursor, Gemini CLI 等）
- **人机协同 GUI** — 双模式编辑器、MindOS Agent 对话、全局搜索（⌘K）、Wiki Graph
- **MindOS Skills** — 结构感知路由，对话经验可沉淀为可复用 Skill
- **11 个渲染器插件** — TODO Board, CSV Views, Wiki Graph, Timeline, Agent Inspector 等
- **CLI 工具链** — onboard / start / sync / token，30 秒完成安装到 Agent 连通
- **Git 自动同步** — 自动 commit/push/pull，冲突保留 `.sync-conflict`
- **桌面端** — macOS / Windows / Linux 原生应用
- **安全** — Bearer Token, 路径沙箱, INSTRUCTION.md 写保护, 原子写入

### 不做什么 (Out of Scope)

- 不做通用笔记工具 — 不在编辑器层和 Notion/Obsidian 竞争
- 不做自建富文本格式 — 依赖纯 Markdown/CSV，保证可迁移
- 不做实时多人协同编辑 — 支持团队异步共享
- 不做 Agent 训练/微调 — 只做知识存储和工具调用

---

## 交互原则 (UX Principles)

| 原则 | 描述 |
|------|------|
| Speed First | 拒绝 Loading 焦虑，内容即开即读 |
| Minimal Chrome | 界面只保留内容与搜索 |
| Keyboard-driven | 桌面端所有核心动作均可快捷键完成 |
| Local-first | 彻底的本地隐私，数据永远属于用户 |

---

## 成功指标 (North Star Metrics)

| 阶段 | 北极星指标 | 目标 | 衡量的是什么 |
|------|-----------|------|------------|
| P1（当前） | 周 MCP 活跃知识库数（≥1 次 Agent 读写） | 100+ | 核心价值被使用（Agent 真的在读取） |
| P1.5 | 周经验沉淀次数（判断写回知识库） | 50+ 次/周 | 认知复利开始运转 |
| P2 | MAU + 7 日留存率 | MAU 1000+，留存 >40% | 产品粘性 |
| P3 | Pro 付费转化率 + ARR | 转化 >5%，ARR $50K+ | 商业可行性 |

---

*本文档是 MindOS 的产品"宪法"，所有产品决策应与此对齐。*
*战略详述见 `startup/strategy.md`，产品设计见 `startup/product-design.md`。*
