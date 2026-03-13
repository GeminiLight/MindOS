<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 产品建议书 (Product Proposal): MindOS

## 愿景 (Vision)

**"人类在此思考，Agent 依此行动。"**

MindOS 是一个 **人机协同心智平台 (Human-AI Collaborative Mind Platform)**。它提供极致简洁的浏览器界面，让用户管理、编辑并与自己的"第二大脑"对话。通过 MCP 协议，将人类思维碎片转化为 AI Agent 可执行的结构化指令。

### 产品愿景（EN）

**Human-AI Shared Mind** — Your knowledge should be readable by humans and executable by agents in the same place.

1. **Global Mind Sync** — Capture once, reuse everywhere. MCP server lets any compatible agent access your Profile, SOPs, and project memory.
2. **Transparent and Controllable** — Retrieval, reflection, and execution outcomes are written to local plain text. Humans can audit and correct continuously in the GUI.
3. **Symbiotic Evolution** — Knowledge as Code. Daily notes naturally become executable instructions through prompt-native writing and reference-driven sync.

**Foundation: Local-first.** All data stored locally as plain text for privacy, ownership, and performance.

### 产品愿景（ZH）

**人机共享心智** — 让知识在同一处同时服务人类阅读与 Agent 执行。

1. **全局心智同步** — 一次记录，全局复用。内置 MCP Server 让兼容 Agent 可立即读取 Profile、SOP 与项目记忆。
2. **透明可控** — 检索、反思、执行结果沉淀为本地纯文本，人类可在 GUI 中持续审计与修正。
3. **共生演进** — 知识库即代码。通过 Prompt-Native 记录与引用驱动同步，笔记自然转化为可执行指令。

**底层原则：本地优先。** 所有数据以本地纯文本存储，确保隐私与数据主权。

---

## 痛点分析 (Problem)

| 痛点 | 描述 |
|------|------|
| 孤岛效应 | 多个 AI 工具/对话之间上下文割裂，每次都要重新交代背景，知识无法跨 Agent 复用 |
| 心智隔阂 | 人类笔记（Notion/Obsidian）给人看，Agent 记忆（向量数据库）给机器看，互不通气——用户和 Agent 各维护一套上下文，重复劳动 |
| Agent 黑箱 | Agent 记忆不透明——不知道它记了什么、记在哪里，也无法方便地审查和修正 |
| 管理负担 | 文件夹管理繁琐，文件间关联靠人维护，缺乏自动化同步更新 |

## 目标用户 (Target User)

- **AI 独立开发者/创始人** — 管理复杂 SOP、产品路线图和技术架构
- **系统性思考者** — 拥有庞大本地 Markdown/CSV 知识库，追求本地控制与隐私
- **Agentic AI 深度用户** — 通过 MCP 让 Agent 精准读写个人上下文

## 用户旅程 (User Journey)

| 场景 | 现状痛点 | MindOS 解决方案 |
|------|---------|----------------|
| 获取信息 | 文件树+搜索，缺乏上下文 | ⌘K 全局模糊搜索 + 实时片段预览 |
| 更新知识 | 编辑→保存→刷新 | 即时编辑 + 最后修改追踪 |
| 人机协作 | 手动复制粘贴 Context | Agent 通过 MCP 直接读写 Markdown |
| 修正幻觉 | 无法知道 AI 记住了什么 | 在 UI 中审查并修改 Agent "记忆" |
| 知识沉淀 | 碎片难结构化 | 内置结构化模板引导系统化 |
| 深度对话 | AI 无法关联多文件 | AI Ask (⌘/) 支持 `@` 附件引用 |

## 核心功能 (Features)

### 已实现 (Shipped)

- **人机协同 UI：** 琥珀色设计系统，亮/暗主题，专为长文阅读优化
- **双模式编辑器：** TipTap 富文本 + CodeMirror 6 Markdown 源码
- **MCP Server (20+ 工具)：** stdio + HTTP 双传输，Bearer Token 认证
- **MindOS Skills (EN + ZH)：** 结构感知路由、搜索回退策略、多文件审批
- **AI 对话 (⌘/)：** Vercel AI SDK 流式输出，`@` 文件引用 + PDF 上传
- **全局搜索 (⌘K)：** 毫秒级全文搜索 + snippet 预览
- **10 个渲染器插件：** TODO Board, CSV Views, Wiki Graph, Timeline, Backlinks, AI Briefing, Config, Agent Inspector, Diff Viewer, Workflow Runner
- **CLI：** onboard / start / open / sync / mcp install / gateway daemon / token — 13 个 lib 模块
- **Git 自动同步：** `mindos sync` — 自动 commit/push/pull，冲突保留 `.sync-conflict`
- **安全：** Bearer Token, 路径沙箱, INSTRUCTION.md 写保护, 原子写入
- **11+ Agent 兼容：** Claude Code, Cursor, Windsurf, Cline, Gemini CLI 等

### 不做什么 (Out of Scope)

- 自建富文本格式（依赖纯 Markdown/CSV）
- 在线多人实时协作（优先单人 + Agent 场景）
- Agent 训练/微调（只做知识存储和工具调用）

## 交互原则 (UX Principles)

| 原则 | 描述 |
|------|------|
| Speed First | 拒绝 Loading 焦虑，内容即开即读 |
| Minimal Chrome | 界面只保留内容与搜索 |
| Keyboard-driven | 所有核心动作均可快捷键完成 |
| Localism | 彻底的本地隐私，数据永远属于用户 |
