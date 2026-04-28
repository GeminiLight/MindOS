# OpenClaw 内置工具清单

> 调研日期：2026-03-18
> 来源：OpenClaw 官方文档、技术博客、社区教程综合整理

## 概述

OpenClaw 的工具系统分为两层：
- **Layer 1（核心能力）**：8 个基础工具，覆盖文件操作、Shell 执行、网络存取
- **Layer 2（进阶能力）**：17+ 个工具，覆盖浏览器自动化、记忆管理、多 Session、消息推送、硬件控制、定时任务等

工具按需加载：system prompt 中只放工具目录（名称 + 一句话描述），模型选择后才加载完整定义。

---

## Layer 1 — 核心工具（8 个）

| 工具名 | 分类 | 功能 |
|--------|------|------|
| `read` | 文件操作 | 读取文件内容 |
| `write` | 文件操作 | 创建或覆盖文件 |
| `edit` | 文件操作 | 精确编辑文件（局部修改） |
| `apply_patch` | 文件操作 | 应用代码补丁 |
| `exec` | Shell 执行 | 执行系统 Shell 命令（支持 pty，可运行 TTY 需求的 CLI） |
| `process` | 进程管理 | 管理后台进程（监控、停止） |
| `web_search` | 网络存取 | 关键词检索（Brave Search API） |
| `web_fetch` | 网络存取 | 抓取网页内容并提取可读文本（带缓存） |

## Layer 2 — 进阶工具（17+ 个）

### 浏览器 & 可视化

| 工具名 | 功能 | 操作 |
|--------|------|------|
| `browser` | 控制 Chrome 浏览器（CDP 协议） | status / start / stop / tabs / open / focus / close / snapshot / screenshot / act / navigate |
| `canvas` | 可视化工作区（渲染交互图表/仪表盘） | present / hide / navigate / eval / snapshot / a2ui_push / a2ui_reset |
| `image` | 图像分析（使用配置的 image model） | 分析图片内容 |

### 记忆管理

| 工具名 | 功能 |
|--------|------|
| `memory_search` | 搜索记忆文件（MEMORY.md + memory/*.md），支持向量检索 + 关键词匹配 |
| `memory_get` | 读取记忆文件的特定行/段落 |

> 记忆存储格式：JSONL + Markdown，持久化到本地文件，跨 Session 可用。

### 多 Session / 多 Agent

| 工具名 | 功能 |
|--------|------|
| `agents_list` | 列出可用的 Agent ID（用于 sessions_spawn） |
| `sessions_list` | 列出其他 Session / 子 Agent |
| `sessions_history` | 获取另一个 Session 的对话历史 |
| `sessions_send` | 向另一个 Session 发送消息 |
| `sessions_spawn` | 创建子 Agent Session |
| `session_status` | 显示当前 Session 状态卡（用量 + 时间 + thinking 级别） |

### 消息推送

| 工具名 | 功能 |
|--------|------|
| `message` | 跨平台发送消息（Discord / WhatsApp / Telegram / Slack / iMessage / MS Teams），支持文本/媒体/投票/Reaction/Pin/Thread |

### 设备 & 硬件

| 工具名 | 功能 |
|--------|------|
| `nodes` | 管理配对设备：状态监控、配对审批、系统通知、命令执行、camera_snap / camera_clip / screen_record / location_get |

### 自动化 & 系统

| 工具名 | 功能 |
|--------|------|
| `cron` | 定时任务管理：add / update / remove / run / status / wake |
| `gateway` | 控制 OpenClaw 运行时：重启、应用配置、运行更新 |
| `llm_task` | 调用 LLM 执行子任务 |
| `lobster` | 工作流引擎：将 Skills + Tools 组合为可编排的管道 |

---

## 工具配置 Profiles

OpenClaw 预设了 4 种工具配置档位，用于不同安全级别：

| Profile | 包含工具 | 适用场景 |
|---------|---------|---------|
| `minimal` | read, write, edit | 最低权限，纯文件操作 |
| `coding` | minimal + exec, process, web_search, web_fetch | 开发场景 |
| `messaging` | minimal + message, browser | 通信场景 |
| `full` | 全部工具 | 完整能力 |

工具可通过 allow/deny list + group 粒度控制访问权限。`exec` 工具建议启用审批机制。

---

## 与 MindOS Agent 的对比

| 能力维度 | OpenClaw | MindOS Agent（当前 Phase 1-4） |
|----------|---------|-------------------------------|
| 文件读写 | read / write / edit / apply_patch | read_file / write_file / create_file / append / insert / update_section |
| Shell 执行 | exec + process | ❌ 不支持 |
| **Web 搜索** | **web_search**（Brave API） | ❌ 不支持 |
| **Web 抓取** | **web_fetch** | ❌ 不支持 |
| **浏览器自动化** | **browser**（CDP） | ❌ 不支持 |
| 记忆管理 | memory_search / memory_get | search（全文检索）/ read_file |
| 多 Agent 协作 | sessions_spawn / send / list | ❌ 不支持 |
| 图像分析 | image | ❌ 不支持 |
| 定时任务 | cron | ❌ 不支持 |
| 消息推送 | message（6+ 平台） | ❌ 不支持 |
| 设备控制 | nodes（摄像头/屏幕/定位） | ❌ 不支持 |
| 工作流编排 | lobster | MindOS Skills（部分） |
| 知识库专属 | ❌ 无 backlinks / history / CSV | ✅ get_backlinks / get_history / append_csv |
| 审计追踪 | ❌ 无 Agent Inspector | ✅ Agent Inspector 日志 |

### 关键差距（按优先级）

1. **web_search + web_fetch** — Agent 无法联网获取外部信息，是最大功能缺口
2. **Shell 执行** — 无法运行命令行工具（Git、npm 等），限制自动化能力
3. **浏览器自动化** — 无法操作网页
4. **多 Agent 协作** — 无法 spawn 子 Agent

### MindOS 的独有优势

1. **知识库原生工具** — backlinks / history / version / CSV 等结构化知识操作
2. **透明审计** — Agent Inspector 全链路操作日志
3. **MCP 协议** — 外部 Agent（Claude Code、Cursor 等）可直接读写知识库
4. **经验回流** — Skills 系统将对话经验沉淀为可复用 SOP
