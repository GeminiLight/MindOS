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
| business-model-canvas | 商业模式画布分析 | 梳理产品或项目的商业模式 | [anthropics/skills](https://github.com/anthropics/skills) |
| startup-business-analyst-business-case | 创业项目商业案例分析 | 评估商业可行性、撰写商业计划 | [anthropics/skills](https://github.com/anthropics/skills) |
| marketing-ideas | SaaS 产品营销创意（140+ 策略） | 需要营销灵感或推广方向时 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) |

### 💻 开发

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| frontend-design | 生成高质量前端界面（React/HTML/CSS） | 构建网页、组件、落地页、Dashboard | [anthropics/skills](https://github.com/anthropics/skills) |
| theme-factory | 为 slides、文档、HTML 页面等应用主题样式（10 套预设主题） | 需要统一视觉风格时 | [anthropics/skills](https://github.com/anthropics/skills) |
| webapp-testing | 用 Playwright 测试本地 Web 应用，支持截图、UI 调试、浏览器日志 | 验证前端功能、调试 UI 行为 | [anthropics/skills](https://github.com/anthropics/skills) |
| mcp-builder | 创建 MCP Server，支持 Python（FastMCP）和 TypeScript | 需要构建 MCP 服务集成外部 API 时 | [anthropics/skills](https://github.com/anthropics/skills) |
| prompt-engineering-patterns | 生产级 Prompt 设计与优化，含 CoT、Few-shot、结构化输出、模板系统 | 设计 System Prompt、调优 LLM 应用 Prompt、提升输出一致性 | [wshobson/agents](https://github.com/wshobson/agents) |
| vercel-react-best-practices | React/Next.js 性能优化规范 | 编写或 Review React/Next.js 代码 | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
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

### 📱 社交媒体

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| xiaohongshu | 搜索小红书内容、获取帖子详情/评论/互动数据、舆情分析 | 分析小红书热点、跟踪话题讨论 | [zhjiang22/openclaw-xhs](https://github.com/zhjiang22/openclaw-xhs) |
| write-xiaohongshu | 研究爆款规律 → 写标题/正文/标签 → 发布全流程 | 写小红书笔记、种草文案、爆款标题 | [adjfks/corner-skills](https://github.com/adjfks/corner-skills) |
| xiaohongshu-note-analyzer | 分析笔记关键词、标题吸引力、敏感词风险、互动潜力 | 发布前审核笔记内容、优化曝光率 | [softbread/xiaohongshu-doctor](https://github.com/softbread/xiaohongshu-doctor) |

### 🎨 设计

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| canvas-design | 生成海报、视觉设计，输出 PNG/PDF | 需要制作海报或静态视觉设计时 | [anthropics/skills](https://github.com/anthropics/skills) |

### 🔬 科研

| 名称 | 用途 | 触发场景 | 文件链接 |
|------|------|----------|----------|
| arxiv-search | 语义搜索 arXiv 论文 | 查找某方向的相关论文 | [yorkeccak/scientific-skills](https://github.com/yorkeccak/scientific-skills) |
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
