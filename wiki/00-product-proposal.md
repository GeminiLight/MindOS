<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 产品建议书 (Product Proposal): MindOS

## 一句话介绍 (Elevator Pitch)

**MindOS 是 Agent 时代的人机协同心智平台——让所有 Agent 共享一个记忆层，用户可审计、可修正、越用越聪明。**

---

## 愿景 (Vision)

### EN

**Human-AI Shared Mind** — Your knowledge should be readable by humans and executable by agents in the same place.

1. **Global Mind Sync** — Capture once, reuse everywhere. MCP server lets any compatible agent access your Profile, SOPs, and project memory.
2. **Transparent and Controllable** — Retrieval, reflection, and execution outcomes are written to local plain text. Humans can audit and correct continuously in the GUI.
3. **Symbiotic Evolution** — Knowledge as Code. Daily notes naturally become executable instructions through agent-ready writing and cross-file reference linking.

### ZH

**人机共享心智** — 让知识在同一处同时服务人类阅读与 Agent 执行。

1. **全局心智同步** — 一次记录，全局复用。内置 MCP Server 让兼容 Agent 可立即读取 Profile、SOP 与项目记忆。
2. **透明可控** — 检索、反思、执行结果沉淀为本地纯文本，人类可在 GUI 中持续审计与修正。
3. **共生演进** — 知识库即代码。对话经验自然沉淀为可执行指令，知识库随使用自我进化。

**底层原则：本地优先。** 所有数据以本地纯文本存储，确保隐私与数据主权。

---

## 痛点分析 (Problem)

| 痛点 | 描述 |
|------|------|
| 记忆割裂 | 多个 Agent 各记各的，切换工具靠人工搬运上下文——每次对话都要重新交代背景，知识无法跨 Agent 复用 |
| 记忆黑箱 | Agent 记了什么、记对没有，用户无法审查和修正——你不知道它"理解"的和你想的是不是一回事 |
| 经验断流 | 对话里积累的最佳实践没有回流为 SOP/Skill，工作流无法自我进化——用了 100 次 Agent，工作流还是第一天的样子 |

## 解决方案 (Solution)

| 痛点 | MindOS 的回答 |
|------|--------------|
| 记忆割裂 | **统一记忆** — 所有 Agent 通过 MCP 协议读写同一份本地知识库，一次记录，全局复用 |
| 记忆黑箱 | **透明审计** — Agent 的每次读写留痕，用户可在 GUI 中审查、修正、删除 Agent 记忆 |
| 经验断流 | **经验回流** — 对话中的最佳实践沉淀为 Skill/SOP，Agent 自动识别并更新关联文件，知识库随使用越来越好 |

## 目标用户 (Target User)

**核心 Persona：** 同时使用 3+ Agent 的独立开发者/创始人——管理复杂 SOP、产品路线图和技术架构，需要跨 Agent 共享上下文。

**扩展用户：**
- **AI-native 小团队（3-15 人）** — 共享 SOP、Profile、项目记忆给团队 Agent
- **系统性思考者** — 重度 Markdown 用户（本地知识库 500+ 文件），追求本地控制与隐私

## 用户旅程 (User Journey)

| 场景 | 现状痛点 | MindOS 怎么做 |
|------|---------|--------------|
| 首次上手 | 工具配置复杂，门槛高 | `npm i -g @geminilight/mindos && mindos onboard`，30 秒浏览器可用 |
| 跨 Agent 工作 | 每换一个 Agent 就要重新交代背景 | `mindos token` 一键生成配置，粘到任意 Agent 即连通 |
| 审查 Agent 行为 | 不知道 AI 记住了什么、改了什么 | Agent Inspector 实时日志 + GUI 中审查/修正/删除 |
| 沉淀工作流 | 对话最佳实践关掉就丢了 | 对话经验沉淀为 Skill/SOP，Agent 自动更新关联文件 |
| 深度对话 | AI 无法关联多文件上下文 | AI Ask (⌘/) 支持 `@` 附件引用多文件 |

## 核心功能 (Features)

- **MCP Server (20+ 工具)** — stdio + HTTP 双传输，全阵容 Agent 兼容（OpenClaw, Claude Code, Cursor 等）
- **人机协同 GUI** — 双模式编辑器（富文本 + Markdown 源码）、AI 对话、全局搜索、Wiki Graph
- **MindOS Skills** — 结构感知路由，对话经验可沉淀为可复用 Skill
- **11 个渲染器插件** — TODO Board, CSV Views, Wiki Graph, Timeline, Agent Inspector 等
- **CLI 工具链** — onboard / start / sync / token，30 秒完成安装到 Agent 连通
- **Git 自动同步** — 自动 commit/push/pull，冲突保留 `.sync-conflict`
- **安全** — Bearer Token, 路径沙箱, INSTRUCTION.md 写保护, 原子写入

### 不做什么 (Out of Scope)

- 不做通用笔记工具 — 不在编辑器层和 Notion/Obsidian 竞争，聚焦 Agent 知识层
- 不做自建富文本格式 — 依赖纯 Markdown/CSV，保证可迁移
- 不做实时多光标协同编辑 — 支持团队异步共享，但不做 Google Docs 式实时协作
- 不做 Agent 训练/微调 — 只做知识存储和工具调用

## 交互原则 (UX Principles)

| 原则 | 描述 |
|------|------|
| Speed First | 拒绝 Loading 焦虑，内容即开即读 |
| Minimal Chrome | 界面只保留内容与搜索 |
| Keyboard-driven | 桌面端所有核心动作均可快捷键完成；移动端优化触控交互 |
| Localism | 彻底的本地隐私，数据永远属于用户 |

## 成功指标 (North Star Metrics)

| 阶段 | 北极星指标 | 目标 |
|------|-----------|------|
| P1（当前） | 周活跃知识库数（至少 1 次 MCP 读写或 GUI 编辑） | 100+（当前：内测群 ~30 人） |
| P1.5（过渡） | 累计活跃知识库数 + 社区反馈 | 300+ 累计，GitHub 50+ issues |
| P2 | 月活跃用户 + 7 日留存率 | MAU 1000+，7d retention > 40% |
| P3 | Pro 付费转化率 + Team 层 ARR | conversion > 5%，ARR $50K+ |
| P4 | Context API 第三方调用量 | 月调用 > 100K |
