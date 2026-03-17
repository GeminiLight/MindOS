# MindOS Landing Page — Content Management

> **用途**：集中管理 landing page 所有双语文案。修改文案时先改此文件，再同步到 `index.html`。
>
> **格式约定**：每个文案条目用 `zh:` / `en:` 标注双语版本。

---

## Meta

- **Title**: MindOS — Human-AI Collaborative Mind System
- **Favicon**: img/logo-square.svg

---

## Nav

| 位置 | zh | en |
|------|----|----|
| Link 1 | 愿景 | Vision |
| Link 2 | 流程 | Flow |
| Link 3 | 对比 | Compare |
| Link 4 | 循环 | Loop |
| Link 5 | 特性 | Features |
| Link 6 | 开始 | Start |
| Theme Toggle | — | ◐ |
| Lang Toggle | EN | ZH |
| CTA | GitHub | GitHub |

---

## Hero

- **Badge**
  - zh: 人机协同心智系统
  - en: Human-AI Collaborative Mind System
- **Headline**
  - zh: 人类在此思考，Agent 依此行动。
  - en: Human Thinks Here, Agent Acts There.
- **Subhead**
  - zh: 和所有 AI 共享你的大脑——看得见、改得了、越用越聪明。
  - en: Share your mind with every AI — visible, editable, and smarter with every use.
- **CTA Primary**
  - zh: 开始构建
  - en: Get Started
- **CTA Secondary**: GitHub
- **Trust Tags**:
  - zh: 原生适配 · 本地优先 · 完全开源
  - en: Agent-native · Local-first · Open Source

---

## Vision (愿景)

- **Section Tag**: 01. THE VISION
- **Headline**
  - zh: 人机共享心智
  - en: Human-AI Shared Mind
- **Subhead**
  - zh: 记忆不再割裂，行为不再黑箱，经验不再断流。
  - en: No more fragmented memory, no more black-box behavior, no more lost experience.

### Pillar 01: Global Sync

- **Title**
  - zh: 全局同步 — 打破记忆割裂
  - en: Global Mind Sync — Breaking Memory Silos
- **Tagline**
  - zh: 换个工具、开个新对话，就要把背景重讲一遍？
  - en: Switch tools or start a new chat, and you have to re-explain everything?
- **Pain**
  - zh: 多个 Agent 各记各的，切换工具靠人工搬运上下文 / 每次对话都要重新交代背景，知识无法跨 Agent 复用 / 个人深度背景散落多处，Agent 每次都缺乏完整 Context
  - en: Each Agent keeps its own memory — switching tools means manual context transfer / Every conversation starts from scratch, knowledge can't be reused across Agents / Deep personal context scattered — Agents always lack the full picture
- **Shift**
  - zh: 内置 MCP Server (20+ 工具)，任意 Agent 零配置直连知识库 / 全阵容 Agent 兼容：OpenClaw, Claude Code, Cursor 等 / Profile、SOP 与项目记忆一处记录，全量赋能所有 Agent
  - en: Built-in MCP Server (20+ tools) — any Agent connects with zero config / Full-lineup Agent compatible: OpenClaw, Claude Code, Cursor, etc. / Profile, SOPs & project memory: record once, empower all Agents

### Pillar 02: Transparent & Controllable

- **Title**
  - zh: 透明可控 — 消除记忆黑箱
  - en: Transparent & Controllable — No Black Boxes
- **Tagline**
  - zh: Agent 在记忆你，但记了什么、记对没有？
  - en: Your Agent is memorizing you — but what exactly did it remember, and is it right?
- **Pain**
  - zh: Agent 的"记忆"锁在系统黑箱中，人类完全不可见 / 中间推理过程无法审查，错误难以追溯和纠正 / 幻觉不受控地累积，信任链随时间持续崩塌
  - en: Agent memory locked in black boxes — fully invisible to humans / Intermediate reasoning can't be audited or traced back / Hallucinations compound unchecked, eroding trust over time
- **Shift**
  - zh: 每次检索、反思与执行均通过 MCP 沉淀为本地纯文本 / GUI 工作台提供完整的审查、干预与心智修正界面 / 人类拥有绝对的心智纠偏权，随时校准 Agent 行为
  - en: Every retrieval, reflection & action saved as local plain text via MCP / GUI workbench provides full audit, intervention & correction interface / Humans hold absolute mind-correction rights — recalibrate Agents anytime

### Pillar 03: Symbiotic Evolution

- **Title**
  - zh: 共生演进 — 经验回流为指令
  - en: Symbiotic Evolution — Experience Flows Back as Instructions
- **Tagline**
  - zh: 对话里攒下的经验，关掉窗口就散了？
  - en: All that experience from your conversations — gone the moment you close the window?
- **Pain**
  - zh: 对话里积累的最佳实践关掉就丢了，无法回流为工作流 / 用了 100 次 Agent，工作流还是第一天的样子 / 人机协作断裂，Agent 每次都从零开始理解上下文
  - en: Best practices from conversations vanish when the chat closes — no feedback loop / 100 Agent sessions later, workflows are still day-one quality / Human-AI context breaks — Agents restart from zero each time
- **Shift**
  - zh: 对话经验自然沉淀为可复用 Skill/SOP，Agent 自动识别并更新关联文件 / 笔记即指令——日常记录天然就是 Agent 可执行的高质量指令 / 人机在同一个 Shared Mind 中相互启发，知识库随使用自我进化
  - en: Conversation experience auto-distills into reusable Skills/SOPs, Agents auto-update linked files / Notes as Instructions — everyday writing naturally doubles as executable Agent commands / Humans & AI co-inspire within a single Shared Mind, knowledge base self-evolves with use

### Foundation Banner

- **Title**
  - zh: 底层基石：本地优先
  - en: Foundational Pillar: Local-first
- **Body**
  - zh: 所有数据以纯文本形式存储在本地，彻底消除隐私顾虑，确保你拥有绝对的数据主权与极致的读写性能。
  - en: All data is stored locally as plain text, eliminating privacy concerns and ensuring absolute data sovereignty with ultimate read/write performance.
- **UX Principles**
  - zh: 极速响应 · 极简界面 · 键盘优先 · 本地优先
  - en: Speed First · Minimal Chrome · Keyboard-driven · Local-first

### Target User

- **Title**
  - zh: 为谁而造
  - en: Built For
- **Core Persona**
  - zh: 同时使用 3+ Agent 的独立开发者/创始人——管理复杂 SOP、产品路线图和技术架构，需要跨 Agent 共享上下文。
  - en: Indie developers/founders using 3+ Agents simultaneously — managing complex SOPs, product roadmaps, and tech architecture, needing cross-Agent context sharing.
- **Extended Users**
  - zh: AI-native 小团队（3-15 人） · 系统性思考者（500+ 文件本地知识库）
  - en: AI-native small teams (3-15 people) · Systematic thinkers (500+ file local knowledge bases)

---

## Demo Flow (一图看懂)

- **Section Tag**: 02. THE FLOW
- **Headline**
  - zh: 想法、执行到复盘，一条线贯穿
  - en: From Ideas to Execution to Review, One Thread Through All
- **Subhead**
  - zh: 记一句想法，剩下的全自动
  - en: Jot down one idea, everything else is automatic

### Step 1: Capture

- **Label**
  - zh: 随手记录
  - en: Capture
- **Sub**
  - zh: 手机 / 任意设备
  - en: Phone / Any Device
- **Mobile Nav**
  - zh: 快速记录
  - en: Quick Capture
- **Note 1 (accent)**
  - Time zh: 今天 11:30 / en: Today 11:30
  - Text zh: 想好了新项目：先理清思路，代码开搞，顺便发个帖宣传下
  - Text en: New project idea: plan the approach first, start coding, post about it to get feedback
  - Tag: #idea
- **Note 2 (muted)**
  - Time zh: 昨天 16:00 / en: Yesterday 16:00
  - Text zh: 之前调研过竞品，用 React + Tailwind 方案
  - Text en: Researched competitors earlier, going with React + Tailwind stack
  - Tag: #tech-stack
- **Input Placeholder**
  - zh: 记一下新项目的想法...
  - en: Jot down a new project idea...

### Step 2: Auto-Organize

- **Label**
  - zh: 自动整理
  - en: Auto-Organize
- **Sub**: MindOS GUI
- **Desktop Title**: MindOS — localhost:3000
- **Sidebar**: Profile / Workflows (active) / Projects / Configs / Resources
- **Filepath**: Projects/新项目计划.md
- **Update Badge**
  - zh: Agent 已自动更新 3 个文件
  - en: Agent auto-updated 3 files
- **Content Title**
  - zh: 新项目计划
  - en: New Project Plan
- **Key Approach**
  - zh: 先理清项目方案和架构 / 搭建代码骨架，快速出原型 / 发帖宣传，收集早期反馈
  - en: Plan the project approach and architecture / Scaffold codebase, ship a quick prototype / Post for promotion, collect early feedback
- **Related Files**: Projects/Project-Plan.md · Workflows/Launch-SOP.md · TODO.md

### Step 3: All Agents Execute

- **Label**
  - zh: 所有 Agent 执行
  - en: All Agents Execute
- **Sub**: via MCP
- **Group Label**: ALL AGENTS via MCP
- **Gemini CLI**
  - zh: 梳理项目方案和架构 → Done. 已整理项目方案 + 技术架构文档
  - en: Plan project approach and architecture → Done. Created project plan + architecture doc
- **Cursor CLI**
  - zh: 搭建项目骨架 → Done. 已初始化项目结构 + 基础配置
  - en: Scaffold project structure → Done. Initialized project + base config
- **OpenClaw Bot**
  - zh: 发帖宣传项目，收集大家反馈 → Done. 已发布宣传帖 + 汇总反馈沉淀到 SOP
  - en: Post about the project, collect feedback → Done. Published post + distilled feedback to SOP

### SVG Arrow Labels

| Arrow | zh | en |
|-------|----|----|
| 1 | 同步 | Sync |
| 2 | MCP 读取 | MCP Read |
| 3 | 经验回流 | Feedback |

### Bottom Tagline

- zh: 一句想法 → **MindOS** 归档 + 关联 → 所有 Agent 各就各位 → **经验自动沉淀**
- en: One idea → **MindOS** archives + links → All Agents mobilize → **Experience auto-distilled**

---

## Compare (对比)

- **Section Tag**: 03. THE DIFFERENCE
- **Headline**
  - zh: 同一个任务，两种体验
  - en: Same Task, Two Realities
- **Subhead**
  - zh: 选择一个真实场景，看看有 MindOS 和没有 MindOS 的区别。
  - en: Pick a real scenario. See what changes when your Agents share your mind.

### Tabs

| ID | zh | en |
|----|----|----|
| switch (default) | 切换对话 | Switch Conversations |
| collect | 信息收集 | Info Collection |
| social | 社交关系 | Social Relationships |
| scaffold | 代码开发 | Code Development |
| team | 团队协作 | Team Collaboration |
| review | 代码审查 | Code Review |

### Scene: switch — 切换对话

**Without MindOS**

- Scenario zh: 同一个任务里，你在不同工具和新对话之间来回切换
- Scenario en: Inside one task, you keep switching across tools and fresh chats
- Step 1 zh: 每次一换工具或开新对话，就要重讲背景、约定和当前进度
- Step 1 en: Every time you switch tools or start a new chat, you must re-explain context, conventions, and progress
- Step 2 zh: 同一工具开新 session 也会丢记忆，回答风格和决策标准来回漂移
- Step 2 en: Even a new session in the same tool loses memory, so style and decision criteria drift
- Step 3 zh: 你在做"上下文搬运"，而不是推进结果交付
- Step 3 en: You end up transporting context instead of shipping outcomes
- Verdict zh: **高频重讲** 每次一换工具/对话，就要重新对齐
- Verdict en: **Frequent rebriefs** every tool/chat switch forces re-alignment

**With MindOS**

- Scenario zh: 同一个任务里，无论换工具还是开新对话，都从同一份 MindOS 上下文继续
- Scenario en: In the same task, tool switches and new chats both continue from one shared MindOS context
- Step 1 zh: 每个 Agent 通过 MCP 读取同一份 MindOS 知识库
- Step 1 en: Every agent reads the same MindOS knowledge base via MCP
- Step 2 zh: 偏好、标准、项目状态自动继承，新会话也保持一致判断
- Step 2 en: Preferences, standards, and project state carry over automatically, even in fresh chats
- Step 3 zh: 你只做决策与验收，协作链路持续不断流
- Step 3 en: You stay on decisions and acceptance while collaboration flow remains continuous
- Verdict zh: **0 重讲** 切换工具/对话，协作不断流
- Verdict en: **0 rebriefs** switch tools/chats without breaking flow

### Scene: collect — 信息收集

**Without MindOS**

- Scenario zh: 周一 9:00，市场负责人说："下午 3 点前把这 30 位 KOL 的外联初稿发我"
- Scenario en: Monday 9:00 AM: "Send first-draft outreach for 30 influencers before 3 PM."
- Step 1 zh: 你把表格、历史合作记录、备注一条条复制进 Prompt
- Step 1 en: You manually paste sheets, collaboration history, and notes into the prompt
- Step 2 zh: Agent 先给通用模板，你再逐个补充语气、内容方向和禁用词
- Step 2 en: Agent returns generic templates; you rewrite tone, content angle, and blocked terms one by one
- Step 3 zh: 第 19 封才发现用错人设，整批重改
- Step 3 en: You catch a wrong persona at email #19 and rework the whole batch
- Verdict zh: **~45 min** 重复喂上下文，返工风险高
- Verdict en: **~45 min** context repetition + high rework risk

**With MindOS**

- Scenario zh: 同一句话："下午 3 点前，把这 30 位 KOL 外联初稿发我"
- Scenario en: Same sentence: "Draft outreach for these 30 influencers before 3 PM."
- Step 1 zh: Agent 自动读取 Resources/Influencers.csv + 合作历史标签
- Step 1 en: Agent auto-loads Resources/Influencers.csv and collaboration-history tags
- Step 2 zh: 按 Workflows/Outreach-SOP.md 生成分层外联：头部 / 腰部 / 长尾
- Step 2 en: Follows Workflows/Outreach-SOP.md to generate tiered outreach: top/mid/long-tail
- Step 3 zh: 一次产出可直接发送版本，你只做最终确认
- Step 3 en: Produces send-ready drafts in one shot; you only do final approval
- Verdict zh: **~6 min** 流程自动对齐，几乎零返工
- Verdict en: **~6 min** workflow auto-aligned, near-zero rework

### Scene: scaffold — 代码开发

**Without MindOS**

- Scenario zh: 周三晚 10:30，老板说："明天评审要看到能跑的项目骨架"
- Scenario en: Wednesday 10:30 PM: "We need a runnable project skeleton for tomorrow's review."
- Step 1 zh: 你反复说明：Next.js 15、pnpm、目录规范、CI 要求
- Step 1 en: You repeatedly explain: Next.js 15, pnpm, folder conventions, CI requirements
- Step 2 zh: 第一版用了 npm 且结构不符合团队约定
- Step 2 en: First output uses npm and a structure that violates team conventions
- Step 3 zh: 你二次纠偏后才能进入真正开发
- Step 3 en: You spend another round correcting before real development can start
- Verdict zh: **~25 min** 启动慢，首版不可用
- Verdict en: **~25 min** slow kickoff, first output not usable

**With MindOS**

- Scenario zh: 同一句话："帮我启动这个代码开发，明天评审要看"
- Scenario en: Same ask: "Kick off this project build for tomorrow's review."
- Step 1 zh: Agent 读取 Profile/Identity.md → 默认技术栈与命令习惯
- Step 1 en: Agent reads Profile/Identity.md for default stack and command preferences
- Step 2 zh: 读取 Workflows/Startup-SOP.md → 自动带上初始化、校验、CI 模板
- Step 2 en: Reads Workflows/Startup-SOP.md and auto-applies setup, checks, and CI template
- Step 3 zh: 首版即可跑通，团队直接接力开发
- Step 3 en: First output runs immediately; team can start building right away
- Verdict zh: **~4 min** 首版可用，直接进入迭代
- Verdict en: **~4 min** usable first output, straight into iteration

### Scene: social — 社交关系

**Without MindOS**

- Scenario zh: 你说："我今天和他聊了这些"
- Scenario en: You say: "I talked with this person today."
- Step 1 zh: 你重新解释人物背景、历史合作、敏感话题边界
- Step 1 en: You re-explain relationship background, collaboration history, and sensitive boundaries
- Step 2 zh: 本次会话记住了，但下次换 Agent 又要从头讲
- Step 2 en: This session remembers, but switching agents means starting from zero again
- Step 3 zh: 重要承诺容易遗漏，跟进动作断档
- Step 3 en: Important commitments slip through, follow-up actions break
- Verdict zh: **易断档** 关系信息分散在会话里
- Verdict en: **Fragile** relationship context scattered across chats

**With MindOS**

- Scenario zh: 你只说："我今天和他聊了这些，帮我推进下一步"
- Scenario en: You only say: "We discussed this today, drive the next steps."
- Step 1 zh: Agent 从聊天里抽取关键事实与情绪变化，结构化记录
- Step 1 en: Agent extracts key facts and sentiment shifts from the chat into structured notes
- Step 2 zh: 不只更新 Connections/XXX.md，还自动生成跟进策略、待办和提醒时间
- Step 2 en: Not just updates Connections/XXX.md, but also creates follow-up strategy, tasks, and reminder timing
- Step 3 zh: 后续任何 Agent / 新会话都可直接接手执行，不再从头梳理关系脉络
- Step 3 en: Any future agent/session can continue execution directly without rebuilding relationship history
- Verdict zh: **可执行** 从聊天到行动，自动闭环
- Verdict en: **Actionable** from conversation to execution, closed-loop

### Scene: team — 团队协作

**Without MindOS**

- Scenario zh: 周会后，产品、研发、运营都在各自工具里记录了"下一步"
- Scenario en: After weekly sync, product, engineering, and ops all captured next steps in separate tools
- Step 1 zh: 产品在文档写优先级，研发在代码工具记实现，运营在群里补执行计划
- Step 1 en: Product tracks priorities in docs, engineering logs implementation notes, ops writes plans in chat
- Step 2 zh: 信息分散且口径不一致，跨角色协作频繁二次确认
- Step 2 en: Context is fragmented and inconsistent, forcing repeated cross-role confirmations
- Step 3 zh: 一周后复盘才发现目标偏移，团队花时间补救对齐
- Step 3 en: A week later, review reveals drift and the team spends time repairing alignment
- Verdict zh: **团队失焦** 每个人都在努力，但不在同一条线上
- Verdict en: **Team drift** everyone works hard, but not on one shared line

**With MindOS**

- Scenario zh: 同样的周会结论，统一沉淀到团队 MindOS 里
- Scenario en: The same meeting outcomes are captured into one team MindOS
- Step 1 zh: 会议纪要自动更新 Team/Decisions.md、Projects/Roadmap.md、Workflows/Handoff-SOP.md
- Step 1 en: Meeting notes auto-update Team/Decisions.md, Projects/Roadmap.md, and Workflows/Handoff-SOP.md
- Step 2 zh: 不同角色的 Agent 都读取同一份团队上下文，产出天然对齐
- Step 2 en: Role-specific agents read the same team context, so outputs align by default
- Step 3 zh: 每次任务推进都能追溯到团队决策，协作像同一个大脑在思考
- Step 3 en: Each task traces back to team decisions, making collaboration feel like one shared brain
- Verdict zh: **团队同频** MindOS 成为团队共同思考层
- Verdict en: **Team sync** MindOS becomes the team's shared thinking layer

### Scene: review — 代码审查

**Without MindOS**

- Scenario zh: 发布前最后一小时，你说："Review 这个支付模块 PR"
- Scenario en: One hour before release: "Review this payment-module PR."
- Step 1 zh: Agent 给出大量通用建议，但忽略你们的支付容错标准
- Step 1 en: Agent gives many generic tips but misses your payment fault-tolerance standards
- Step 2 zh: 你花时间筛噪音，真正高风险点被埋没
- Step 2 en: You burn time filtering noise while real high-risk issues stay hidden
- Step 3 zh: 上线后才暴露异常链路，回滚成本高
- Step 3 en: Failure path shows up after release, forcing expensive rollback
- Verdict zh: **高风险** 噪音多，关键点漏检
- Verdict en: **High risk** high noise, critical misses

**With MindOS**

- Scenario zh: 同一句话："Review 这个支付模块 PR"
- Scenario en: Same ask: "Review this payment-module PR."
- Step 1 zh: Agent 读取 Configs/Code-Standards.md + 历史缺陷模式
- Step 1 en: Agent reads Configs/Code-Standards.md plus historical defect patterns
- Step 2 zh: 优先标出真正会导致事故的问题：幂等、回滚、超时兜底
- Step 2 en: Prioritizes incident-prone issues: idempotency, rollback, timeout fallback
- Step 3 zh: 输出按风险等级排序，开发可直接照单修复
- Step 3 en: Outputs risk-ranked findings so engineers can fix immediately
- Verdict zh: **高命中** 按团队标准命中关键风险
- Verdict en: **High signal** critical risks found under your own standards

---

## Workflow (交互式心智循环)

- **Section Tag**: 04. THE SHARED MIND LOOP
- **Headline**
  - zh: 交互式心智循环
  - en: Interactive Mind Loop
- **Subhead**
  - zh: 人类记录思考，MindOS 同步心智，Agents 依此行动。一个循环，无限协同。
  - en: Humans capture thoughts, MindOS syncs the mind, Agents act accordingly. One loop, infinite synergy.

### Left: Human Mind

- **Title**
  - zh: 人类心智
  - en: Human Mind
- **Sub**
  - zh: 你的笔记、想法与工作流
  - en: Your notes, ideas & workflows

| File | Name | zh | en |
|------|------|----|---|
| mf-1 | Startup SOP.md | 产品发布标准流程 | Product launch standard procedure |
| mf-2 | Profile/Identity.md | 技术栈、偏好与风格 | Tech stack, preferences & style |
| mf-3 | Ideas/Next-Product.md | 下一个产品的灵感碎片 | Inspiration fragments for next product |
| mf-4 | Configs/Agent-Rules.md | Agent 行为规则与约束 | Agent behavior rules & constraints |
| mf-5 | Resources/Products.csv | 竞品追踪与产品库 | Competitor tracking & product library |

### Center: MindOS Bridge

- **Label**: MindOS
- **Protocol Tag**: MCP
- **Status States**
  - zh: 等待同步... / 检测到变更... / 同步中... / 心智已同步
  - en: Awaiting sync... / Change detected... / Syncing... / Mind synced

### Right: Agent Fleet

- **Title**
  - zh: Agent 舰队
  - en: Agent Fleet
- **Sub**
  - zh: 依此行动的 AI 协作者
  - en: AI collaborators acting on your mind

| Agent | Name | zh | en |
|-------|------|----|---|
| as-1 | Claude Code | 根据 SOP 搭建新项目骨架 | Scaffold new project from SOP |
| as-2 | Cursor | 按偏好重构 Dashboard 页面 | Refactor dashboard per preferences |
| as-3 | Codex | 为 API 模块补全单元测试 | Generate unit tests for API module |
| as-4 | Gemini CLI | 调研竞品功能并生成分析报告 | Research competitors, write report |
| as-5 | OpenClaw | 执行 CI/CD 流水线并自动部署 | Run CI/CD pipeline & auto-deploy |

---

## Features (核心功能特性)

- **Section Tag**: 05. FEATURES
- **Headline**
  - zh: 核心功能特性
  - en: Core Features

### Row 1: For Humans (人类侧)

| Feature | zh Title | en Title | zh Desc | en Desc |
|---------|----------|----------|---------|---------|
| GUI 工作台 | GUI 工作台 | GUI Workbench | 浏览、编辑、搜索笔记，统一搜索 + AI 入口（⌘K / ⌘/），专为人机共创设计。 | Browse, edit, search notes with unified search + AI entry (⌘K / ⌘/), designed for human-AI co-creation. |
| Agent 助手 | 内置 Agent 助手 | Built-in Agent Assistant | 在上下文中与知识库对话，Agent 管理文件，编辑无缝沉淀人类主动管理的知识。 | Converse with the knowledge base in context. Agents manage files while editing seamlessly captures human-curated knowledge. |
| 插件 | 插件扩展 | Plugin Extensions | 多种内置渲染器插件 — TODO Board, CSV Views, Wiki Graph, Timeline, Agent Inspector 等，实现弹性知识管理。 | Multiple built-in renderer plugins — TODO Board, CSV Views, Wiki Graph, Timeline, Agent Inspector, and more for elastic knowledge management. |

### Row 2: For Agents (Agent 侧)

| Feature | zh Title | en Title | zh Desc | en Desc |
|---------|----------|----------|---------|---------|
| MCP | MCP Server & Skills | MCP Server & Skills | 20+ 工具，stdio + HTTP 双传输，全阵容 Agent 兼容（OpenClaw, Claude Code, Cursor 等），零配置接入读写、搜索及执行本地工作流。 | 20+ tools, stdio + HTTP dual transport, full-lineup Agent compatible (OpenClaw, Claude Code, Cursor, etc.). Zero-config access to read, write, search, and execute local workflows. |
| 模板 | 结构化模板 | Structured Templates | 预置 Profile、Workflows、Configurations 等目录骨架，快速冷启动个人 Context。 | Pre-set directory structures for Profiles, Workflows, Configurations, etc., to jumpstart personal context. |
| Agent-Ready | 笔记即指令 | Agent-Ready Docs | 日常笔记天然就是 Agent 可直接执行的高质量指令——无需额外格式转换，写下即可调度。 | Everyday notes naturally double as high-quality executable Agent commands — no format conversion needed, write and dispatch. |

### Row 3: Infrastructure (基础设施)

| Feature | zh Title | en Title | zh Desc | en Desc |
|---------|----------|----------|---------|---------|
| 安全 | 安全防线 | Security | Bearer Token 认证、路径沙箱、INSTRUCTION.md 写保护、原子写入——Agent 操作受限于安全边界内。 | Bearer Token auth, path sandboxing, INSTRUCTION.md write-protection, atomic writes — Agent operations stay within secure boundaries. |
| 知识图谱 | 可视化知识图谱 | Visual Knowledge Graph | 动态解析并可视化文件间的引用与依赖关系，直观管理人机上下文网络。 | Dynamically parses and visualizes inter-file references and dependencies across the human-AI context network. |
| 时光机 | 时光机 & 版本控制 | Time Machine & Git-backed | Git 自动同步（commit/push/pull），记录人类与 Agent 的每次编辑历史，一键回滚，可视化 Context 演变。 | Git auto-sync (commit/push/pull), records every edit by both humans and Agents. One-click rollback, visualize context evolution. |

---

## Ecosystem (Agent 生态)

- **Section Tag**: 06. AGENT ECOSYSTEM
- **Headline**
  - zh: 无缝链接 Agents 生态
  - en: Seamless Agent Ecosystem

| Agent | zh Desc | en Desc |
|-------|---------|---------|
| OpenClaw | 开源 Agent 框架 | Open-source Agent Framework |
| Claude Code | 终端编程 Agent | Terminal Coding Agent |
| Codex | OpenAI 编程 Agent | OpenAI Coding Agent |
| Gemini CLI | Google 终端 Agent | Google Terminal Agent |
| GitHub Copilot | AI 编程副驾驶 | AI Pair Programmer |
| Cursor | AI 原生编辑器 | AI-native Code Editor |
| Trae | 字节 AI IDE | ByteDance AI IDE |
| CodeBuddy | 腾讯 AI 编程助手 | Tencent AI Coding Assistant |

---

## Story (真实体验) [hidden]

- **Section Tag**
  - zh: 真实体验
  - en: REAL STORY
- **Headline**
  - zh: 创造者的第一手体验
  - en: The Builder's First-Hand Experience
- **Quote Para 1**
  - zh: 我同时使用 5 个 Agent——Claude Code 写代码、Cursor 做重构、Codex 补测试、Gemini CLI 做调研、Trae 写前端。每次切换工具，我都得重复说明：我的技术栈、代码风格、项目背景、命名约定……
  - en: I use 5 Agents daily — Claude Code for coding, Cursor for refactoring, Codex for tests, Gemini CLI for research, Trae for frontend. Every time I switch tools, I repeat the same context: my tech stack, code style, project background, naming conventions…
- **Quote Para 2**
  - zh: 一个周末我统计了一下——**一周里，我在不同 Agent 里重复了 47 次相同的上下文。**每次都是复制粘贴同样的偏好，或者花 5 分钟解释"我们这个项目用 pnpm 不用 npm"。
  - en: One weekend I counted — **in a single week, I repeated the same context 47 times across different Agents.** Copy-pasting the same preferences, or spending 5 minutes explaining "this project uses pnpm, not npm."
- **Quote Para 3**
  - zh: 于是我把所有偏好和工作流写进一个本地知识库，通过 MCP 协议让每个 Agent 自动读取。第一个 Agent 搭项目时自动用了 Next.js 15 + Tailwind + pnpm；第二个做审查时按我的规范提 PR；第三个写文档时用了我的语气风格。
  - en: So I wrote all my preferences and workflows into a local knowledge base, exposed via MCP for every Agent to read. The first Agent scaffolded with Next.js 15 + Tailwind + pnpm automatically; the second reviewed PRs against my standards; the third wrote docs in my voice.
- **Quote Para 4**
  - zh: **47 次重复 → 0 次。**不是效率优化——是体验的质变。我终于不再当 Agent 的"人肉上下文复读机"了。
  - en: **47 repetitions → 0.** Not an optimization — a paradigm shift. I finally stopped being a "human context copy-paste machine" for my Agents.
- **Stats**: 47× → 0 → 5+
  - zh: 每周重复上下文 / 使用 MindOS 后 / Agent 共享同一心智
  - en: weekly context repeats / with MindOS / Agents share one mind
- **Author**
  - zh: GeminiLight · MindOS 创造者 / AI 独立开发者 · 同时使用 5+ Agent 的重度用户
  - en: GeminiLight · Creator of MindOS / AI Indie Developer · Heavy user of 5+ Agents daily

---

## Quickstart (快速开始)

- **Section Tag**: 07. QUICKSTART
- **Headline**
  - zh: 30 秒安装，一句话上手
  - en: 30-Second Setup. One Prompt to Start.

### Phase 1: Install

- **Title**
  - zh: 发给你的 Agent，自动安装一切
  - en: Send to Your Agent — Auto-Install Everything
- **Sub**
  - zh: 适用于任意支持 MCP 的 Agent：Claude Code、Cursor、Cline、Windsurf…
  - en: Works with any MCP-capable Agent: Claude Code, Cursor, Cline, Windsurf…
- **CLI Card** (divider + copyable card, matches Agent Prompt card style)
  - Divider: zh: —— 或手动安装 —— / en: —— or install manually ——
  - Badge: CLI
  - Command: `npm i -g @geminilight/mindos && mindos onboard`
  - Copy Button: zh: 复制 / 已复制 / en: Copy / Copied!
- **Badge**
  - zh: 安装 Prompt
  - en: Install Prompt
- **Copy Button**
  - zh: 复制 / 已复制
  - en: Copy / Copied!
- **Install Prompt**
  - zh: 帮我从 https://github.com/GeminiLight/MindOS 安装 MindOS，包含 MCP 和 Skills，使用中文模板。
  - en: Help me install MindOS from https://github.com/GeminiLight/MindOS with MCP and Skills. Use English template.
- **Auto Steps**
  - zh: 克隆仓库 → 初始化模板 → 配置环境 → 注册 MCP → 安装 Skills
  - en: Clone repo → Init template → Configure env → Register MCP → Install Skills
- **Agent Badges**: Claude Code · Cursor · Cline · Windsurf · CodeBuddy · Trae · Gemini CLI

### Phase 2: Try It Now

- **Title**
  - zh: 安装完成？试试这些
  - en: Installed? Try These
- **Sub**
  - zh: 直接粘贴给 Agent，立即体验 MindOS 的核心能力。
  - en: Paste any of these to your Agent and experience MindOS instantly.

| Card | Icon | zh Label | en Label | zh Prompt | en Prompt |
|------|------|----------|----------|-----------|-----------|
| 1 | 👤 | 注入身份 | Inject Profile | 读一下我的 MindOS 知识库，看看里面有什么，然后帮我把自我介绍写进 Profile。 | Read my MindOS knowledge base, see what's inside, then help me write my self-introduction into Profile. |
| 2 | 🔄 | 沉淀经验 | Distill SOP | 帮我把这次对话的经验沉淀到 MindOS，形成一个可复用的工作流。 | Help me distill the experience from this conversation into MindOS as a reusable SOP. |
| 3 | ▶️ | 执行工作流 | Run Workflow | 帮我执行 MindOS 里的 XXX 工作流。 | Help me execute the XXX SOP from MindOS. |

---

## Footer

- **Branding**
  - zh: MindOS · 人机协同心智系统
  - en: MindOS · Human-AI Collaborative Mind System
- **Link**: GitHub
- **Copyright**: MIT © 2026 GeminiLight
