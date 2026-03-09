# 🤖 Agent 常用 Skill

## 1️⃣ 安装方式与路径

Skill 是各 Agent CLI 工具的可安装扩展，基于 `SKILL.md` 开放标准，各工具通用。支持 Claude Code、Codex、Gemini CLI、iFlow 等 40+ Agent。默认为全局安装。

推荐使用 [skills.sh](https://skills.sh) 统一管理：

```bash
npx skills add <owner/repo>                          # 安装 repo 下所有 skill
npx skills add <owner/repo> --skill <skill-name>     # 安装指定 skill
npx skills add <url> --skill <skill-name>            # 通过完整 URL 安装
npx skills list                                      # 查看已安装
npx skills find [query]                              # 搜索
npx skills remove <name>                             # 卸载
npx skills update                                    # 更新所有
npx skills check                                     # 检查可用更新
```

> 加 `-g` 全局安装，加 `-a <agent>` 指定工具

各工具全局 Skill 路径（手动安装时使用）：

| 工具 | 全局 Skill 路径 |
|------|----------------|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Gemini CLI | `~/.gemini/skills/` |
| iFlow | `~/.iflow/skills/` |

## 2️⃣ 常用 Skill 及分类

### 🤖 Agent 工具

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| find-skills | 发现并安装新 Skill | 询问"有没有能做 X 的 Skill" | [vercel-labs/skills](https://github.com/vercel-labs/skills) |
| skill-creator | 创建、修改、测评 Skill | 开发新 Skill 或优化现有 Skill | [anthropics/skills](https://github.com/anthropics/skills) |

### 🛍️ 产品

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| product-designer | UI/UX 设计、设计系统、用户研究 | 产品原型设计、交互方案 | [borghei/claude-skills](https://github.com/borghei/claude-skills) |
| defining-product-vision | 撰写产品愿景与长期方向 | 写 Vision Statement、对齐团队目标 | [refoundai/lenny-skills](https://github.com/refoundai/lenny-skills) |
| product-taste-intuition | 培养产品直觉与判断力 | 评估设计质量、做产品决策 | [refoundai/lenny-skills](https://github.com/refoundai/lenny-skills) |
| ai-product-strategy | 用 AI 方法制定产品战略（定位、取舍、路径） | 需要做产品战略分析、路线规划或策略取舍时 | [refoundai/lenny-skills](https://github.com/refoundai/lenny-skills) |
| product-manager-toolkit | 产品需求拆解、优先级、PRD 思路 | 需要做需求分析、PRD 或产品优先级决策时 | [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) |
| business-model-canvas | 商业模式画布分析 | 梳理产品或项目的商业模式 | [anthropics/skills](https://github.com/anthropics/skills) |
| startup-business-analyst-business-case | 创业项目商业案例分析 | 评估商业可行性、撰写商业计划 | [anthropics/skills](https://github.com/anthropics/skills) |
| customer-persona | 构建 ICP 与用户画像 | 产品验证、用户细分、需求切入 | [tul-sh/skills](https://github.com/tul-sh/skills) |
| marketing-ideas | SaaS 产品营销创意（140+ 策略） | 需要营销灵感或推广方向时 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) |

### 💻 开发

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| frontend-design | 生成高质量前端界面（React/HTML/CSS） | 构建网页、组件、落地页、Dashboard | [anthropics/skills](https://github.com/anthropics/skills) |
| theme-factory | 为 slides、文档、HTML 页面等应用主题样式（10 套预设主题） | 需要统一视觉风格时 | [anthropics/skills](https://github.com/anthropics/skills) |
| webapp-testing | 用 Playwright 测试本地 Web 应用，支持截图、UI 调试、浏览器日志 | 验证前端功能、调试 UI 行为 | [anthropics/skills](https://github.com/anthropics/skills) |
| agent-browser | 浏览器自动化与网页任务执行（导航、交互、抓取） | 需要让 Agent 在浏览器中完成端到端网页操作时 | [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) |
| mcp-builder | 创建 MCP Server，支持 Python（FastMCP）和 TypeScript | 需要构建 MCP 服务集成外部 API 时 | [anthropics/skills](https://github.com/anthropics/skills) |
| prompt-engineering-patterns | 生产级 Prompt 设计与优化，含 CoT、Few-shot、结构化输出、模板系统 | 设计 System Prompt、调优 LLM 应用 Prompt、提升输出一致性 | [wshobson/agents](https://github.com/wshobson/agents) |
| cost-aware-llm-pipeline | LLM 成本感知工程设计，将 token 与推理成本前置到工程决策 | 构建 AI 产品时控制推理成本 | [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) |
| vercel-react-best-practices | React/Next.js 性能优化规范 | 编写或 Review React/Next.js 代码 | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| stripe-integration | Stripe 支付接入 | 需要为产品接入支付功能时 | [dadbodgeoff/drift](https://github.com/dadbodgeoff/drift) |
| remotion-best-practices | Remotion 视频开发最佳实践 | 用 React 制作视频 | [remotion-dev/skills](https://github.com/remotion-dev/skills) |

### 📄 文档

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| docx | 创建、读取、编辑 Word 文档 | 需要生成或处理 .docx 文件时 | [anthropics/skills](https://github.com/anthropics/skills) |
| pdf | PDF 读取、合并、拆分、加水印、OCR 等 | 需要处理 .pdf 文件时 | [anthropics/skills](https://github.com/anthropics/skills) |
| pptx | 创建、编辑 PPT，解析提取内容 | 需要生成或处理 .pptx 文件时 | [anthropics/skills](https://github.com/anthropics/skills) |
| xlsx | 创建、编辑 Excel/CSV，清洗表格数据 | 需要生成或处理 .xlsx/.csv 文件时 | [anthropics/skills](https://github.com/anthropics/skills) |

### ⚡ 效率

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| felo-slides | 根据文字描述自动生成 PPT | 需要快速生成演示文稿时 | [Felo-Inc/felo-skills](https://github.com/Felo-Inc/felo-skills) |
| doc-coauthoring | 结构化协作撰写文档、技术规范、提案 | 需要写文档、起草规范或提案时 | [anthropics/skills](https://github.com/anthropics/skills) |
| internal-comms | 撰写内部通知、状态报告、项目更新等 | 需要写内部沟通文案时 | [anthropics/skills](https://github.com/anthropics/skills) |
| agent-email-cli | 让 Agent 读写邮箱、起草与发送邮件（CLI 工作流） | 需要自动化处理收件箱、批量回信或邮件草拟时 | [zaddy6/agent-email-skill](https://skills.sh/zaddy6/agent-email-skill/agent-email-cli) |


### 📱 社交媒体

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| xiaohongshu | 搜索小红书内容、获取帖子详情/评论/互动数据、舆情分析 | 分析小红书热点、跟踪话题讨论 | [zhjiang22/openclaw-xhs](https://github.com/zhjiang22/openclaw-xhs) |
| write-xiaohongshu | 研究爆款规律 → 写标题/正文/标签 → 发布全流程 | 写小红书笔记、种草文案、爆款标题 | [adjfks/corner-skills](https://github.com/adjfks/corner-skills) |
| xiaohongshu-note-analyzer | 分析笔记关键词、标题吸引力、敏感词风险、互动潜力 | 发布前审核笔记内容、优化曝光率 | [softbread/xiaohongshu-doctor](https://github.com/softbread/xiaohongshu-doctor) |
| twitter-automation | 自动化 X/Twitter 内容发布、互动与运营流程 | 需要定时发帖、批量运营或增长自动化时 | [toolshell/twitter-automation](https://skills.sh/toolshell/skills/twitter-automation) |
| landing-page-copywriter | 落地页价值主张文案，适合快速验证转化 | 需要写产品落地页、冷启动文案时 | [onewave-ai/claude-skills](https://github.com/onewave-ai/claude-skills) |
| storybrand-messaging | 把产品能力转成用户听得懂的叙事框架 | 需要梳理产品故事线、对外传播内容时 | [wondelai/skills](https://github.com/wondelai/skills) |
| marketing-demand-acquisition | 早期获客和渠道动作模板化 | 冷启动阶段制定分发策略时 | [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) |
| onboarding-cro | 从注册到激活的转化优化，兼顾 UX 与留存增长 | 优化用户注册/激活流程、提升留存 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) |

#### twitter-automation 额外配置说明

该 Skill 依赖 inference.sh CLI（`infsh`），不是直接调用 X 官方 API。

首次使用建议按下面顺序完成：

```bash
# 安装 inference.sh 工具集（包含 infsh）
npx skills add inference-sh/skills@agent-tools

# 登录 inference.sh
infsh login
```

基础验证：

```bash
# 查看可用应用（应能看到 x/post-tweet 等）
infsh app list

# 发一条测试推文
infsh app run x/post-tweet --input '{"text": "Hello from inference.sh!"}'
```

常用能力：`x/post-tweet`、`x/post-create`（带媒体）、`x/post-like`、`x/post-retweet`、`x/dm-send`、`x/user-follow`。

> 若执行失败，优先检查：`infsh` 是否已安装、是否已 `infsh login`、inference.sh 侧是否完成 X 账号授权。


### 🎨 设计

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| canvas-design | 生成海报、视觉设计，输出 PNG/PDF | 需要制作海报或静态视觉设计时 | [anthropics/skills](https://github.com/anthropics/skills) |
| refactoring-ui | 高密度 UI 设计准则，提升界面质感与层级清晰度 | Review UI、提升视觉质量时 | [wondelai/skills](https://github.com/wondelai/skills) |
| ui-design-patterns | 常见交互模式库，快速构建一致且可用的产品交互 | 需要参考标准交互模式时 | [manutej/luxor-claude-marketplace](https://github.com/manutej/luxor-claude-marketplace) |

### 🔬 科研

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|

| ml-paper-writing | 撰写 ML/AI 论文（NeurIPS/ICML/ICLR 等） | 从研究仓库起草论文、准备投稿 | [zechenzhangagi/ai-research-skills](https://github.com/zechenzhangagi/ai-research-skills) |
| research-paper-writer | 撰写正式学术论文（IEEE/ACM 格式） | 写研究论文、会议论文 | [ailabs-393/ai-labs-claude-skills](https://github.com/ailabs-393/ai-labs-claude-skills) |
| scientific-paper-figure-generator | 生成发表级科学图表 | 为论文生成实验结果图、可视化 | [dkyazzentwatwa/chatgpt-skills](https://github.com/dkyazzentwatwa/chatgpt-skills) |


### 🧠 思维

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| scientific-critical-thinking | 评估研究严谨性（方法论、偏差、统计、GRADE/Cochrane ROB） | 评估论文方法论、识别偏差与逻辑谬误、判断证据质量 | [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) |
| systems-thinking | 系统思维，理解复杂系统的动态与反馈 | 需要从全局视角分析问题时 | [refoundai/lenny-skills](https://github.com/refoundai/lenny-skills) |

## 🛠️ 自建 Skills

### 🔬 科研

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| ml-position-paper-writer | 撰写 ML 立场论文、视野论文 | 有观点想写成学术文章 | - |
