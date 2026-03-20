<!-- Last verified: 2026-03-20 | Current stage: v0.5 -->

# 产品路线图 (Product Roadmap)

## 总览

```
v0.1 (P0 ✅)              v0.2 (P1 ✅)              v0.3-0.4 (P1 ✅)          v0.5 (✅ 进行中)          v0.6+ (P2-P4)
┌──────────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐
│ Next.js  │           │ CLI +    │           │ 插件架构 + │           │ Agent 框架│           │ Cloud Hub│
│ MCP Server│  ──────▶  │ 自启 daemon│  ──────▶  │ CLI UX 增强│  ──────▶  │ Settings │  ──────▶  │ Agent 管理│
│ 核心编辑器 │           │ Git 自动同步│           │ Lazy Load │           │ i18n 重构 │           │ RAG + 治理│
└──────────┘           └──────────┘           └──────────┘           └──────────┘           └──────────┘
开发者 only             开发者 + 终端用户        开发者生态              框架升级 + 稳定性        所有人 + 人机共生
```

**关键原则：** 每阶段独立可用 | 本地存储始终默认 | 优先高频场景

> 开源/商用功能划分见 [商业模式 → 定价](./02-business-model.md#阶段二pro-订阅p2-p3)

---

## P0 — 核心产品搭建 ✅

> 从零构建人机协同知识平台：浏览器可用、Agent 可接入、知识可结构化。

**已交付：** Next.js 16 前端（双模式编辑器 + AI 对话 + 全局搜索 + Wiki Graph）、MCP Server（20+ 工具，stdio + HTTP 双传输，Bearer Token 认证）、11 个渲染器插件、MindOS Skills（EN + ZH）、CI/CD + Landing Page。

---

## P1 — 零门槛启动 + 跨设备同步 ✅

> 用户 `npm install -g` 之后，打开浏览器就能用；换设备数据自动同步。

**已交付：** daemon 自启动（systemd/launchd）、Git 自动同步（`mindos sync`）、CLI 模块化（13 个 lib）、首次启动引导页、PWA 支持、Agent Inspector 日志增强。

剩余：局域网自动发现 (mDNS) — [详情](./63-stage-mdns.md)

---

## v0.3–0.4 — 插件架构 + CLI UX 增强 ✅

> 插件零侵入注册；CLI 开发者体验全面提升；组件按需加载减小初始 bundle。

**已交付：** 插件架构 4 阶段（目录拆分 → manifest 自注册 → codegen auto-discovery → lazy loading）、CLI 更新检查、`--version`/`--help`、`config unset`、debug 模块、MCP/Skills API、FindInPage、UpdateBanner。

---

## v0.5 — Agent 框架迁移 + Settings 重构 + 稳定性 🔄 进行中

> 底层 Agent 框架升级；Settings 面板模块化；多语言独立管理；关键 bug 修复。

| 里程碑 | 交付 | 状态 |
|--------|------|------|
| **pi-agent 框架迁移** | 从 Vercel AI SDK 迁移到 `@mariozechner/pi-agent-core` + `pi-ai` | ✅ v0.5.20 |
| **Settings 面板重构** | MCP/Skill/Agent 分区组件化（McpTab 拆分为 McpAgentInstall + McpServerStatus + McpSkillsSection） | ✅ v0.5.20 |
| **i18n 多语言拆分** | `i18n.ts` 拆为独立的 `i18n-en.ts` + `i18n-zh.ts` | ✅ v0.5.21 |
| **Sidebar 实时刷新** | 三层缓存修复（客户端 router cache + 服务端 revalidatePath + visibilitychange 轮询） | ✅ v0.5.19 |
| **npx 版本不匹配修复** | `npx next` → 本地 `.bin/next` 绝对路径，防止全局缓存版本冲突 | ✅ v0.5.21 |
| **测试修复** | tools.test.ts 适配新数组 API（14→0 失败）、context.test.ts 迁移到 pi-ai 类型（7→0 失败） | ✅ v0.5.21 |
| **测试覆盖率提升** | 新增 jwt/api/setup PATCH 测试，build-integrity 智能跳过 | ✅ v0.5.21 |
| **Agent Dashboard** | Settings 新增 Agents Tab（Agent 发现 + MCP 状态 + 30s 自动刷新） | ✅ v0.5.22 |
| **Monitoring Tab** | Settings 新增 Monitoring Tab（系统/应用/知识库/MCP 指标，5s 轮询） | ✅ v0.5.22 |
| **统一错误处理** | `MindOSError` + 12 个 ErrorCodes + core/ 13 处迁移 | ✅ v0.5.22 |
| **增量搜索索引** | 倒排索引 + CJK bigram 分词，与 invalidateCache 联动 | ✅ v0.5.22 |
| **首页 Plugins 展示优化** | 卡片展示 description + tags，消除重复映射，不可用 plugin 创建引导 | ✅ v0.5.22 |
| **文件/目录视图 UX 优化** | 目录卡片密度分层 + Breadcrumb 文件图标 + ⌘F 文档内搜索 | ✅ v0.5.22 |

---

## P2 — 非 CLI 用户 + Agent 管理 + 生态扩展

> 不会用终端的用户也能用；Agent 状态可视化管理；知识库对外可编程。

| 里程碑 | 交付 | 详情 |
|--------|------|------|
| **Agent Dashboard** | 本机 Agent 发现（扫描 ~/.claude/、~/.config/Cursor 等）+ MCP 连接状态 + Agent 运行状态面板 | ✅ v0.5.22 已提前交付 |
| **Cloud Hub** | RESTful API + S3/R2 存储 + E2E 加密 | 替代 Git 同步，降低门槛 |
| **桌面安装包** | macOS .dmg / Windows .msi (Tauri/pkg) | [详情](./64-stage-desktop.md) |
| **Knowledge Health** | 过期检测、孤立文件、AI 矛盾扫描、完整度评分 | 首页 Health Score 卡片 |
| **Personal Knowledge API** | RESTful + GraphQL + Webhook 订阅 | [详情](./65-stage-knowledge-api.md)，让 Shortcuts/Zapier 等非 Agent 工具也能访问知识库 |

---

## P3 — AI 增强 + Agent 治理

> 从全文搜索到语义检索；Agent 记忆透明可控；多 Agent 协作有序。

| 里程碑 | 交付 | 说明 |
|--------|------|------|
| **深度 RAG** | LanceDB 语义检索 + 增量 embedding | [详情](./62-stage-rag.md)，替代全文匹配 |
| **Agent Memory Layer** | Agent 记忆沉淀到 `/.agent-memory/{agent}/` | 用户可在 GUI 审查/修正/删除，竞品没有的差异化 |
| **Agent Governance** | 细粒度 ACL + 操作配额 + 敏感文件标记 + 审批流 | Claude Code 可写代码区、Cursor 只读 Profile |
| **多 Agent 协作中枢** | ACP 协议 + 并发操作协调 | 多 Agent 同时读写时的冲突解决 |

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

> 包含所有功能点（含已完成的细粒度项），作为开发参考。Roadmap 以上文里程碑为准。

| 功能 | 状态 | 阶段 | 详情 |
|------|------|------|------|
| Next.js 16 前端 | ✅ | v0.1 | 双模式编辑、搜索、AI 对话、图谱 |
| MCP Server (20+ 工具) | ✅ | v0.1 | stdio + HTTP, Bearer Token |
| 11 个渲染器插件 | ✅ | v0.1 | [详情](./60-stage-plugins.md) |
| 插件架构 (manifest + codegen + lazy) | ✅ | v0.4 | [详情](./61-plugin-architecture.md) |
| CLI 模块化 (13 个 lib) | ✅ | v0.2 | onboard/start/open/sync/mcp/gateway/token |
| CLI UX 增强 | ✅ | v0.4 | --version/--help/config unset/debug/update-check |
| MCP/Skills API | ✅ | v0.4 | /api/mcp/* + /api/skills |
| daemon 自启动 | ✅ | P1 | systemd/launchd |
| Git 自动同步 | ✅ | P1 | `mindos sync` |
| 首次启动引导页 | ✅ | P1 | 模板选择（EN/ZH/Empty）→ 自动初始化 |
| PWA 支持 | ✅ | P1 | manifest + service worker + 可安装 |
| Agent Inspector 增强 | ✅ | P1 | JSON Lines 日志 + 自动记录工具调用 |
| pi-agent 框架迁移 | ✅ | v0.5 | Vercel AI SDK → pi-agent-core + pi-ai |
| Settings 面板重构 | ✅ | v0.5 | MCP/Skill/Agent 分区组件化 |
| i18n 多语言拆分 | ✅ | v0.5 | i18n-en.ts + i18n-zh.ts 独立管理 |
| Sidebar 实时刷新 | ✅ | v0.5 | 三层缓存修复 + visibilitychange + 30s 轮询 |
| npx 版本锁定修复 | ✅ | v0.5 | npx next → 本地 .bin/next 绝对路径 |
| 测试修复 + 覆盖率提升 | ✅ | v0.5 | tools/context 测试迁移 + jwt/setup PATCH 新增 |
| 局域网自动发现 | 📋 规划 | P1 | [详情](./63-stage-mdns.md) |
| Agent Dashboard | ✅ | v0.5 | Agents Tab — Agent 发现 + MCP 状态面板（从 P2 提前交付） |
| Monitoring Tab | ✅ | v0.5 | 系统/应用/知识库/MCP 指标仪表盘 |
| 统一错误处理 | ✅ | v0.5 | MindOSError + ErrorCodes + apiError() |
| 增量搜索索引 | ✅ | v0.5 | 倒排索引 + CJK bigram + invalidateCache 联动 |
| Cloud Hub | 待做 | P2 | RESTful + S3/R2 + E2E 加密 |
| 桌面安装包 | 📋 规划 | P2 | [详情](./64-stage-desktop.md) |
| Knowledge Health 仪表盘 | 待做 | P2 | 过期检测、孤立文件、矛盾检测 |
| Personal Knowledge API | 📋 规划 | P2 | [详情](./65-stage-knowledge-api.md) |
| 深度 RAG (LanceDB) | 📋 规划 | P3 | [详情](./62-stage-rag.md) |
| Agent Memory Layer | 待做 | P3 | 记忆审计 + GUI 管理 |
| Agent Governance | 待做 | P3 | ACL + 配额 + 审批流 |
| ACP 多 Agent 中枢 | 待做 | P3 | 并发协调 |
| Trigger-Action Workflows | 待做 | P4 | 自动化引擎 |
| Multi-modal Mind | 探索 | P4 | 语音/图片/白板 |
| Mind Diff | 探索 | P4 | 心智演化追踪 |
| Personal Intelligence Engine | 探索 | P4 | 五维用户模型 |
