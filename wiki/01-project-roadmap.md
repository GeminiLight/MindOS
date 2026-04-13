<!-- Last verified: 2026-04-04 | Current version: v0.6.39 -->

# 产品路线图 (Product Roadmap)

## 总览

```
v0.1 (P0 ✅)           v0.2 (P1 ✅)           v0.3-0.4 (✅)          v0.5 (✅)               v0.6 (✅ CURRENT)       v0.7+
┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐         ┌──────────┐
│ Next.js  │         │ CLI +    │         │ 插件架构 + │         │ Agent 框架│         │ Desktop + │         │ Cloud Hub│
│ MCP Server│ ──────▶ │ 自启 daemon│ ──────▶ │ CLI UX 增强│ ──────▶ │ Settings │ ──────▶ │ 多 Agent  │ ──────▶ │ RAG + 治理│
│ 核心编辑器 │         │ Git 自动同步│         │ Lazy Load │         │ i18n 重构 │         │ A2A + ACP │         │ 智能层   │
└──────────┘         └──────────┘         └──────────┘         └──────────┘         └──────────┘         └──────────┘
开发者 only           开发者 + 终端用户      开发者生态            框架升级 + 稳定性      桌面端 + Agent 生态     所有人 + 人机共生
```

**关键原则：** 每阶段独立可用 | 本地存储始终默认 | 优先高频场景

> 开源/商用功能划分见 [商业模式 → 定价](./02-business-model.md#阶段二pro-订阅p2-p3)

---

## P0 — 核心产品搭建 ✅

> 从零构建人机协同知识平台：浏览器可用、Agent 可接入、知识可结构化。

**已交付：** Next.js 16 前端（双模式编辑器 + AI 对话 + 全局搜索 + Wiki Graph）、MCP Server（stdio + HTTP 双传输，Bearer Token 认证；工具与 App API 对齐）、11 个渲染器插件、MindOS Skills（EN + ZH）、CI/CD + Landing Page。

---

## P1 — 零门槛启动 + 跨设备同步 ✅

> 用户 `npm install -g` 之后，打开浏览器就能用；换设备数据自动同步。

**已交付：** daemon 自启动（systemd/launchd）、Git 自动同步（`mindos sync`）、CLI 模块化（13 个 lib）、首次启动引导页、PWA 支持、Agent Inspector 日志增强。

---

## v0.3–0.4 — 插件架构 + CLI UX 增强 ✅

> 插件零侵入注册；CLI 开发者体验全面提升；组件按需加载减小初始 bundle。

**已交付：** 插件架构 4 阶段（目录拆分 → manifest 自注册 → codegen auto-discovery → lazy loading）、CLI 更新检查、`--version`/`--help`、`config unset`、debug 模块、MCP/Skills API、FindInPage、UpdateBanner。

---

## v0.5 — Agent 框架迁移 + Settings 重构 + 稳定性 ✅

> 底层 Agent 框架升级；Settings 面板模块化；多语言独立管理；关键 bug 修复。

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **pi-agent 框架迁移** | 从 Vercel AI SDK 迁移到 `@mariozechner/pi-agent-core` + `pi-ai` | ✅ v0.5.20 |
| **Settings 面板重构** | MCP/Skill/Agent 分区组件化 | ✅ v0.5.20 |
| **i18n 多语言拆分** | `i18n.ts` 拆为独立的 `i18n-en.ts` + `i18n-zh.ts` | ✅ v0.5.21 |
| **Sidebar 实时刷新** | 三层缓存修复（router cache + revalidatePath + visibilitychange） | ✅ v0.5.19 |
| **Agent Dashboard** | Agents Tab — Agent 发现 + MCP 状态面板 | ✅ v0.5.22 |
| **Monitoring Tab** | 系统/应用/知识库/MCP 指标仪表盘 | ✅ v0.5.22 |
| **统一错误处理** | `MindOSError` + 12 个 ErrorCodes + core/ 13 处迁移 | ✅ v0.5.22 |
| **增量搜索索引** | 倒排索引 + CJK bigram 分词，与 invalidateCache 联动 | ✅ v0.5.22 |
| **首次使用引导** | GuideCard 3 任务卡片 + 渐进推荐 + guideState 持久化 | ✅ |
| **Space 体验增强** | 新建 Space 自动脚手架 + 首页 Space 分组时间线 | ✅ |

---

## v0.6 — Desktop + 多 Agent 生态 + 认知复盘 ✅ (当前版本)

> 原生桌面客户端；A2A/ACP 多 Agent 协作协议；Activity Bar 全新布局；Echo 认知复盘系统；工作流编排引擎。

### 桌面客户端

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **Electron Desktop App** | 本地+远程双模式桌面端，含系统托盘（模式感知）、自动更新（electron-updater）、IPC 安全桥接、窗口状态持久化、Node.js 自动检测/下载。macOS/Windows/Linux 三平台 | ✅ v0.6.1 |
| **内置运行时优化** | Next.js standalone 构建 + esbuild 打包 MCP。安装包体积 macOS arm64 129MB | ✅ v0.6.6 |
| **生产构建切换 webpack** | standalone 从 200MB 降至 110MB（-45%），koffi 87MB 正确排除 | ✅ |

### 多 Agent 协作

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **A2A 协议 Phase 1** | Agent Card 发现端点 (`/.well-known/agent-card.json`) + JSON-RPC 端点 (`/api/a2a`)。SendMessage / GetTask / CancelTask。5 个 KB 技能暴露。18 测试 | ✅ v0.6.0 |
| **ACP 集成** | Agent Client Protocol 支持。`/api/acp/*` 五个端点。Agent 注册表 + 自动检测 + Session 管理。支持 31 个已注册 ACP Agent | ✅ |
| **Agents Dashboard 全重构** | `/agents` 内容页 + `/agents/[agentKey]` 详情页。Overview / MCP / Skills / Network 四 Tab。跨 Agent MCP/Skill 聚合视图。环境权限矩阵 | ✅ |
| **Agent Detail 工作台** | 全量 Skill/MCP 管理、原生已安装扫描可视化、Runtime 诊断（ping/延迟/活跃度）、Knowledge Interaction 操作日志 | ✅ |

### AI 对话增强

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **Chat/Agent 双模式** | Chat 模式精简 prompt (~250 tokens) + 8 个只读工具，省 ~81% token overhead | ✅ |
| **Multimodal 图片输入** | 粘贴/拖拽/上传图片，支持 Anthropic/OpenAI vision 模型 | ✅ |
| **自动重连** | 指数退避重试（1s/2s/4s），可配置最大重试次数，非重试型错误直接显示 | ✅ |
| **执行中可草拟** | Agent 执行期间允许输入下一条消息 | ✅ |
| **Extended Thinking** | 支持 Claude 3.5+ thinking level 配置 | ✅ |

### 布局与交互

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **Activity Bar 布局重构** | 左侧 48px Rail（Logo + Files/Search/Agents/Echo + Settings/Sync），可切换 Panel 替代 Modal | ✅ |
| **Discover 探索面板** | 9 个使用案例，点击触发 Ask AI | ✅ |
| **Workflows 面板** | YAML 工作流编排，可视化编辑器，Skill/Agent 集成，单步/全量执行 | ✅ |
| **Import History 面板** | AI Organize 操作历史记录 | ✅ |
| **Help 页面** | 概念体系 + 快速开始 + 场景卡片 + 快捷键速查 + FAQ | ✅ |

### Echo 认知复盘系统

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **Echo 5 段** | About You / Continued / Daily / History / Growth 五个认知复盘段 | ✅ |
| **Echo 视觉精修** | Hero 卡片 + 琥珀竖线 / kicker + 事实层空态 + 可折见解区 | ✅ |

### 知识管理

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **Inline AI Organize** | 上传文件原地展示处理进度和结果，支持 review 和撤销 | ✅ |
| **AI Organize 进度感知** | 分阶段文案 + 计时器 + 取消按钮 + 最小化后台运行 | ✅ |
| **Favorites / 收藏夹** | Star 固定常用文件，首页 Pinned Files 区 + 右键菜单 + 顶栏 Star | ✅ |
| **Trash / 回收站** | `.mindos/.trash/` + 30 天自动清理 + `/trash` 页面含恢复/永久删除 | ✅ |
| **Export / 导出** | 单文件 MD/HTML + 目录 ZIP 导出 | ✅ |
| **文件 Diff 可视化** | AI 修改文件后内嵌 inline diff + `/changes` 页面 line diff | ✅ |

### 工程化

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **CLI 架构重构** | God File 拆分 + 统一参数解析 + 统一 exit code + `--json` 全覆盖 | ✅ |
| **CI 安全加固** | `.syncinclude` 声明式白名单 + pre-push hook 拦截 public push | ✅ |
| **测试** | 99 个测试文件，1073 个测试用例全通过 | ✅ |

---

## v0.7+ — Cloud Hub + RAG + Agent 治理

> 不会用终端的用户也能用；从全文搜索到语义检索；Agent 记忆透明可控。

| 里程碑 | 交付 | 详情 |
|--------|------|------|
| **Cloud Hub** | RESTful API + S3/R2 存储 + E2E 加密 | 替代 Git 同步，降低门槛 |
| **深度 RAG** | LanceDB 语义检索 + 增量 embedding | [详情](./62-stage-rag.md) |
| **Knowledge Health** | 过期检测、孤立文件、AI 矛盾扫描、完整度评分 | 首页 Health Score 卡片 |
| **Agent Memory Layer** | Agent 记忆沉淀到 `/.agent-memory/{agent}/` | 用户可在 GUI 审查/修正/删除 |
| **Agent Governance** | 细粒度 ACL + 操作配额 + 敏感文件标记 + 审批流 | Claude Code 可写代码区、Cursor 只读 Profile |
| **Personal Knowledge API** | RESTful + GraphQL + Webhook 订阅 | [详情](./65-stage-knowledge-api.md) |
| **Capacitor 移动端** | iOS/Android 原生壳 | [详情](./specs/spec-capacitor-mobile-app.md) |

---

## P4 — 长期探索

> MindOS 从"被动知识库"演进为"个人自动化中枢"。

| 方向 | 说明 |
|------|------|
| **Trigger-Action Workflows** | 文件变更/定时/Webhook 触发自动化，YAML 定义 + GUI 可视化 |
| **Multi-modal Mind** | 语音转写、图片 OCR、手绘白板 → 统一转 Markdown + sidecar |
| **Mind Diff 心智演化** | 语义变化周报、观点追踪、"一年前你在想什么" |
| **Personal Intelligence Engine** | 社交智能、决策智能、知识代谢、跨域联想、能力地形（详见 [商业模式](./02-business-model.md#智能层personal-intelligence-engine)） |

---

## 全量功能索引

> 包含所有功能点（含已完成的细粒度项），作为开发参考。

### 平台能力数据

| 类别 | 数量 |
|------|------|
| API Routes | 51 |
| Agent Tools (MCP) | 27+ |
| Renderer Plugins | 11 |
| Page Routes | 12 |
| Settings Tabs | 10 |
| CLI Commands | 25+ |
| Supported Agents | 12+ |
| Tests | 99 files / 1073 cases |

### 全量功能表

| 功能 | 状态 | 阶段 | 详情 |
|------|------|------|------|
| Next.js 16 前端 | ✅ | v0.1 | 双模式编辑、搜索、AI 对话、图谱 |
| MCP Server | ✅ | v0.1 | stdio + HTTP, Bearer Token, 27+ tools |
| 11 个渲染器插件 | ✅ | v0.1 | [详情](./60-stage-plugins.md) |
| 插件架构 (manifest + codegen + lazy) | ✅ | v0.4 | [详情](./61-plugin-architecture.md) |
| CLI 模块化 (25+ commands) | ✅ | v0.2 | onboard/start/open/sync/mcp/gateway/token/file/space/ask/agent/search/api/... |
| daemon 自启动 | ✅ | P1 | systemd/launchd |
| Git 自动同步 | ✅ | P1 | `mindos sync` |
| 首次启动引导页 | ✅ | P1 | 模板选择（EN/ZH/Empty）→ 自动初始化 |
| pi-agent 框架迁移 | ✅ | v0.5 | Vercel AI SDK → pi-agent-core + pi-ai |
| Settings 面板重构 | ✅ | v0.5 | 10 个 Tab 组件化 |
| i18n 双语 | ✅ | v0.5 | 模块化架构（8 个 module），EN + ZH 完整覆盖 |
| 统一错误处理 | ✅ | v0.5 | MindOSError + ErrorCodes + apiError() |
| 增量搜索索引 | ✅ | v0.5 | 倒排索引 + CJK bigram |
| Electron Desktop App | ✅ | v0.6 | macOS/Windows/Linux + 自动更新 + 系统托盘 |
| A2A Protocol Phase 1 | ✅ | v0.6 | Agent Card + JSON-RPC + Task 管理 |
| ACP Integration | ✅ | v0.6 | 31 个 Agent + Session 管理 + 自动检测 |
| Activity Bar + Panel 布局 | ✅ | v0.6 | 48px Rail + 可切换 Panel |
| Agents Dashboard | ✅ | v0.6 | 内容页 + 详情页 + 跨 Agent 聚合 |
| Echo 认知复盘 | ✅ | v0.6 | 5 段认知系统 |
| Workflows 编排 | ✅ | v0.6 | YAML 引擎 + 可视化编辑器 + Skill/Agent 集成 |
| Chat/Agent 双模式 | ✅ | v0.6 | Chat 省 ~81% token overhead |
| Multimodal 图片输入 | ✅ | v0.6 | Anthropic/OpenAI vision |
| Inline AI Organize | ✅ | v0.6 | 上传即整理 + 进度 + 撤销 |
| Favorites + Trash + Export | ✅ | v0.6 | 收藏夹 + 回收站 + 导出 |
| 文件 Diff 可视化 | ✅ | v0.6 | Inline diff + `/changes` 页面 |
| Walkthrough 交互式引导 | ✅ | v0.6 | 4 步首次使用引导 |
| CI 安全加固 | ✅ | v0.6 | .syncinclude 白名单 + pre-push hook |
| Cloud Hub | 待做 | v0.7+ | RESTful + S3/R2 + E2E 加密 |
| 深度 RAG (LanceDB) | 📋 规划 | v0.7+ | [详情](./62-stage-rag.md) |
| Agent Memory Layer | 待做 | v0.7+ | 记忆审计 + GUI 管理 |
| Agent Governance | 待做 | v0.7+ | ACL + 配额 + 审批流 |
| Personal Knowledge API | 📋 规划 | v0.7+ | [详情](./65-stage-knowledge-api.md) |
| Capacitor 移动端 | 📋 规划 | v0.7+ | iOS/Android |
| Trigger-Action Workflows | 待做 | P4 | 自动化引擎 |
| Multi-modal Mind | 探索 | P4 | 语音/图片/白板 |
| Mind Diff | 探索 | P4 | 心智演化追踪 |
| Personal Intelligence Engine | 探索 | P4 | 五维用户模型 |
