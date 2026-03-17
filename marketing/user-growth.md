# 用户增长策略

## 当前阶段：P1 开源增长期

核心目标：从 0 → 种子用户，验证产品价值，收集真实反馈。

> 微信内测群运营详见 [wechat-community.md](./wechat-community.md)

---

## 增长飞轮

MindOS 不是通用工具，增长逻辑和普通开源项目不同。核心飞轮：

```
用户配置 MindOS MCP → Agent 读写知识库产生价值 → 用户写 Skill/模板 → 分享 Skill/配置 → 他人发现 MindOS → 安装
                                                                          ↑                                    |
                                                                          └────────────────────────────────────┘
```

**三个天然分发载体：**

| 载体 | 传播机制 | 为什么有效 |
|------|---------|-----------|
| **Agent 配置文件** | 用户分享 CLAUDE.md / .cursorrules，里面写了 MindOS MCP 地址 | 开发者爱分享 dotfiles，每份配置都是免费广告 |
| **Skill 文件** | 用户写的 Skill 被他人复用 | Skill 只能在 MindOS 里跑，用了就得装 MindOS |
| **知识库模板** | "AI 创始人模板""研究项目模板"被传播 | 模板降低上手门槛，同时锁定 MindOS 格式 |

---

## 渠道策略

### 第零优先：种子用户激活（先留存，再拉新）

种子期最重要的不是获客，是验证留存。30 人内测群里如果没人真的用起来，拉再多新用户也会漏掉。

| 动作 | 具体怎么做 | 验证标准 |
|------|-----------|---------|
| 1:1 跟进 | 主动私聊已安装的用户，问"卡在哪了" | 10+ 人完成首次 MCP 读写 |
| 场景共创 | 收集 3 个真实使用场景，帮用户配好 | 至少 3 人连续使用 7 天 |
| 快速修 bug | 群里反馈 30 分钟内响应 | 用户感到"被听见" |
| 口碑触发设计 | `mindos token` 生成的配置片段末尾自动带 `# Powered by MindOS` + GitHub 链接 | 每次分享配置都是免费广告 |

> 详见 [wechat-community.md](./wechat-community.md)

### 第一优先：MCP 生态占位（独有优势，别人没有）

MCP 是新协议，生态目录正在建设，现在占位 = 长期被动获客。

| 动作 | 具体怎么做 | 预期效果 |
|------|-----------|---------|
| 注册到 MCP 官方目录 | mcp.so / glama.ai / awesome-mcp-servers 等 | 搜索 "knowledge management MCP" 直接找到 |
| 提交到 Agent 集成市场 | Claude MCP marketplace、Cursor extensions | Agent 用户在找工具时直接发现 |
| 写 MCP 教程 | "如何让 Claude Code 记住你的所有项目上下文" | 截流搜索意图，文末引导安装 MindOS |
| MCP 社区活跃 | GitHub Discussions、Discord 回答 MCP 相关问题 | 建立"MCP 知识管理 = MindOS"心智 |

### 第二优先：搜索意图截流

这些搜索词正在增长，还没有好内容占位：

| 搜索意图 | 内容形式 | 落地页 |
|---------|---------|--------|
| "share context between AI agents" | 英文博客 | GitHub README / 博客 |
| "Claude Code memory management" | 教程 | mindos.app/guides |
| "MCP server for notes / knowledge" | awesome-list 条目 | npm 包页 |
| "Obsidian MCP" / "Notion MCP" / "AI second brain" | 竞品对比博客 | 博客 / SEO |
| "AI Agent 记忆管理" / "多 Agent 上下文共享" | 中文博客 | 即刻 / 知乎 |
| "CLAUDE.md 最佳实践" | 教程 + 模板 | GitHub template repo |

### 第三优先：开发者社区

| 渠道 | 策略 | 指标 |
|------|------|------|
| **GitHub** | Topic 标签优化（mcp, knowledge-management, ai-agent）+ awesome-list 提交 + 持续 commit | Stars, Forks |
| **Hacker News** | Show HN（时机：有 demo 视频 + 至少 50 stars 时） | 首页停留、评论数 |
| **Product Hunt** | Launch（时机：与 Show HN 错开，README + demo 视频就绪时） | Upvotes、评论数 |
| **X / Twitter** | 工作流 demo 短视频 + 参与 #MCP #AIAgent 话题 | Impressions |
| **即刻 / 小红书** | "AI 工作流"场景图文 | 点赞 + 收藏 |
| **V2EX / 知乎** | 技术向帖子 / 回答 Agent 记忆相关问题 | 回复 + 赞同 |

### 第四优先：被动分发（设置好就不用管）

| 动作 | 一次性设置 |
|------|-----------|
| npm 包关键词优化 | `keywords: ["mcp", "knowledge-management", "ai-agent", "markdown", "local-first"]` |
| GitHub Topics | mcp, knowledge-base, ai-agent, markdown, local-first |
| README 加 badge | npm version, downloads, GitHub stars — 社会证明 |
| 提供 "一键分享配置" | `mindos token --share` 生成可分享的 Agent 配置片段 |

---

## 内容策略

### 核心内容矩阵

| 类型 | 示例 | 目标受众 | 分发渠道 |
|------|------|---------|---------|
| **场景痛点** | "你的 5 个 AI Agent 各记各的" | 还没用过 MindOS 的人 | X / 即刻 / 小红书 |
| **工作流 demo** | 录屏：Claude Code 通过 MCP 读写知识库 | 想试但不知道怎么用的人 | YouTube / B站 / GitHub |
| **MCP 教程** | "3 分钟让 Cursor 读取你的知识库" | MCP 生态搜索流量 | 博客 / 知乎 / Dev.to |
| **Skill/模板分享** | "AI 创始人知识库模板" | 想快速上手的人 | GitHub template / 即刻 |
| **对比测评** | MindOS vs Obsidian+AI vs Notion AI | 在做选型的人 | 博客 / SEO |
| **用户故事** | 内测用户真实使用场景 | 需要社会证明的人 | X / 即刻 |

### 生产节奏

**最低线（独立创始人可持续）：**
- 每周 1 条社交媒体内容（X / 即刻 / 小红书轮换）

**理想线（有余力时叠加）：**
- 每 2 周 1 个工作流 demo 视频
- 每月 1 篇 MCP 教程（SEO 长期价值）
- 每月 1 个可分享的 Skill 或模板

---

## 增长指标 (North Star)

与 [产品提案 → 成功指标](../wiki/00-product-proposal.md) 对齐：

| 阶段 | 指标 | 目标 |
|------|------|------|
| **当前（种子期）** | 内测群 → 安装转化率 | > 30% |
| **P1** | 周活跃知识库数 | 100+ |
| **P1.5** | 累计活跃知识库 + GitHub issues | 300+，50+ issues |
| **P2** | MAU + 7d 留存率 | 1000+，> 40% |

**先行指标（leading indicators）：**

| 指标 | 为什么重要 | 追踪方式 |
|------|-----------|---------|
| npm weekly installs | 唯一无需注册的硬数据，最早反映增长趋势 | npm stats / npmtrends.com |
| MCP 目录收录数 | 被动获客的基础 | 手动检查各目录 |
| "mindos" 搜索量 | 品牌认知 | Google Trends / npm search |
| Agent 配置文件中提及 MindOS 的数量 | 自然分发强度 | GitHub code search |
| Skill/模板被 fork 或下载的次数 | 飞轮转速 | GitHub analytics |

---

## 待办（按优先级）

- [ ] 种子用户 1:1 跟进（内测群已安装用户逐个私聊）
- [ ] 注册 MCP 官方目录（mcp.so / glama.ai / awesome-mcp-servers）
- [x] GitHub Topics + README badge 优化
- [ ] 录制 2 分钟 demo 视频
- [ ] 写第一篇 MCP 教程："让 Claude Code 记住你的所有项目上下文"
- [ ] 写一篇竞品对比："MindOS vs Obsidian+AI vs Notion AI for Agent Memory"
- [ ] 准备 2-3 个可分享的知识库模板（AI 创始人 / 研究项目 / 开发者）
- [ ] 准备 Show HN 帖子草稿
- [ ] 准备 Product Hunt launch 素材
- [x] npm 包 keywords 优化
- [ ] `mindos token` 输出末尾加 `# Powered by MindOS` 注释
