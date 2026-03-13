<!-- Last verified: 2026-03-14 | Current stage: P1 -->

# 实施路线图 (Project Roadmap)

## 全量功能索引

| 功能 | 状态 | 阶段 | 详情 |
|------|------|------|------|
| Next.js 16 前端 | ✅ | v0.1 | 双模式编辑、搜索、AI 对话、图谱 |
| MCP Server (20+ 工具) | ✅ | v0.1 | stdio + HTTP, Bearer Token |
| 10 个渲染器插件 | ✅ | v0.1 | [./10-stage-plugins.md](./10-stage-plugins.md) |
| CLI 模块化 (13 个 lib) | ✅ | v0.2 | onboard/start/open/sync/mcp/gateway/token |
| daemon 自启动 | ✅ | P1A | systemd/launchd |
| Git 自动同步 | ✅ | P1B | `mindos sync` |
| `mindos open` | ✅ | P1A | 一键浏览器打开 |
| `mindos token` 增强 | ✅ | P1C | 多 Agent 配置输出 |
| 首次启动引导页 | ✅ | P1A | 模板选择（EN/ZH/Empty）→ 自动初始化 |
| PWA 支持 | ✅ | P2C | manifest + service worker + 可安装 |
| Agent Inspector 增强 | ✅ | P3 | JSON Lines 日志 + 自动记录 MCP/Agent 工具调用 |
| 局域网自动发现 | 📋 规划 | P1C | [./13-stage-mdns.md](./13-stage-mdns.md) |
| Cloud Hub | 待做 | P2A | RESTful + S3/R2 + E2E 加密 |
| 桌面安装包 | 📋 规划 | P2B | [./14-stage-desktop.md](./14-stage-desktop.md) |
| Personal Knowledge API | 待做 | P2D | RESTful + GraphQL + Webhook 订阅 |
| Knowledge Health 仪表盘 | 待做 | P2D | 过期检测、孤立文件、矛盾检测、完整度评分 |
| ACP 多 Agent 中枢 | 待做 | P3 | — |
| Agent Governance 权限治理 | 待做 | P3 | 细粒度 ACL、操作配额、敏感文件标记、审批流 |
| Agent Memory Layer | 待做 | P3 | Agent 记忆双向可审计，用户可审查/修正/删除 |
| 深度 RAG (LanceDB) | 📋 规划 | P3 | [./12-stage-rag.md](./12-stage-rag.md) |
| Trigger-Action Workflows | 待做 | P4 | 文件变更/定时/Webhook 触发自动化 |
| Multi-modal Mind | 探索 | P4 | 语音转写、图片 OCR、手绘白板 |
| Mind Diff 心智演化追踪 | 探索 | P4 | 语义变化周报、观点追踪、"一年前的今天" |
| 动态技能协议 | 探索 | P4 | — |
| 跨 Agent 协同网格 | 探索 | P4 | — |
| 多 Mind 实例 | 待验证 | P2+ | 多个大脑（团队/个人），当前用子目录满足 |

---

## 当前版本状态 (v0.1.x → v0.2)

**核心已完成：**
- Next.js 16 前端（双模式编辑、搜索、AI 对话、图谱、10 个渲染器插件）
- MCP Server（20+ 工具，stdio + HTTP 双传输，Bearer Token 认证）
- CLI（onboard / start / open / sync / mcp install / gateway daemon）— 13 个 lib 模块
- MindOS Skills（EN + ZH，28 条 evals）
- CI/CD 自动同步 + Landing Page 部署

**P1 已完成：** daemon 自启动、Git 自动同步、`mindos open`、`mindos token` 增强

---

## P0 — 近期修复 & 优化

| 项 | 类别 | 状态 |
|---|------|------|
| 首页布局调整（AI-native 优先） | UI | ✅ |
| 首页 Plugins 位置调整 | UI | ✅ |
| New Note 按钮修复 | Bug | ✅ |
| 移动端 Landing Page Topbar | Bug | ✅ |
| 历史对话持久化 | Feature | ✅ |
| 优化模板内容 | Content | 待做 |
| 优化 Skill 工作流 | Content | 持续 |

## P1 — 零门槛启动 + 跨设备同步

> 用户 `npm install -g` 之后，打开浏览器就能用；换设备数据自动同步。

### Phase 1A: Gateway 默认自启动 ✅

交付标准：`npm i -g @geminilight/mindos && mindos onboard` → 每次开机 Web UI 自动可用。

### Phase 1B: Git 同步内置化 ✅

交付标准：设备 A 记笔记，设备 B 在 5 分钟内可见；冲突不丢数据。

### Phase 1C: Streamable HTTP 开箱即用

| 任务 | 状态 |
|------|------|
| `mindos token` 多 Agent 配置输出 | ✅ |
| 局域网自动发现 (mDNS) | 待做 |

## P2 — 云端 Hub + 非 CLI 用户 + 生态扩展

> 不会用终端的用户也能用；同步不依赖 Git；知识库对外可编程。

- **P2A: Cloud Hub** — RESTful API + S3/R2 + E2E 加密
- **P2B: 桌面安装包** — macOS .dmg / Windows .msi (Tauri/pkg)
- **P2C: 移动端** — PWA ✅ + 响应式 + 离线缓存深化
- **P2D: 生态层**
  - **Knowledge Health 仪表盘** — 过期文件检测、孤立文件发现、AI 矛盾扫描、模板完整度评分。首页加 Health Score 卡片，点击看详细报告
  - **Personal Knowledge API** — RESTful + GraphQL 查询接口 + Webhook 订阅。让 Shortcuts、Zapier、Telegram bot 等非 Agent 工具也能访问知识库

## P3 — AI 增强 + Agent 治理

| 项 | 优先级 | 说明 |
|---|--------|------|
| 深度 RAG (LanceDB) | 高 | 语义检索替代全文匹配，增量 embedding |
| Agent Memory Layer | 高 | Agent 记忆沉淀到 `/.agent-memory/{agent}/`，用户可在 GUI 审查/修正/删除。竞品完全没有的差异化 |
| ACP 多 Agent 协作中枢 | 高 | 多 Agent 并发操作协调 |
| Agent Governance | 高 | 细粒度 ACL（Claude Code 可写代码区、Cursor 只读 Profile）、操作配额、敏感文件 `.private` 标记、写操作审批流 |
| 主动式后台 Agent | 中 | 定时生成 daily briefing、发现过期 TODO、知识库矛盾提醒 |

## P4 — 长期探索

| 项 | 说明 |
|---|------|
| Trigger-Action Workflows | 文件变更→同步 Dida365；定时→AI briefing；Webhook→自动建笔记。YAML 定义 + GUI 可视化。MindOS 从"被动知识库"变为"个人自动化中枢" |
| Multi-modal Mind | 语音备忘录（Whisper 转写→结构化笔记）、图片/截图（OCR + AI 描述）、手绘白板（Excalidraw→JSON）。所有多模态内容最终转 Markdown + sidecar |
| Mind Diff 心智演化追踪 | 知识库语义变化周报、观点 assertion 追踪、"一年前你在想什么"。roadmap 里"心智时光机"的具象化 |
| 评论/批注 | inline comment，存为 sidecar JSON 不污染 Markdown 原文 |
| 动态技能协议 | — |
| 跨 Agent 协同网格 | — |
| 社区模板 + 团队版 | — |

---

## 架构演进

```
v0.1 (初始)              v0.2 (P1 ✅)              v0.3 (P2)                v0.4 (P3)
┌──────────┐           ┌──────────┐           ┌──────────┐           ┌──────────┐
│ CLI-only │           │ CLI +    │           │ CLI +    │           │ RAG +    │
│ 手动启动  │  ──────▶  │ 自启 daemon│  ──────▶  │ 桌面安装包│  ──────▶  │ Agent 治理│
│ 本地存储  │           │ Git 自动同步│           │ Cloud Hub│           │ Agent 记忆│
└──────────┘           └──────────┘           └──────────┘           └──────────┘
开发者 only             开发者 + 终端用户        所有人                  人机共生
```

**关键原则：** 每阶段独立可用 | 本地存储始终默认 | 优先高频场景
