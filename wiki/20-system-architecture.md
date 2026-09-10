<!-- Last verified: 2026-05-10 | Current stage: v1.0.5 | Canonical status: wiki/reviews/v1-migration-status-2026-04-27.md -->

# MindOS 系统架构 (System Architecture)

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 & 外部 Agent                         │
└──────────┬──────────────────────┬───────────────────────────────┘
           │ Browser (GUI)         │ MCP Protocol (stdio/HTTP)
           ▼                       ▼
┌─────────────────────┐  ┌────────────────────────┐
│ packages/web (Next.js)  │  │ packages/mindos protocol runtime │
│   ─────────────────  │  │  ────────────────────  │
│   • 前端 UI 组件     │  │  • MCP ↔ App API       │
│   • API Routes       │  │  • stdio + HTTP 传输   │
│   • 内置 Agent       │  │  • Bearer Token 认证   │
│   • 插件渲染器       │  │  • 安全沙箱 & 写保护   │
└──────────┬──────────┘  └──────────┬─────────────┘
           │                        │
           ▼                        ▼
┌──────────────────────────────────────────────────┐
│              my-mind/ (本地纯文本知识库)             │
│  Markdown + CSV + JSON | Git 版本控制              │
└──────────────────────────────────────────────────┘
```

## 目录结构

```
mindos/
├── packages/
│   ├── mindos/                 # @geminilight/mindos 产品主包：OpenCode-style product runtime
│   │   ├── bin/                # thin shim/CLI 入口；npm 主包通过平台 runtime 执行完整 CLI
│   │   └── src/                # product facade + server/client/plugin/tool/session/agent + internals
│   ├── web/                    # Next.js 16 Web 源码；发布包只包含 _standalone artifact
│   │   ├── app/                # App Router 页面 + API Routes
│   │   ├── components/         # UI 组件
│   │   ├── lib/                # Web runtime modules and adapters
│   │   └── data/skills/        # 内置 Skill 上下文
│   ├── desktop/                # Electron 桌面客户端
│   ├── mobile/                 # Expo 移动端
│   ├── browser-extension/      # Web Clipper 浏览器扩展
│   ├── desktop-tauri/          # Tauri spike
│   ├── retrieval/              # search/vector/indexer/api（可选检索栈）
│   └── protocols/              # acp/mcp-server 外部协议适配
├── skills/                     # Agent 工作流技能
├── templates/{en,zh}/          # 预设知识库模板
├── landing/                    # 静态 Landing Page
├── scripts/                    # setup.js, release.sh
└── wiki/                       # 项目文档（本文件所在）
```

> `packages/mindos` 是 OpenCode 式产品主包，当前承载 `@geminilight/mindos` runtime facade、foundation/knowledge 内部模块、server/client/plugin/tool/session/agent 边界、能力归属 contract 与 CLI kernel 边界。Web/Desktop/Mobile/extension 是 client/adapter；默认 runtime 通过平台包承载。
>
> `packages/mindos/_standalone`、`packages/mindos/packages`、`packages/mindos/scripts`、`packages/mindos/assets`、`packages/mindos/skills`、`packages/mindos/templates` 是 `npm pack` / publish 期间 materialize 的 staging output，不是源码目录。它们被 `.gitignore` 和 `pnpm-workspace.yaml` 排除，必要时用 `pnpm run clean:product-stage` 清理。

## 模块详解

### 1. packages/web — Next.js 16 前端

**技术栈：** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + TipTap + CodeMirror 6 + pi-agent-core 0.60.0 + pi-coding-agent 0.61.1 (session/model/auth)

**API Routes (总 78，已迁移 thin-adapter 65)：**

> **2026-04-10 架构优化**：关键路由已完成职责分离重构。`ask/route.ts` 从 1,524 行减少至 1,050 行 (-31%)，`file/route.ts` 从 451 行减少至 159 行 (-65%)。7 个业务逻辑模块已提取 (`lib/sse/events.ts`, `lib/agent/skill-resolver.ts`, `lib/agent/non-streaming.ts`, `lib/agent/file-context.ts`, `lib/api/request-utils.ts`, `lib/file/handlers.ts`, `lib/sync/config.ts`)。详见 `wiki/reviews/architecture-review-2026-04-10.md`。

> **SSE 消费侧（2026-09-10）**：浏览器端解析 `text/event-stream` 只有两条路。聊天主流走 `lib/agent/stream-consumer.ts`（core `consumeUIMessageStream`）；其余读 turn 流的站点（`lib/agent-run-observatory.ts`、`lib/space-ai-init.ts`、`hooks/useAiOrganize.ts`、`components/renderers/workflow-yaml/execution.ts`、`components/renderers/summary/SummaryRenderer.tsx`、`components/agents/AgentsPresetsSection.tsx`）统一走 `lib/sse/read-sse-stream.ts`（`readSseStream` / `parseSseText` / `parseSseJsonData`，WHATWG 切帧：跨 chunk、多行 `data:`、CRLF、`data: ` 带空格，EOF 时 flush 尾帧），站点只保留各自的事件语义。不要再在站点里写 `split('\n')` + `startsWith('data:')`。Mobile 对应的是 `packages/mobile/lib/sse-parser.ts`（turn 流与 `/api/events` 共用）。

| 端点 | 功能 |
|------|------|
| `POST /api/agent/sessions/:sessionId/turns` | Agent turn — SSE 流式输出，按 runtime/permission/context 组装本轮请求 |
| `GET /api/agent/sessions` | 多轮对话历史 |
| `POST /api/auth` | Token 认证 |
| `GET /api/backlinks?path=` | 反向链接查询 |
| `GET /api/bootstrap` | Agent 上下文引导加载 |
| `POST /api/extract-pdf` | PDF 文本提取 |
| `GET/PUT/DELETE /api/file?path=` | 单文件 CRUD |
| `GET /api/files` | 文件树 |
| `GET /api/git` | Git 操作 |
| `GET /api/graph` | 知识图谱 (nodes + edges) |
| `GET /api/health` | 健康检查 |
| `GET /api/init` | 初始化状态 |
| `GET /api/monitoring` | 性能监控数据 |
| `GET /api/recent-files` | 最近修改 |
| `POST /api/restart` | 重启服务 |
| `GET /api/search?q=` | 全文搜索 |
| `GET/PUT /api/settings` | 应用设置 |
| `POST /api/settings/reset-token` | Token 重置 |
| `POST /api/settings/test-key` | API密钥测试 |
| `GET /api/skills` | Skills列表 |
| `POST /api/sync` | Git 同步操作 |
| `GET /api/update` | 更新操作 |
| `GET /api/update-check` | 检查更新 |
| `GET /api/mcp/agents` | MCP Agent列表 |
| `POST /api/mcp/install` | MCP安装 |
| `POST /api/mcp/copy-server` | 将已配置的 MCP Server 复制/安装到另一个 Agent |
| `POST /api/mcp/install-skill` | Skill安装 |
| `GET /api/mcp/status` | MCP状态 |
| `GET /api/setup` | 安装设置 |
| `POST /api/setup/check-path` | 路径检查 |
| `POST /api/setup/check-port` | 端口检查 |
| `POST /api/setup/generate-token` | 生成Token |
| `GET /api/setup/ls` | 列出目录 |
| `POST /api/file/import` | 文件导入（支持 AI Organize） |
| `GET /api/changes` | 变更事件追踪 |
| `GET /api/tree-version` | 文件树版本号（流断开时的兜底轮询） |
| `GET /api/events` | 服务端事件流（SSE）：`tree.changed` / `agent-run.event` / `skills.changed` / `mcp.changed` / `sync.changed` / `runtime.changed` / `settings.changed` / `control-plane.changed` / `run.pending-actions.changed`，支持 `Last-Event-ID` 重放与 `?types=` 过滤；Web 以它替代固定间隔轮询，见 `specs/spec-sse-event-stream.md`。跨进程：`server/events/ledger-tail-bridge.ts` 是懒源，只在有订阅者时每 1 s tail 共享 ledger（owner≠本进程的行才发 `agent-run.event`，水位=max(seq)，不回放历史），并盯 pending-prompt store 的 meta version 与 automations `state.json` 指纹发 `run.pending-actions.changed`，见 `specs/spec-cross-process-run-events.md` |
| `POST /api/agent-activity` | Agent 活动日志 |
| `POST /api/a2a` | A2A JSON-RPC 端点 |
| `GET /api/a2a/agents` | A2A Agent 列表 |
| `GET /api/a2a/discover` | A2A Agent 发现 |
| `POST /api/a2a/delegations` | A2A 任务委派 |
| `GET /api/acp/registry` | ACP Agent 注册表 |
| `POST /api/acp/detect` | ACP Agent 检测 |
| `POST /api/acp/install` | ACP Agent 安装 |
| `POST /api/acp/config` | ACP 配置 |
| `POST /api/acp/session` | ACP Session 管理 |
| `POST /api/export` | 文件/目录导出 (MD/HTML/ZIP) |
| `GET /api/workflows` | 工作流定义 CRUD |
| `POST /api/mcp/restart` | MCP Server 重启 |
| `GET /api/settings/list-models` | 可用模型列表 |
| `POST /api/settings/model-thinking` | 具体模型支持的 thinking effort |
| `GET /api/update-status` | 更新进度 |
| `POST /api/uninstall` | 卸载清理 |
| `GET /api/inbox` | Inbox 收件箱 |
| `POST /api/inbox/clip` | Web Clipper 裁剪入 Inbox |
| `GET /api/lint` | 知识库健康检查 |
| `GET /api/space-overview` | Space 概览数据 |
| `GET /api/file/raw` | 原始文件内容（无解析） |
| `POST /api/mcp/direct-tools` | MCP 工具直接调用 |
| `GET /api/mcp/tools` | MCP 工具列表 |
| `POST /api/mcp/uninstall` | MCP Agent 卸载；可指定 `serverName` 移除非 MindOS server |
| `POST /api/agents/copy-skill` | 跨 Agent 复制 Skill |
| `GET/POST /api/agents/custom` | 自定义 Agent CRUD |
| `POST /api/agents/custom/detect` | 自定义 Agent 检测 |
| `GET/PUT/DELETE /api/im/config` | IM 平台配置 |
| `GET /api/im/status` | IM 平台连接状态 |
| `POST /api/im/test` | IM 消息测试发送 |

**核心组件拆分：**

> **2026-04-10 状态**：8 个超大组件已完成 60-85% 的拆分，提取 15+ 个子组件与专用 hook。

| 组件 | 拆分前 | 拆分后 | 减少 |
|------|--------|--------|------|
| TodoRenderer | 889 行 | 137 行 + (parse-todos.ts / FilterBar / SectionCard) | **-85%** |
| UpdateTab | 868 行 | 357 行 + DesktopUpdateCards.tsx | -59% |
| McpTab | 713 行 | 293 行 + McpConnectGuides.tsx | -59% |
| AgentsPanelA2aTab | 746 行 | 297 行 + AcpRegistrySection.tsx | -60% |
| AgentDetailContent | 1,188 行 | 741 行 + 6 子组件 (Header/Skills/Mcp/Space/Config/SkillEditor) | -38% |
| FileTree | 861 行 | 619 行 + FileTreeContextMenus.tsx, useDirectoryDragDrop hook | -28% |
| SyncTab | 775 行 | 556 行 + SyncEmptyState.tsx | -28% |
| AgentsSkillsSection | 869 行 | 655 行 + AgentsSkillsByAgent.tsx | -25% |
| ChatContent | 771 行 | 771 行 | 跳过 (编排型组件，拆分反增复杂度) |

**插件渲染器 (14个)：**

| 渲染器 | 功能 | 目录 |
|--------|------|------|
| agent-inspector | Agent 调用记录查看 | agent-inspector/ |
| audio | 音频播放 | audio/ |
| backlinks | 反向链接展示 | backlinks/ |
| change-log | 变更日志 (改进版本) | change-log/ |
| config | 配置文件渲染 | config/ |
| csv | CSV 表格/看板/画廊视图 | csv/ |
| graph | 知识图谱可视化 | graph/ |
| image | 图片查看 | image/ |
| pdf | PDF 文档渲染 | pdf/ |
| summary | 内容摘要 | summary/ |
| timeline | 时间线视图 | timeline/ |
| todo | 待办事项看板 | todo/ |
| video | 视频播放 | video/ |
| workflow-yaml | YAML 工作流引擎 | workflow-yaml/ |

> **已移除的渲染器**：diff、workflow（旧版），功能已由 change-log 和 workflow-yaml 替代。

**安全：** middleware.ts Bearer Token 认证，同源浏览器免认证。

### 2. packages/mindos — 产品主包

`@geminilight/mindos` 是 MindOS 的产品主 runtime package。当前暴露的产品能力入口：

- `@geminilight/mindos/foundation`：shared/errors/core/config/logger/permissions/security/plugins（plugins = 插件安装共享原语：staged-install / safe-id / confirmation-receipt，见下文「插件安装原语」）。
- `@geminilight/mindos/knowledge`：storage/spaces/graph/audit/git/knowledge-ops。
- `@geminilight/mindos/retrieval`：retrieval 核心 contracts、chunking 策略、index/search/vector 抽象与能力边界；默认不启用 MeiliSearch / LanceDB / Express 等重型后端。
- `@geminilight/mindos/server`：API route contract、response/error/cache/CORS shape、health/files/file.raw/search/settings/mcp.status handlers。HTTP 层是一张路由表加一个 Hono 应用：`packages/mindos/src/server/routes/*.ts` 按领域（files / search / knowledge / agent / agent-runtimes / a2a / acp / im / automations / settings / setup / mcp / skills / system）导出 `MindosRouteDefinition[]`（`{ id, method, path, auth, handler(ctx) }`），`contract.ts` 的 `MINDOS_SERVER_ROUTES` 只是这张表的 `{ id, method, path, auth }` 投影；`app.ts` 的 `createMindosApp({ services, auth, staticFallback })` 从表构建 Hono 应用（契约鉴权、body 限额、ETag/304、SSE 流、静态回退、tree cache 失效），`http.ts` 只做 `node:http` + `@hono/node-server` 的 bootstrap。新增路由只需在对应领域文件加一行。Web 侧 106 条 product-owned 路由（`route-ownership.ts` 里 adapter 为 `mindos-app` 的全部）都是一行 `delegateToMindos(method, path)`，请求经 Next proxy 鉴权后交给同一张路由表（`auth: 'host'`），body 限额、内容变更日志、错误映射全在路由表里；Web 只通过 `packages/web/app/api/_mindos-services.ts` 与 `_mindos-services/{agents,settings,channels,knowledge}.ts` 把宿主能力注入 `MindosHttpServices` 的可选插槽（`a2a` / `acp` / `agentRuntimes` / `agentCapabilities` / `mcpAgentServices` / `skills` / `embedding` / `settings*` / `setup` / `channels` / `knowledgeWrites` / `monitoring` / `ensureMindSystemDefaults`）。standalone Product Server 留空这些插槽，路由表回退到产品默认实现。只有 `tree-version` 与 `space-overview` 的 POST 是 Web-only 附加方法；`stream` adapter（agent turn、events）、host-owned 与 optional-capability 路由仍由 Next 自己实现。契约测试 `tests/web-api-route-ownership-contract.test.ts` 锁定：`mindos-app` 文件不含 `toNextResponse(`、不直接 import handler，且委托的方法集与 `MINDOS_SERVER_ROUTES` 一致。详见 `wiki/specs/spec-hono-route-table.md` 与 `wiki/specs/spec-web-route-delegation.md`。
- `@geminilight/mindos/client`：HTTP client、typed health/files/search/settings/updateSettings/mcpStatus/askStream helpers、server launcher lifecycle。
- `@geminilight/mindos/client-types`：给 Web / Mobile / Desktop 等客户端壳用的 types-only 子路径。`packages/mindos/src/client-types.ts` 只有 `export type { … } from`，覆盖 agent runtime registry / catalog、runtime projections（readiness / adapter / artifact / session）、control plane、ACP wire types、chat message 与 agent-run timeline、`MindosPermissionMode`、`MindOSSSEvent`；tsc 把它编成一行 `export {};`，所以 Metro / webpack 解析这个子路径时不会带进任何服务端代码。`packages/web/lib/types.ts` 与 `packages/mobile/lib/types.ts` 只允许从它重导出这些名字，各自的 `lib/types.test-d.ts` 用 `Expect<Equal<…>>` 在 typecheck 里钉住「重导出就是 core 类型」，`tests/client-types-subpath-contract.test.ts` 拒绝本地复制、拒绝 Mobile 对 `@geminilight/mindos` 的值导入。Mobile 的 typecheck 因此依赖 `packages/mindos/dist`，本地先 `pnpm --filter @geminilight/mindos build`，CI 的 `build-mobile.yml` 需要在 typecheck 前加同一步构建（follow-up，见 backlog）。详见 `wiki/specs/spec-client-types-and-sse-parsers.md`。
- `@geminilight/mindos/plugin` / `tool` / `session` / `agent`：OpenCode-style extension/runtime contracts；先作为 product subpath exports，后续再评估是否拆独立 npm 包。
- `@geminilight/mindos/protocols`：MCP/ACP/A2A 的产品逻辑归属规则；ACP/MCP 默认 runtime 源码位于 `packages/mindos/src/protocols/*`，发布为 `dist/protocols/*` bundle。
- `@geminilight/mindos/cli`：CLI command grouping / registry helpers，让 `packages/mindos/bin/cli.js` 保持薄入口；npm 主包 `bin/mindos-shim.cjs` 负责解析当前平台 runtime package。

它不能 import `packages/web`、Next.js、React 或协议 host。Web 的 `packages/web/app/api/file/route.ts` 直接调用 `@geminilight/mindos/server` facade；`packages/web/lib/core/security.ts` 只直接 import `@geminilight/mindos`。`NextResponse`、cache refresh、UI state 仍留在 Web adapter。

发布边界：
- repo root `package.json` 是 `private: true` 的 monorepo orchestrator，不再拥有 npm `bin` / `files` / `prepack` 发布契约。
- `packages/mindos/package.json` 是实际发布的 `@geminilight/mindos`，拥有 `bin: { "mindos": "bin/mindos-shim.cjs" }`、`exports`、`files` 和 `prepack`。
- product `prepack` 会构建 Web standalone 到 `packages/mindos/_standalone` 并 stage runtime assets；正式 npm 发布时平台包承载完整 runtime root，主包只保留 shim + public JS exports。
- `scripts/build-platform-packages.mjs` 生成 `@geminilight/mindos-<platform>` 包，并写入 `runtime-manifest.json`（product version、platform、entrypoints、health route、included artifacts）。
- local `npm pack` 后 product `postpack` 会清理 staging output，避免 generated copies 被误当成源码。

`packages/retrieval/*` 只保留可选 adapter / service：

- `search`：MeiliSearch adapter。
- `vector`：LanceDB adapter。
- `indexer`：chokidar watch + search/vector backend 编排。
- `api`：Express / WebSocket retrieval service。

这些 adapter 依赖 `@geminilight/mindos/retrieval` 的核心 contracts；`packages/mindos` 不反向 import 它们。

#### 插件安装原语与 runtime extension 安装（2026-09-11）

spec：`wiki/specs/spec-plugin-primitives.md`（审计 P2-5 / P2-6 + #326 layering 收尾）。

`foundation/plugins/` 是两套插件安装路径（agent runtime extension 与 Obsidian community plugin）的共享原语层，经 `@geminilight/mindos/foundation` 导出：

| 原语 | 模块 | 消费方 |
| --- | --- | --- |
| staged install | `staged-install.ts` `stagedDirectorySwap(targetDir, populate, options)`：mkdtemp stage → populate → validate → beforeSwap → backup+双 rename → onSwapped → backup 清理（可容忍失败）；任一步失败清 stage、目标缺失时从 backup 恢复 | `server/handlers/runtime-extensions.ts`（经 extension-store）、`web/lib/obsidian-compat/community-install.ts`（install 与 update 流，stage/backup 命名前缀保持 `.installing-<id>-` / `.updating-<id>-` / `.previous-<id>-`） |
| id/路径段校验 | `safe-id.ts`：首字符 alnum、内部 `[A-Za-z0-9._-]`（`allowDots` 可关）、拒绝 dot 段/分隔符/Windows 盘符与保留名/原型键/控制字符/unicode，默认 64 上限，返回 issue 枚举 | `agent/runtime/extension-manifest.ts sanitizeId`、`web/lib/obsidian-compat/plugin-paths.ts assertSafeObsidianPluginId`（错误文案保持不变）、`agent/runtime/acp-overrides.ts isSafeAgentId`、runtime-extensions settings 记录键 |
| 确认收据 | `confirmation-receipt.ts`：canonical-JSON（键排序、剔除原型键）→ sha256 截断指纹；`{ fingerprint, confirmedAt, ttlMs? }` 收据 + ttl/时钟偏移校验；install 请求形状分类（fingerprint / legacy-boolean / missing / invalid / ambiguous） | runtime extension install（下表）；参考设计是 Obsidian `capability-gate.ts` 的 gate 指纹 |

Runtime extension 安装链（`POST /api/agent-runtimes/extensions/preflight|install`）：

- **preflight**（只读）：parse+sanitize manifest → `fingerprint = sha256(canonicalJson({ schema, replace, manifest, acpAgentOverrides, acpAgentIds }))`，只由提交内容派生、与宿主状态无关；响应含 `fingerprint` 与 `warnings`。
- **install**：确认形状检查（无确认 400；布尔+指纹 ambiguous 400）→ 服务端重建 preflight → `confirmFingerprint` 失配 409（manifest 变更 / 过期 replay / replace 语义变化都会失配）→ staged install → 写 settings。旧布尔 `confirm: true` 仅保留一个发布期，放行但响应 `warnings` 带弃用提示（删除跟进项在 backlog）。
- **授权归属（P2-6）**：`replace: true` 能覆盖哪些 ACP agent 由宿主 `settings.runtimeExtensions[id].appliedAcpAgents` 决定（与 `acpAgents` 同一信任边界）；扩展目录 `mindos-runtime-extension.json` 仅作展示与迁移兜底（settings 无记录时才读，下一次成功 install/replace 收编进 settings）。目录 I/O 在 `agent/runtime/extension-store.ts`，HTTP handler 只剩请求/响应形状。
- **layering**：`agent/runtime` 触达 `protocols/acp` 的唯一 door 是 `acp-types.ts` wire-type barrel；`parseAcpAgentOverrides` 已迁到 runtime 本地 `acp-overrides.ts`（protocols 层 re-export 保持公共 API），`layering.test.ts` 的 `DOCUMENTED_EXCEPTIONS` 为空。

#### 派生状态存储（node:sqlite）

知识内容仍然是 Markdown + Git。三类高频派生状态改用 Node 内建的 `node:sqlite`（`DatabaseSync`，WAL 模式），不新增依赖；spec 见 `wiki/specs/spec-sqlite-derived-stores.md`。

| 数据集 | 数据库 | 模块 | 说明 |
| --- | --- | --- | --- |
| 内容变更日志 | `.mindos/db/change_log_1.sqlite` | `server/handlers/change-log-store.ts` | 唯一实现；Web `lib/core/content-changes.ts` 与 `knowledge/audit` 只做委托。list/summary/facets 是 SQL，保留最新 500 条 |
| Agent run ledger | `.mindos/db/agent_runs_1.sqlite` | `agent/ledger/run-ledger*.ts` | run 行 + timeline/debug 事件同表（`visibility` 列）；事件行只存事件 payload，`record` 读时从 `agent_runs` JOIN 补回（生命周期 / permission 事件保留写入时快照，旧行内嵌 record 原样可读）；本进程打开的 run 记录按进程缓存，token delta 逐条通知进程内订阅者、按 ≤250 ms / 2 KB 合并成一行落库（非 delta 写、生命周期写、进程内读之前 flush）；跨进程即时可见（debug delta 最多晚 250 ms）；孤儿 run 由 `owner_pid/owner_start_ts` 在读时投影为 failed，不改写行；每 run 每类事件保留 1000 条，run 保留 500 条。spec：`wiki/specs/spec-ledger-write-cost.md` |
| Agent artifact 指针 | 同上（`agent_artifacts` 表，migration v2） | `agent/ledger/artifact-ledger{,-db}.ts` | 指针索引卡（path / uri / runId / toolCallId），不存 blob；索引 `(run_id, created_at)` / `(created_at DESC)` / `(updated_at DESC)`，列表按 `updated_at DESC`；按 `created_at` 保留最新 1000；旧 `agent-artifact-ledger.<pid>-<startTs>.jsonl` 首次使用时一次性导入 |
| 跨进程 pending prompts | `.mindos/db/agent_pending_prompts_1.sqlite` | `agent/bridges/pending-prompt-store.ts` | permission / question 提示的跨进程镜像：bridge enqueue/finish 时 upsert/resolve 行（owner_pid/start_ts 标进程），任意进程可对开放行提交决定——单条 `UPDATE … WHERE resolved_at IS NULL` 保证 first-writer-wins，持有者进程 500 ms tail 把决定灌回原 promise 并标 consumed；`meta.version+writer` 供宿主 tail 发 `run.pending-actions.changed`；resolved/expired 行 1 h 后按写入摊销 prune。`GET /api/agent/pending-actions` = 本进程 Map ∪ 存储开放行（owner 存活）∪ automation approvals，经 `server/projections/pending-actions.ts`（纯模块，Web/Mobile 共用同一派生）输出带 `actions[].key`。spec：`wiki/specs/spec-cross-process-run-events.md` |
| Run capsule 索引 | `.mindos/db/capsules_1.sqlite` | `agent/capsules/capsule-index.ts` | 0600 JSON 文件仍是事实来源；索引只记 id → 路径 + 少量字段，按月目录 mtime 判断是否重扫，行 stale 时按文件 stat 刷新，删库可重建 |
| 进程协调 lease | `.mindos/db/state_1.sqlite` | `foundation/storage/leases.ts` | `leases(kind, key, owner, lease_until, acquired_at)`；获取 = 单条 `INSERT … ON CONFLICT DO UPDATE WHERE lease_until <= now`（`BEGIN IMMEDIATE`），释放 / 续约按 owner 匹配，按时间过期所以被 kill 的进程不留永久锁。首个用户是 `server/automations/store.ts` 的 `state.json` 写锁（`kind:'automations'`，TTL 30 s，等待 5→50 ms 退避、总预算 1 s）；`state.json` 本体仍是文件。spec：`wiki/specs/spec-automations-lease-store.md` |

共用底座 `foundation/storage/sqlite.ts`：`openMindosDatabase({ file, migrations })` 负责 WAL / `synchronous=NORMAL` / `busy_timeout=5000` / `foreign_keys=ON`、`_migrations` 表内的幂等迁移、按解析路径缓存的进程内句柄，以及 `openMindosDatabaseIfExists`（纯读不建库）。`node:sqlite` 通过 `process.getBuiltinModule` 加载，避免 vite / webpack 把 `node:sqlite` 当成普通包解析。文件名带 schema 代际后缀（`_1`），破坏性变更换新文件并从旧文件导入。

`state_1.sqlite` 只放协调状态，没有需要保留的数据，删除即重建；automations 的 legacy `state.lock` 目录在升级窗口内被当作争用（mtime ≤ 30 s），过期后由下一次写入清理并 `console.warn` 一次。仓库里其余目录锁（runtime-control-plane 无锁、context-assets、context-feedback、echo-promotion、connections）计划依次接入同一张表，见 spec 的存储盘点表。

旧格式在首次打开时导入并改名为 `*.migrated`：`change-log.json`（JSONL 或 v1 pretty JSON）+ `change-log.meta.json`、`agent-run-ledger.json` / `.jsonl` / `agent-run-ledger.<pid>-<startTs>.jsonl` 分片、`agent-artifact-ledger.<pid>-<startTs>.jsonl` 分片（存活进程的分片保留到进程退出）。`.mindos/db/` 由 sync daemon 自动写入 mind root `.gitignore` 并从 watcher 中排除；Bun 单二进制运行时下这些 store 会抛出明确错误（follow-up）。

#### 文件树缓存与搜索索引（单一实现，Web 只做 facade）

spec 见 `wiki/specs/spec-core-consolidation.md`。文件枚举、树缓存、全文索引、`.mindosignore` 匹配、JSONC 解析和 `~` 展开各只有一份实现，全部在 `packages/mindos/src`：

| 能力 | 模块 | 说明 |
| --- | --- | --- |
| 文件枚举 | `server/mind-root-files.ts` | `MINDOS_ALLOWED_FILE_EXTENSIONS` / `MINDOS_IGNORED_DIRS`、`collectFileStatsFromMindRoot` 等 walker；`runtime.ts` 只转出口 |
| 树缓存 | `server/tree-cache.ts` | `getMindRootTreeCache(root)` 按 root 注册表；stats + 单调 version；递归 `fs.watch` 事件 500ms 批处理后逐路径 `refreshPath()`（目录事件 / null / 溢出 / `.mindosignore` 变化才全量 stat walk）；`subscribe()` 供 SSE `tree.changed`；`startWatcher/stopWatcher` |
| 搜索索引 | `server/search/{tokenizer,scoring,index}.ts` | `MindosSearchIndex`：`Intl.Segmenter` 中文分词 + unigram（bigram 回退）、BM25、段落 snippet；`refresh()` 以 tree version 为快路径、按 mtime/size 增量重读；`listFiles` / `textExtensions` / `extractors` / `shouldIndex` 可注入；`search-parity.test.ts` 用合并前 Web 实现生成的 fixture 锁定结果 |
| ignore 规则 | `server/search-ignore.ts` + `foundation/shared/utils/glob.ts` | glob 走 `picomatch`（`dot: true`，无 `/` 的 glob 按 basename 匹配）；`createMindosIgnoreRuleMatcher` 纯函数，`createCachedMindosSearchIgnoreMatcher` 按 `.mindosignore` mtime 缓存 |
| JSONC | `foundation/shared/utils/jsonc.ts`（CLI 经生成 bundle 取值：`bin/lib/jsonc.js`） | `jsonc-parser`：读用 `parseJsonc` / `parseJsoncDocument`，写用 `setJsoncValue` / `removeJsoncValue`（`modify + applyEdits`，注释与格式保留，`.bak` 备份已删除） |
| `expandHome` | `foundation/shared/utils/path.ts`（CLI 经生成 bundle 取值：`bin/lib/path-expand.js`） | `~`、`~/`、`~\`；ACP 的 `expandHome` 在其上叠加 `%VAR%` 展开 |

standalone 服务在 `server/services.ts` 用 `new MindosSearchIndex(root, { listFiles: () => treeCache.collectFileStats() })` 接线；Web 的 `lib/fs.ts` 只从 `getWebTreeCache(root)`（`lib/core/mind-root-cache.ts`，沿用 Web 的 30s / 5min TTL 与 `now: () => Date.now()`）派生 `FileNode` 树、Space 预览（按 INSTRUCTION/README mtime 缓存）、scaffold 过滤的文件列表和 shape / content 两个版本计数器，不再有自己的 `fs.watch` 与 `readdirSync`；`lib/core/search.ts` 只为 Web 配置索引（`.md/.csv` + PDF 抽取、根级系统文件与默认 scaffold 排除）并保留 embedding 联动、PDF 时间预算和 telemetry。核心 `src/` 不再 import `chokidar`（`knowledge/storage/local-watch.ts` 用 `fs.watch` 递归实现同一事件词表），但依赖仍声明在 `packages/mindos/package.json`，因为 `bin/lib/sync.js` 动态导入它且平台包闭包只从该 package 解析依赖。

### 3. packages/mindos/src/knowledge/knowledge-ops — 知识库操作内核

`packages/mindos/src/knowledge/knowledge-ops` 是知识库写操作的纯 TypeScript 编排层，不依赖 Next.js。它通过 `@geminilight/mindos` 对外暴露，负责：

- 从请求数据推导 `source` 和权限 actor
- 调用内部 permissions 模块做 allow / deny / ask 决策
- 调度 Web 注入的 operation handler
- 统一判断哪些操作会改变文件树（触发 Web sidebar/cache refresh）

Web 的 `packages/web/app/api/file/route.ts` 只保留 Next.js adapter：读取 request body/headers，调用 `@geminilight/mindos/server` 的 `handleFilePost()`，再做 `revalidatePath()` 和 change log 写入。旧的 Web-local `operation-kernel.ts` / `handlers.ts` 已删除，避免和 Product Server file handler 形成两套写入逻辑。

后续 MCP / CLI 如果需要绕过 HTTP 直接执行知识库操作，应优先复用 `@geminilight/mindos`，不要重新实现权限和 tree-change 规则。

### 4. packages/mindos/src/protocols/mcp-server — MCP Server

**传输：** stdio (本地 Agent) / Streamable HTTP (远程设备，Bearer Token)。HTTP 传输不再依赖 Express：`http-app.ts` 用 Hono + SDK 的 `WebStandardStreamableHTTPServerTransport` 提供 `/mcp` 与 `/api/health`，由 `@hono/node-server` 挂到 `node:http`；无 token 时强制绑定 loopback 并做 Host 头校验（`http-security.ts`），会话由 `session-registry.ts` 记录并定期清理空闲会话。`tools.ts` 只负责注册工具，`index.ts` 保留 `MCP_TRANSPORT` / `MCP_HOST` / `MCP_PORT` / `MCP_ENDPOINT` / `MINDOS_URL` / `AUTH_TOKEN` 的 env 契约。

**工具覆盖：** 读取 (bootstrap, list, read, recent, backlinks, history) / 搜索 (search_notes) / 写入 (write, create, append, append_csv) / 语义编辑 (insert_after_heading, update_section, insert_lines, update_lines) / 管理 (delete, rename, move) — 完整列表以 `packages/mindos/src/protocols/mcp-server/tools.ts` 注册为准。

**安全边界：** 路径沙箱 (`MIND_ROOT` 内) + `INSTRUCTION.md` 写保护 + 25,000 字符上限

### 5. packages/mindos/bin/ — CLI

`packages/mindos/bin/cli.js` 是仓库内 CLI 主入口；npm 安装后仍以包内相对路径 `bin/cli.js` 暴露 `mindos` 命令。命令模块位于 `packages/mindos/bin/commands/*.js`，支撑模块位于 `packages/mindos/bin/lib/*.js`。ESM (`"type": "module"`)。

**主命令：** agent, ask, start, stop, status, open, file, space, search, mcp, init/onboard, config, channel, feishu-ws, doctor, update

**附加命令：** dev, build, restart, sync, gateway, token, logs, api, init-skills, uninstall

### 6. skills/ — Agent Skill

`mindos` (EN) + `mindos-zh` (ZH) + 28 条 evals。定义结构感知路由、搜索回退、多文件审批等最佳实践。

同步：`skills/` → `packages/web/data/skills/` 手动同步。

### 7. IM Integration — 即时通讯平台集成

**支持的平台（8 个）：**

| # | 平台 | SDK / 协议 | 认证方式 | 文本上限 | Markdown | 线程 |
|---|------|-----------|---------|---------|----------|------|
| 1 | **Telegram** | grammY | `bot_token`（含 `:` 分隔） | 4,096 | yes | yes |
| 2 | **Discord** | discord.js (REST) | `bot_token` | 2,000 | yes | yes |
| 3 | **飞书 (Feishu/Lark)** | @larksuiteoapi/node-sdk | `app_id` + `app_secret` | 30,000 | yes | yes |
| 4 | **Slack** | @slack/web-api | `bot_token`（`xoxb-` 前缀） | 4,000 | yes | yes |
| 5 | **企业微信 (WeCom)** | native fetch | `webhook_key` 或 `corp_id` + `corp_secret` | 2,048 | yes | no |
| 6 | **钉钉 (DingTalk)** | native fetch + HMAC | `webhook_url` 或 `client_id` + `client_secret` | 20,000 | yes | no |
| 7 | **微信 (WeChat)** | native fetch (ClawBot) | `bot_token` | 4,096 | no | no |
| 8 | **QQ** | native fetch (QQ Open Platform) | `app_id` + `app_secret` | 4,096 | yes | no |

> WeCom 和 DingTalk 支持**双认证模式**：简单 webhook（单向发送）或完整应用凭证（双向交互）。

**核心模块 (`lib/im/`)：**
- `types.ts` (147 行) — 8 个平台的统一类型定义 + 能力矩阵 + `PLATFORM_LIMITS`
- `config.ts` (160 行) — `~/.mindos/im.json` 配置文件 I/O，mtime-based 缓存，原子写入
- `executor.ts` (225 行) — 统一的消息发送执行器 + 适配器单例管理 + 指数退避重试
- `format.ts` (116 行) — 消息预处理（Markdown 降级、Telegram MarkdownV2 转换、截断）
- `index.ts` (122 行) — pi-coding-agent Extension API 集成，注册 2 个工具 + 1 个命令
- `adapters/` — 8 个平台适配器（50-250 行，全部 lazy-load + dynamic import）

**适配器设计模式：**
- Telegram/Discord/Feishu/Slack 使用 npm SDK（dynamic import，未使用时零 bundle 成本）
- WeCom/DingTalk/WeChat/QQ 使用 native fetch（无外部依赖）
- WeCom/DingTalk/QQ 有 token 自动刷新（过期前 5 分钟提前刷新）

**Agent 工具（2 个）：**
- `send_im_message(platform, recipient_id, message, format?, thread_id?)` — 发送消息到已配置平台
- `list_im_channels()` — 列出已连接平台 + 连接状态 + 支持的特性

**配置文件：** `~/.mindos/im.json`（权限 0o600，原子写入）

```json
{
  "providers": {
    "telegram": { "bot_token": "123:ABC..." },
    "feishu": { "app_id": "...", "app_secret": "..." },
    "wecom": { "webhook_key": "..." },
    "dingtalk": { "webhook_url": "...", "webhook_secret": "..." }
  }
}
```

**API 端点：**
- `GET /api/im/status` — 列出已配置平台 + 连接状态
- `GET/PUT/DELETE /api/im/config` — IM 配置 CRUD（敏感信息自动掩盖）
- `POST /api/im/test` — 测试消息发送

参考：`wiki/refs/im-integration-research-2026-04-09.md`（详细的平台对比与 SDK 选型）、`wiki/specs/spec-im-integration.md`（完整架构）。

### 6. A2A Protocol — Agent 间通信

**协议：** Google A2A (Agent-to-Agent) 标准协议

**端点：**
- `/.well-known/agent-card.json` — Agent Card 发现
- `POST /api/a2a` — JSON-RPC 入口（SendMessage / GetTask / CancelTask）

**暴露能力：** Search Knowledge Base, Read Note, Write Note, List Files, Organize Files

**Agent 工具 (6)：** `list_remote_agents`, `discover_agent`, `discover_agents`, `delegate_to_agent`, `check_task_status`, `orchestrate`

### 7. packages/mindos/src/protocols/acp + Web ACP adapters — Agent Client Protocol

**协议：** ACP 标准协议，基于 `@agentclientprotocol/sdk` 官方 SDK，通过 JSON-RPC 2.0 over stdio 与本地 Agent 子进程通信

**端点：** `/api/acp/*`（registry / detect / install / config / session）

**注册表：** 31+ 个 ACP Agent 可用

**核心源码：** `packages/mindos/src/protocols/acp` 负责类型、注册表、安装探测、subprocess 生命周期和 session 管理，并通过 `@geminilight/mindos/protocols/acp` 暴露给 Web adapters。Agent descriptor 表（`AGENT_DESCRIPTORS` / `AGENT_ALIASES`）的唯一真值在 `packages/mindos/src/agent/runtime/agent-descriptor-table.ts`，protocols 侧 re-export，导出面不变。

**Descriptor 单一来源：** agent 的启动 / 检测事实（binary、detectCommands、presenceDirs、installCmd、curated name / description、`packageName` 派生）只在描述符表写一次：native runtime（codex / claude）由 `agent/runtime/native-runtimes.ts` 从表派生成两条 `NativeRuntimeDefinition` 记录，`isCodexAgent` / `isClaudeAgent`、`nativeDescriptor` 的 aliases / mcpAgentKey / bridge、`buildAgentRuntimesPayload` 都读定义，不再手写 id 三目；adapter metadata sanitizer 只剩 `agent/runtime/adapter-metadata.ts` 一份，settings / extension manifest / detect 三个入口共用（白名单含 `mcpCapabilities.acp` 与 `sessionCapabilities.delete`）。新增 agent = 改一条表记录，`agent-descriptor-table.test.ts` 遍历所有 consumer 证明这一点。分层规则：`agent/runtime` 只允许经 `agent/runtime/acp-types.ts`（wire-type 唯一出口，`protocols/acp/types.ts` 零依赖）import ACP 类型，`layering.test.ts` 强制执行且例外自删除。ACP 表与 MCP 注册表的 presenceDirs parity 由 `tests/agent-registry-contract.test.ts` 锁定；MCP 注册表自身已单源于 `src/agent/config/registry.ts`（CLI 经生成 bundle 派生、Web 直接 re-export，见「Agent 支持体系」），不再是手抄镜像。详见 `wiki/specs/spec-runtime-descriptor-single-source.md`。

**ACP capability 推导：** ACP runtime 的 capabilities / harness / compatibility / permission projection / readiness 由 `acpCapabilitiesFromHandshake(declared, observed)` 推导：declared 来自 agent 的 `initialize` 握手缓存（handshake-health，动态）与 adapterMetadata（静态，冲突时 handshake 优先），observed 是 `ACP_SESSION_LAYER_SUPPORT` 常量（MindOS session 层实际实现，`session-layer-support.test.ts` 对照 `protocols/acp` 导出反向核对）。`supportsResume` = 声明 `loadSession` × session 层实现 load；`supportsApprovals` 恒来自 MindOS ACP client 应答 `session/request_permission`，permission projection 相应为 `interactive-only` + `runtime-bridged`，blocker 从 `adapter-approval-contract` 变为 `durable-approval-queue`；`supportsMcpConfig` = 声明 MCP transport × session 层 MCP 继承。`applyAcpHandshakeToRuntime`（`descriptors.ts`）在 readiness / adapter projection 构建任何 projection 前套用握手缓存；`authenticate` 阶段失败且 runtime 可用时 status 变 `signed-out`，readiness 补 `runtime-signed-out` gap（user-setup / blocking），与 native runtime 的 signed-out 语义统一。

**自定义 ACP Agent：** `settings.acpAgents` 不只覆盖内置 descriptor，也可声明 custom ACP adapter（`name` / `description` / `command` / `args` / `env` / `detectCommands` / `presenceDirs` / `installCmd`）。检测层会把启用的 custom adapter 纳入 `/api/acp/detect` 与 `/api/agent-runtimes?scope=acp`，session 层会先从 settings 解析 custom registry entry，再回退 CDN / built-in registry；`enabled:false` 表示从检测和运行时列表跳过。

**Web 适配：** `packages/web/lib/acp` 只保留 thin adapters、A2A bridge 和 `acp-tools`。用户配置通过 Web settings 注入为 `overrides`，核心包不读取 Web-only settings。

**Runtime 检测缓存：** `GET /api/agent-runtimes`、六个 `/api/agent-runtimes/*-projections`、`readiness`、`skills/runtime-matches`、Codex thread/model 路由和 native turn gate 都从 `server/handlers/runtime-detection-cache.ts` 读同一份探测结果：进程级（`Symbol.for('mindos.runtimeDetectionCache')`）、key = (settings `acpAgents`+`agentRuntimeEnv` fingerprint, scope `codex|claude|acp`, detector identity)、TTL 60 s、并发共享在途 promise、`force=1` 只跳过新鲜判断。Web 宿主通过 `agentRuntimes.detectionIdentity = 'web-host'` 让所有 route bundle 共享一个桶。探测结果变化时总线 emit `runtime.changed { runtimes }`，`POST /api/settings` emit `settings.changed`；Web hooks（`useNativeRuntimeDetection` / `useAcpDetection` / `useRuntimeReadiness` / `useRuntimeSessionProjection` 等）订阅这两个事件而不是轮询，只在事件流断开时保留 30–60 s 兜底。Codex thread/model 路由和 native turn lane 共享一套 supervisor 池化的 app-server client（`agent/runtime/codex-app-server-pool.ts`：thread 路由按 `(command, env hash)` shared 复用，turn lane 按 `(command, cwd, env hash)` exclusive 租约，均 60 s 空闲关闭），`agent-runtimes-codex.ts` 只 re-export 池的公开名。展示压缩与 `runtimeBridge` 标注在 core descriptor 完成，Web 不再有 `decoratePayload`。详见 `wiki/specs/spec-runtime-detection-cache.md`。

**SDK 集成：** `packages/mindos/src/protocols/acp/subprocess.ts` 使用 SDK `ClientSideConnection` + `ndJsonStream` 建立连接，`packages/mindos/src/protocols/acp/session.ts` 通过 SDK 方法管理完整生命周期（initialize → authenticate → session/new → prompt → cancel → close）

**子进程 supervisor 与会话池：** 所有本地拉起的 Agent 子进程（Codex app-server、ACP agent 及其 terminal）统一经 `agent/runtime/process-supervisor.ts` 管理：detached 进程组、SIGTERM → SIGKILL 树杀（Windows `taskkill /T /F`）、按 key 池化（exclusive/shared、空闲 TTL、并发上限 + LRU 淘汰 + release 等待）、进程级 `Symbol.for('mindos.processSupervisor')` 单例，以及唯一的 shutdown hook。`spawnAcpAgent` / `killAgent` / Codex 传输层都走 supervisor，`registerAcpShutdownHooks` 转调 `registerProcessSupervisorShutdownHooks` 并把 `killAllAgents`（先杀 terminal 再杀 agent）注册为附加 teardown，因此一份 hook 就能收掉 Codex + ACP + terminal 全部进程组。Codex turn lane 不再「每轮 spawn → initialize → 一轮 → kill」，而是从 `codex-app-server-pool.ts` 租一个已 initialize 的 app-server（进程跨轮与用户取消存活，`thread/resume` 是唯一每轮握手，传输/进程失败即 evict 让下一轮透明重启）；ACP lane 通过 `protocols/acp/session-pool.ts` 的 `takePooledAcpSession` / `parkAcpSession` 复用可 resume 的空闲会话（parked 表在 `session-registry.ts`，60 s TTL，admission 先淘汰 parked 再判限额，活跃会话不淘汰）。`MINDOS_RUNTIME_PROCESS_POOL=0` 可退回每轮一个进程，`MINDOS_CODEX_APP_SERVER_IDLE_TTL_MS` / `MINDOS_ACP_SESSION_IDLE_TTL_MS` 覆盖 TTL。会话状态变化（register / prompt 起止 / close）经 `session-registry.ts` emit `acp.session.changed { agentId, sessionId, state }`，`useRuntimeSessionProjection` 订阅它即时刷新投影。详见 `wiki/specs/spec-runtime-process-supervisor.md`。

**Agent 工具 (2)：** `list_acp_agents`, `call_acp_agent`

### 8. Agent 支持体系

**MCP Agent：27 个**（单一真值 `packages/mindos/src/agent/config/registry.ts` 的 `DEFAULT_MCP_AGENTS`；Web `packages/web/lib/mcp-agents.ts` 直接 re-export，CLI `packages/mindos/bin/lib/mcp-agents.js` 从 esbuild 生成 bundle `bin/lib/generated/agent-config.mjs` 派生，去 `mindos` 自列）；**ACP 注册表：30+ 个**（独立计数）。

| # | Agent | 全局配置路径 | 格式 | 配置 Key | CLI |
|---|-------|-------------|------|---------|-----|
| 1 | MindOS | `~/.mindos/mcp.json` | json | `mcpServers` | — |
| 2 | Claude Code | `~/.claude.json` | json | `mcpServers` | `claude` |
| 3 | Cursor | `~/.cursor/mcp.json` | json | `mcpServers` | — |
| 4 | Windsurf | `~/.codeium/windsurf/mcp_config.json` | json | `mcpServers` | — |
| 5 | Cline | VS Code globalStorage | json | `mcpServers` | — |
| 6 | Trae | `~/.trae/mcp.json` | json | `mcpServers` | — |
| 7 | Gemini CLI | `~/.gemini/settings.json` | json | `mcpServers` | `gemini` |
| 8 | OpenClaw | `~/.openclaw/mcp.json` | json | `mcpServers` | `openclaw` |
| 9 | CodeBuddy | `~/.codebuddy/mcp.json` | json | `mcpServers` | `codebuddy` |
| 10 | Kimi Code | `~/.kimi/mcp.json` | json | `mcpServers` | `kimi` |
| 11 | OpenCode | `~/.config/opencode/config.json` | json | `mcpServers` | `opencode` |
| 12 | Kilo Code | `~/.config/kilo/kilo.jsonc`（兼容读 `kilo.json`） | json/jsonc | **`mcp`** (`local` / `remote`) | `kilo` |
| 13 | Warp | `~/.warp/.mcp.json` | json | `mcpServers` | — |
| 14 | Pi | `~/.pi/agent/mcp.json` | json | `mcpServers` | `pi` |
| 15 | Augment | `~/.augment/settings.json` | json | `mcpServers` | `auggie` |
| 16 | Qwen Code | `~/.qwen/settings.json` | json | `mcpServers` | `qwen` |
| 17 | Qoder | `~/.qoder.json` | json | `mcpServers` | `qoder` |
| 18 | Trae CN | Application Support (平台相关) | json | `mcpServers` | `trae-cli` |
| 19 | Roo Code | VS Code globalStorage | json | `mcpServers` | — |
| 20 | GitHub Copilot | `Code/User/mcp.json` (平台相关) | json | **`servers`** | `code` |
| 21 | Codex | `~/.codex/config.toml` | **toml** | **`mcp_servers`** | `codex` |
| 22 | Antigravity | `~/.gemini/antigravity/mcp_config.json` | json | `mcpServers` | `agy` |
| 23 | QClaw | `~/.qclaw/mcp.json` | json | `mcpServers` | `qclaw` |
| 24 | WorkBuddy | `~/.workbuddy/mcp.json` | json | `mcpServers` | `workbuddy` |
| 25 | Lingma | `~/.lingma/mcp.json` | json | `mcpServers` | — |
| 26 | CoPaw | `~/.copaw/config.json` | json | **`mcp`** | `copaw` |
| 27 | Hermes | `~/.hermes/config.yaml` | yaml | **`mcp_servers`** | `hermes` |

**特殊格式 Agent：**
- **GitHub Copilot**：配置 key 为 `servers`（非 `mcpServers`）
- **Codex**：TOML 格式，key 为 `mcp_servers`
- **Kilo Code**：JSON/JSONC 配置，key 为 `mcp`；stdio 写入 `{ type:'local', command:['mindos','mcp'], environment:{...}, enabled:true }`，HTTP 写入 `{ type:'remote', url, headers?, enabled:true }`
- **CoPaw**：key 为 `mcp`，嵌套路径 `mcp.clients`
- **Hermes**：YAML 格式，key 为 `mcp_servers`

**默认使用 stdio 传输；支持 HTTP 的路径按各 Agent 的配置格式写入。** 注册表只有一份（core `src/agent/config/registry.ts`），Web / Product Server / CLI 全部从它派生，不再需要三处同步。

**Agent 配置适配层（`packages/mindos/src/agent/config/`）：** 「某个 Agent 的 MCP 配置在哪、怎么读写、是否在本机、Skill 目录在哪」只有一份实现：`registry.ts`（`DEFAULT_MCP_AGENTS` / `DEFAULT_SKILL_AGENT_REGISTRY` / `customAgentToConfigDef`）、`formats.ts` + `toml.ts` / `yaml.ts` / `text.ts`（JSONC 原地编辑与行扫描 walker）、`paths.ts`、`adapter.ts`（`AgentConfigAdapter`：detectPresence / listServers / readServer / writeServer / removeServer / skillWorkspace，custom agent 走同一接口）、`presence.ts`（15s TTL presence 缓存）、`config-read.ts`（`(path, mtimeMs, size)` 记忆的配置解析）、`skill-workspace.ts` / `skill-link.ts`（`linkSkillToAgent`，copy fallback 带 `.mindos-managed`）、`install-transaction.ts`（`installAgentConnection`：写条目 → 链 Skill → 改设置，失败逆序回滚；`POST /api/mcp/install` 与 `mindos mcp install` 共用）。缓存只在未注入 fs 探针时启用（宿主/测试注入即绕过）。`server/handlers/mcp-config-*.ts` 与 `server/mcp-agent-registry.ts` 是 re-export 壳。CLI 不 import `src/`：`scripts/build-cli-bundles.mjs` 用 esbuild 把 `agent/config/index.ts` 打成 `bin/lib/generated/agent-config.mjs`（`jsonc-parser` 内联、只剩 `node:*` import，满足 Bun 单二进制契约），`bin/lib/agent-config.js` 负责按需重建（monorepo checkout）或信任随包文件（打包运行时）；`bin/lib/{toml,yaml,jsonc,path-expand,mcp-agents}.js` 是 ≤30 行的取值壳，`{agent-readiness,skill-install,mcp-install}.js` 只留 CLI 编排。`handlers/skills-index.ts` 以目录 mtime 签名记忆 skill 扫描，`/api/skills`、`/api/skills/matrix`、`/api/skills/runtime-matches` 共用。契约：`tests/agent-registry-contract.test.ts`（CLI 注册表 = core 派生）、`tests/unit/cli-agent-config-bundle.test.ts`（bundle 存在/新鲜、无 bare import、bin/lib 无手抄注册表与解析器）、`tests/bun-single-binary-contract.test.ts`（生成物只含 `node:*`）。详见 `wiki/specs/spec-agent-config-adapter.md`。

新增 Agent 支持时需改动的文件：

| 文件 | 改什么 | 说明 |
|------|--------|------|
| `packages/mindos/src/agent/config/registry.ts` | `DEFAULT_MCP_AGENTS` 新增 `AgentConfigDef`（需要 skill 安装再补 `DEFAULT_SKILL_AGENT_REGISTRY`） | **唯一主定义**，MCP 配置路径、传输方式、存在检测。Web re-export、CLI 生成 bundle 自动读取 |
| CLI 生成物 | 无需手改：`pnpm build` 或 CLI 首次运行时 `bin/lib/agent-config.js` 自动重建 `bin/lib/generated/agent-config.mjs` | `tests/agent-registry-contract.test.ts` 会在 bundle 过期时失败 |

自动生效（不需要改）：`/api/mcp/agents`、`web/lib/mcp-agents.ts`（re-export core）、`bin/lib/mcp-agents.js`（生成派生）、`SetupWizard.tsx`、`McpTab.tsx`（动态渲染）。

参考：`wiki/refs/npx-skills-mechanism.md`（Skills CLI 机制与 Agent 支持矩阵）。

## 数据流

### AI 对话流

```
用户消息 → POST /api/agent/sessions/:sessionId/turns
    ├── 注入：本轮 context（时间、session context、初始化材料、当前/附加文件、上传文件、active recall）
    ├── MindOS Pi runtime：pi-coding-agent session + MindOS extension/tools
    └── 外部 runtime：Codex / Claude Code / ACP adapter → SSE 流式输出
```

### 外部 Agent (MCP)

```
Agent → stdio: spawn node dist/protocols/mcp-server/index.cjs ← stdin/stdout → MCP Server ← App API → my-mind/
     → HTTP:  POST http://host:8781/mcp ← Bearer Token → MCP Server ← fs → my-mind/
```

## 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 前端框架 | Next.js 16 App Router | 服务端组件 + 流式渲染 + API Routes 一体化 |
| 编辑器 | TipTap + CodeMirror 6 | 富文本 + 源码双模式，各自领域最优 |
| Agent SDK | pi-agent-core 0.60.0 | Agent 执行循环 + TypeBox 工具定义 |
| MCP SDK | `@modelcontextprotocol/sdk` | 标准协议，跨 Agent 兼容 |
| 存储 | 本地纯文本 + Git | 隐私、主权、可审计、零依赖 |
| 派生状态 | `node:sqlite`（WAL，`.mindos/db/*_N.sqlite`） | change-log / run ledger / capsule 索引按索引查询、单语句多进程安全；不进 Git 同步 |
| 认证 | Bearer Token (可选) | 简单，兼顾本地开发和网络暴露 |
| 模块格式 | ESM (`"type": "module"`) | Node.js 原生 ESM，import/export |
| 原子写入 | temp file + rename | 防写入中断丢数据 |
