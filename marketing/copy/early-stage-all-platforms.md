# MindOS 早期测试版 — 多平台营销材料

*由 /ai-marketing-engine 生成 | 2026-03-27*
*适用阶段：测试版（bug 较多），重点是获取早期反馈而非大规模获客*

---

## 平台分组策略

| 分组 | 平台 | 策略 | 核心调性 |
|------|------|------|---------|
| **A 组：立刻发** | 即刻、V2EX、X/Twitter、GitHub | 拥抱早期，building in public | 真实、坦诚、邀请共建 |
| **B 组：注明测试版** | Reddit、W2Solo、Indie Hackers | 分享项目，寻求反馈 | 谦逊、开放、求助姿态 |
| **C 组：等稳定后** | Product Hunt、HN、小红书、知乎、少数派 | 正式 launch | 见 marketing/copy/ 已备文案 |

---

## 共享核心信息（所有平台复用）

**一句话：** MindOS 是一个开源的本地知识库，让你的所有 AI 工具共享同一份项目记忆。

**三个卖点：**
1. 写一次项目背景，Claude Code / Cursor / Gemini CLI 全都能读
2. 纠正过 AI 的判断会被记住，下次不用再纠正
3. 数据全在本地，纯 Markdown，零锁定

**测试版声明模板：**
> 目前是早期测试版，还有不少粗糙的地方。但核心流程（安装 → 写入知识库 → Agent 读取）已经跑通。非常欢迎反馈和建议。

---

## A 组：即刻

### 动态 1：首次亮相

> 做了几个月的一个开源小工具，今天第一次拿出来聊聊。
>
> 起因很简单：我每天同时用 Claude Code、Cursor 和 Gemini CLI，最烦的事情是每换一个工具就要把项目背景重新讲一遍。
>
> 于是做了 MindOS——一个本地知识库，通过 MCP 协议让所有 AI 工具直接读取你的项目记忆。写一次，全都知道。
>
> 还很早期，bug 不少，但核心流程跑通了。如果你也在同时用多个 AI 工具，欢迎试试给我反馈：
> github.com/GeminiLight/mindos-dev
>
> 特别想知道：你们平时是怎么在多个 AI 工具之间管理上下文的？

### 动态 2：开发日志（后续持续发）

> MindOS 开发日记 Day X：
>
> 今天修了 [具体 bug/加了具体功能]。
>
> 一个有意思的发现：[开发过程中的洞察/用户反馈/技术决策]
>
> [截图]

### 动态 3：求助型

> 做 MindOS 遇到一个产品决策想听听大家意见：
>
> [具体问题，比如"一键导入应该从 GitHub repo 导入还是从本地文件夹导入？"]
>
> 目前倾向 [X]，因为 [理由]。但也可能 [Y] 更好。你们觉得呢？

### 即刻发布建议
- **圈子：** AI探索站、独立开发者的日常、效率工具
- **频率：** 每周 2-3 条
- **风格：** 像朋友聊天，不要公关稿
- **关键：** 每条都以提问结尾，引发互动

---

## A 组：V2EX（"分享创造"节点）

### 帖子标题

> 分享一个开源工具：让所有 AI 工具共享同一份项目记忆

### 帖子正文

> 各位好，分享一个自己在做的开源项目 MindOS。
>
> **解决什么问题**
>
> 同时用多个 AI 编程工具（Claude Code、Cursor、Gemini CLI 等）的时候，每次切工具都要重新交代项目背景。纠正过 AI 的一个判断，关掉对话就丢了。
>
> **怎么解决的**
>
> MindOS 是一个本地知识库，通过 MCP 协议让所有 AI 工具直接读取。你在知识库里写一次项目背景、代码规范、个人偏好，所有工具自动读取。
>
> 技术栈：Next.js + MCP Server（stdio + HTTP）+ 纯 Markdown 存储 + Git 自动同步
>
> **当前状态**
>
> - v0.5.70，npm 可安装
> - 支持 Claude Code、Cursor、Cline、Zed、Windsurf 等 10+ Agent
> - 有 GUI 工作台 + CLI + 桌面端（macOS/Windows/Linux）
> - MIT 开源
>
> **坦诚说明**
>
> 还是早期测试版，肯定有 bug。但核心流程（安装 → 写入 → Agent 读取）已经稳定。
>
> 非常欢迎试用和反馈，尤其是：
> 1. 安装过程有没有卡住的地方
> 2. 你觉得最需要的功能是什么
> 3. 和你现有工作流的冲突点
>
> GitHub: github.com/GeminiLight/mindos-dev
> npm: `npm install -g @aspect/mindos`
>
> 感谢！

### V2EX 发布建议
- **节点：** /go/create（分享创造）
- **注意：** V2EX 反感营销味，用"分享+求反馈"的姿态
- **后续：** 认真回复每条评论

---

## A 组：X / Twitter

### Tweet 1：首次介绍（单条）

> I've been building MindOS — an open-source local knowledge base that lets all your AI tools share the same project context through MCP.
>
> Write your decisions once. Claude Code, Cursor, Gemini CLI all read it automatically.
>
> Early stage, rough edges. Would love feedback.
> github.com/GeminiLight/mindos-dev

### Tweet 2：痛点共鸣（单条）

> The dumbest thing about using 3 AI coding tools:
>
> Explaining the same project context to each one. Every. Single. Time.
>
> Building something to fix this. It's called MindOS — one shared knowledge base for all your agents.
>
> Open source, local-first, zero lock-in.

### Thread：Building in Public

> 🧵 I'm building MindOS, an open-source "shared brain" for AI agents. Here's why and what I've learned so far.
>
> 1/ The problem: I use Claude Code + Cursor + Gemini CLI daily. Each one has zero idea what the others know. I spend ~20 min/day just copy-pasting project context between tools.
>
> 2/ The insight: The fix isn't better memory in each tool. It's a shared context layer that all tools can read. Like a project wiki, but for AI agents.
>
> 3/ How it works: MindOS is a local knowledge base. You write your project decisions, coding standards, and preferences in Markdown. All AI tools connect via MCP protocol and read it automatically.
>
> 4/ Current state: v0.5.70, supports 10+ agents, has GUI + CLI + desktop app. MIT open source. Still early — bugs exist. But the core flow works.
>
> 5/ What I've learned building this:
> - Most devs don't realize how much time they waste re-explaining context
> - "Agent memory" is not the same as "user-governed context"
> - Local-first + plain Markdown = zero lock-in = trust
>
> 6/ If you use multiple AI coding tools, I'd love your feedback. What's the most annoying part of switching between them?
>
> github.com/GeminiLight/mindos-dev

### X/Twitter 发布建议
- **频率：** 每周 3-5 条（1-2 条产品相关，2-3 条 AI 观点/行业思考）
- **互动：** 回复所有评论，参与 AI builder 社区讨论
- **避免：** hashtag 堆砌、纯广告

---

## A 组：GitHub README 状态声明

在 README 顶部加一个明确的状态 badge：

```markdown
> ⚠️ **Early Preview** — Core workflow (install → write → agent reads) is stable. 
> Rough edges exist. [Report issues](link) or [join the discussion](link).
```

---

## B 组：Reddit

### 适合的 Subreddit

| Subreddit | 帖子标题 | 注意 |
|-----------|---------|------|
| **r/ClaudeAI** | "I built an open-source tool to share project context across Claude Code, Cursor, and other MCP agents" | 最精准，强调 MCP |
| **r/LocalLLaMA** | "MindOS: local-first knowledge base that all your AI agents can read via MCP" | 强调 local-first |
| **r/SideProject** | "Show my side project: MindOS — shared brain for AI coding agents" | 侧重项目展示 |
| **r/selfhosted** | "Self-hosted knowledge base for multi-agent workflows (MCP-native, Markdown, Git sync)" | 强调自托管 |

### Reddit 通用帖子模板

> **What it is:** MindOS is an open-source, local-first knowledge base that lets all your AI tools (Claude Code, Cursor, Gemini CLI, etc.) share the same project context through MCP protocol.
>
> **Why I built it:** I use 3+ AI coding tools daily and got tired of re-explaining project context to each one. Corrections get lost between sessions. There's no shared memory layer across tools.
>
> **How it works:** You write project decisions, coding standards, and preferences in Markdown. AI tools connect via MCP and read automatically. Everything stays local, pure text, zero lock-in.
>
> **Current state:** v0.5.70, early preview. Supports 10+ agents. GUI + CLI + desktop app. MIT open source. Bugs exist — core flow is stable.
>
> **Looking for:** Early feedback, especially on the install experience and what features you'd want most.
>
> GitHub: [link]
>
> Happy to answer any questions!

### Reddit 发布建议
- **每个 subreddit 间隔 2-3 天发**，不要同一天群发
- **先在每个 subreddit 参与 5-10 条评论再发帖**（否则会被当 spam）
- **认真回复每条评论**——Reddit 用户最看重作者的参与度

---

## B 组：W2Solo / Indie Hackers（共用一套）

### 帖子标题

> 独立开发 3 个月，做了一个让所有 AI 工具共享记忆的开源工具

### 帖子正文

> 大家好，分享一下我正在做的项目 MindOS。
>
> **背景**
>
> 我是独立开发者，每天同时用 Claude Code、Cursor 和 Gemini CLI 写代码。最大的痛点是每个工具的记忆互相隔离——切工具就要重新交代背景，纠正过的判断关掉就丢。
>
> **产品**
>
> MindOS 是一个开源的本地知识库，通过 MCP 协议让所有 AI 工具直接读取你的项目记忆。一次写入，全部复用。
>
> **当前数据**
>
> - 开发 3 个月，v0.5.70
> - 内测用户约 30 人
> - 收入：$0（免费开源阶段）
> - 团队：1 人
>
> **下一步**
>
> 1. 收集更多用户反馈，验证需求
> 2. 优化首次体验路径
> 3. 探索 Pro 付费版本（AI 增强功能）
>
> **想请教**
>
> - 你们觉得这个需求真实吗？还是我在自嗨？
> - 开源工具怎么从"有人用"到"有人付费"？
> - 有没有类似的早期项目推广经验分享？
>
> GitHub: [link]

### W2Solo / Indie Hackers 发布建议
- **关键：** 真实数据 + 真实困惑 + 邀请讨论
- **避免：** 过度美化数据，社区一眼能看穿
- **后续：** 定期更新进展（月更即可）

---

## Awesome 列表 PR 模板（GitHub）

提 PR 加入各类 awesome 列表：

### awesome-mcp-servers PR

```markdown
## MindOS

- [MindOS](https://github.com/GeminiLight/mindos-dev) - Personal Context OS for multi-agent users. Local-first knowledge base that all AI agents can read and write through MCP. Supports Claude Code, Cursor, Gemini CLI, and 10+ agents.
```

### awesome-selfhosted PR

```markdown
## MindOS

- [MindOS](https://github.com/GeminiLight/mindos-dev) - Self-hosted knowledge base for multi-agent workflows. Local Markdown files, MCP-native, Git auto-sync, GUI + CLI + desktop app. `MIT` `Nodejs`
```

### 目标列表

- [ ] awesome-mcp-servers（搜索 GitHub 找到最高 star 的那个）
- [ ] awesome-selfhosted
- [ ] awesome-markdown
- [ ] awesome-developer-tools
- [ ] awesome-ai-tools

---

## 发布节奏（测试版阶段）

### Week 1
- [ ] GitHub README 加 Early Preview 状态声明
- [ ] 即刻发首条动态（动态 1）
- [ ] V2EX "分享创造"发帖
- [ ] Awesome MCP 列表提 PR

### Week 2
- [ ] X/Twitter 发首条 tweet
- [ ] Reddit r/ClaudeAI 发帖（先参与 5 天评论）
- [ ] 即刻发第二条（开发日志）

### Week 3
- [ ] X/Twitter 发 thread
- [ ] Reddit r/SideProject 发帖
- [ ] W2Solo 发帖
- [ ] 即刻发第三条（求助型）

### Week 4
- [ ] Reddit r/LocalLLaMA + r/selfhosted 发帖
- [ ] Indie Hackers 发帖
- [ ] 回顾反馈，调整下月策略

---

## 效果追踪

| 指标 | 目标（Month 1） |
|------|----------------|
| GitHub star 增长 | +50 |
| npm 安装量 | +100 |
| 即刻粉丝 | 50+ |
| X/Twitter 粉丝 | 30+ |
| 用户反馈条数 | 10+ |
| 发现的新 bug | 记录并修复 |
