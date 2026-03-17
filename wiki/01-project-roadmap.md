<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 产品路线图 (Product Roadmap)

## 总览

```
v0.1 (P0 ✅)              v0.2 (P1 ✅)              v0.3-0.4 (P1 ✅)          v0.5 (P2)                v0.6+ (P3-P4)
┌──────────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐
│ Next.js  │           │ CLI +    │           │ 插件架构 + │           │ Cloud Hub│           │ RAG +    │
│ MCP Server│  ──────▶  │ 自启 daemon│  ──────▶  │ CLI UX 增强│  ──────▶  │ 桌面安装包│  ──────▶  │ Agent 治理│
│ 核心编辑器 │           │ Git 自动同步│           │ Lazy Load │           │ Knowledge│           │ 自动化引擎 │
└──────────┘           └──────────┘           └──────────┘           └──────────┘           └──────────┘
开发者 only             开发者 + 终端用户        开发者生态              所有人                  人机共生
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

## P2 — 非 CLI 用户 + 云端同步 + 生态扩展

> 不会用终端的用户也能用；同步不依赖 Git；知识库对外可编程。

| 里程碑 | 交付 | 详情 |
|--------|------|------|
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
| 局域网自动发现 | 📋 规划 | P1 | [详情](./63-stage-mdns.md) |
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
