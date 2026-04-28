<!-- Last verified: 2026-04-28 | Current stage: v1 release-candidate | Canonical status: wiki/reviews/v1-migration-status-2026-04-27.md -->

# MindOS 系统架构 (System Architecture)

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 & 外部 Agent                         │
└──────────┬──────────────────────┬───────────────────────────────┘
           │ Browser (GUI)         │ MCP Protocol (stdio/HTTP)
           ▼                       ▼
┌─────────────────────┐  ┌────────────────────────┐
│ packages/web (Next.js)  │  │ packages/protocols/mcp-server    │
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
│   ├── mindos/                 # @geminilight/mindos 产品主包：foundation/knowledge 内部模块 + CLI kernel
│   │   ├── bin/                # CLI 入口；npm 安装后仍暴露包内 bin/cli.js
│   │   └── src/                # product facade + foundation/knowledge/retrieval internals
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

> `packages/mindos` 是 OpenCode 式产品主包，当前承载 `@geminilight/mindos` runtime facade、foundation/knowledge 内部模块、能力归属 contract 与 CLI kernel 边界。可选 retrieval 与外部 protocols 继续使用 `packages/*/*` package 边界；Web/Desktop/Mobile/CLI 逐步变薄。
>
> `packages/mindos/_standalone`、`packages/mindos/packages`、`packages/mindos/scripts`、`packages/mindos/assets`、`packages/mindos/skills`、`packages/mindos/templates` 是 `npm pack` / publish 期间 materialize 的 staging output，不是源码目录。它们被 `.gitignore` 和 `pnpm-workspace.yaml` 排除，必要时用 `pnpm run clean:product-stage` 清理。

## 模块详解

### 1. packages/web — Next.js 16 前端

**技术栈：** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + TipTap + CodeMirror 6 + pi-agent-core 0.60.0 + pi-coding-agent 0.61.1 (session/model/auth)

**API Routes (65)：**

> **2026-04-10 架构优化**：关键路由已完成职责分离重构。`ask/route.ts` 从 1,524 行减少至 1,050 行 (-31%)，`file/route.ts` 从 451 行减少至 159 行 (-65%)。7 个业务逻辑模块已提取 (`lib/sse/events.ts`, `lib/agent/skill-resolver.ts`, `lib/agent/non-streaming.ts`, `lib/agent/file-context.ts`, `lib/api/request-utils.ts`, `lib/file/handlers.ts`, `lib/sync/config.ts`)。详见 `wiki/reviews/architecture-review-2026-04-10.md`。

| 端点 | 功能 |
|------|------|
| `POST /api/ask` | AI 对话 — 流式输出，自动注入 bootstrap + skill |
| `GET /api/ask-sessions` | 多轮对话历史 |
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
| `POST /api/mcp/install-skill` | Skill安装 |
| `GET /api/mcp/status` | MCP状态 |
| `GET /api/setup` | 安装设置 |
| `POST /api/setup/check-path` | 路径检查 |
| `POST /api/setup/check-port` | 端口检查 |
| `POST /api/setup/generate-token` | 生成Token |
| `GET /api/setup/ls` | 列出目录 |
| `POST /api/file/import` | 文件导入（支持 AI Organize） |
| `GET /api/changes` | 变更事件追踪 |
| `GET /api/tree-version` | 文件树版本号（缓存失效） |
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
| `GET /api/update-status` | 更新进度 |
| `POST /api/uninstall` | 卸载清理 |
| `GET /api/inbox` | Inbox 收件箱 |
| `POST /api/inbox/clip` | Web Clipper 裁剪入 Inbox |
| `GET /api/lint` | 知识库健康检查 |
| `GET /api/space-overview` | Space 概览数据 |
| `GET /api/file/raw` | 原始文件内容（无解析） |
| `POST /api/mcp/direct-tools` | MCP 工具直接调用 |
| `GET /api/mcp/tools` | MCP 工具列表 |
| `POST /api/mcp/uninstall` | MCP Agent 卸载 |
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
| AskContent | 771 行 | 771 行 | 跳过 (编排型组件，拆分反增复杂度) |

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

- `@geminilight/mindos/foundation`：shared/errors/core/config/logger/permissions/security。
- `@geminilight/mindos/knowledge`：storage/spaces/graph/audit/git/knowledge-ops。
- `@geminilight/mindos/retrieval`：retrieval 核心 contracts、chunking 策略、index/search/vector 抽象与能力边界；默认不启用 MeiliSearch / LanceDB / Express 等重型后端。
- `@geminilight/mindos/protocols`：MCP/ACP/A2A 的产品逻辑归属规则，协议包只做 transport host。
- `@geminilight/mindos/cli`：CLI command grouping / registry helpers，让 `packages/mindos/bin/cli.js` 保持薄入口。

它不能 import `packages/web`、Next.js、React 或协议 host。Web 的 `packages/web/app/api/file/operation-kernel.ts` 与 `packages/web/lib/core/security.ts` 只直接 import `@geminilight/mindos`；`NextResponse`、cache refresh、UI state 仍留在 Web adapter。

发布边界：
- repo root `package.json` 是 `private: true` 的 monorepo orchestrator，不再拥有 npm `bin` / `files` / `prepack` 发布契约。
- `packages/mindos/package.json` 是实际发布的 `@geminilight/mindos`，拥有 `bin: { "mindos": "bin/cli.js" }`、`exports`、`files` 和 `prepack`。
- product `prepack` 会构建 Web standalone 到 `packages/mindos/_standalone`，并只 stage ACP/MCP 的 `dist/`、`package.json`、README；不会把 `packages/web` 源码复制进 npm tarball。
- local `npm pack` 后 product `postpack` 会清理 staging output，避免 generated copies 被误当成源码。

`packages/retrieval/*` 只保留可选 adapter / service：

- `search`：MeiliSearch adapter。
- `vector`：LanceDB adapter。
- `indexer`：chokidar watch + search/vector backend 编排。
- `api`：Express / WebSocket retrieval service。

这些 adapter 依赖 `@geminilight/mindos/retrieval` 的核心 contracts；`packages/mindos` 不反向 import 它们。

### 3. packages/mindos/src/knowledge/knowledge-ops — 知识库操作内核

`packages/mindos/src/knowledge/knowledge-ops` 是知识库写操作的纯 TypeScript 编排层，不依赖 Next.js。它通过 `@geminilight/mindos` 对外暴露，负责：

- 从请求数据推导 `source` 和权限 actor
- 调用内部 permissions 模块做 allow / deny / ask 决策
- 调度 Web 注入的 operation handler
- 统一判断哪些操作会改变文件树（触发 Web sidebar/cache refresh）

Web 的 `packages/web/app/api/file/operation-kernel.ts` 只保留 Next.js adapter：读取 headers/body、创建 `NextResponse`、注入 `fileOperations`，通过 `@geminilight/mindos` 调用操作内核，再把结果交给 route 做 `revalidatePath()` 和 change log 写入。

后续 MCP / CLI 如果需要绕过 HTTP 直接执行知识库操作，应优先复用 `@geminilight/mindos`，不要重新实现权限和 tree-change 规则。

### 4. packages/protocols/mcp-server — MCP Server

**传输：** stdio (本地 Agent) / Streamable HTTP (远程设备，Bearer Token)

**工具覆盖：** 读取 (bootstrap, list, read, recent, backlinks, history) / 搜索 (search_notes) / 写入 (write, create, append, append_csv) / 语义编辑 (insert_after_heading, update_section, insert_lines, update_lines) / 管理 (delete, rename, move) — 完整列表以 `packages/protocols/mcp-server/src/index.ts` 注册为准。

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

### 7. packages/protocols/acp + Web ACP adapters — Agent Client Protocol

**协议：** ACP 标准协议，基于 `@agentclientprotocol/sdk` 官方 SDK，通过 JSON-RPC 2.0 over stdio 与本地 Agent 子进程通信

**端点：** `/api/acp/*`（registry / detect / install / config / session）

**注册表：** 31+ 个 ACP Agent 可用

**核心包：** `packages/protocols/acp` 是 ACP source of truth，负责类型、Agent descriptor、注册表、安装探测、subprocess 生命周期和 session 管理。

**Web 适配：** `packages/web/lib/acp` 只保留 thin adapters、A2A bridge 和 `acp-tools`。用户配置通过 Web settings 注入为 `overrides`，核心包不读取 Web-only settings。

**SDK 集成：** `packages/protocols/acp/src/subprocess.ts` 使用 SDK `ClientSideConnection` + `ndJsonStream` 建立连接，`packages/protocols/acp/src/session.ts` 通过 SDK 方法管理完整生命周期（initialize → authenticate → session/new → prompt → cancel → close）

**Agent 工具 (2)：** `list_acp_agents`, `call_acp_agent`

### 8. Agent 支持体系

**当前支持 26 个 Agent**（`packages/web/lib/mcp-agents.ts` 为 Web/API 单一真实来源，`packages/mindos/bin/lib/mcp-agents.js` 为 CLI 同步入口）：

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
| 10 | iFlow CLI | `~/.iflow/settings.json` | json | `mcpServers` | `iflow` |
| 11 | Kimi Code | `~/.kimi/mcp.json` | json | `mcpServers` | `kimi` |
| 12 | OpenCode | `~/.config/opencode/config.json` | json | `mcpServers` | `opencode` |
| 13 | Pi | `~/.pi/agent/mcp.json` | json | `mcpServers` | `pi` |
| 14 | Augment | `~/.augment/settings.json` | json | `mcpServers` | `auggie` |
| 15 | Qwen Code | `~/.qwen/settings.json` | json | `mcpServers` | `qwen` |
| 16 | Qoder | `~/.qoder.json` | json | `mcpServers` | `qoder` |
| 17 | Trae CN | Application Support (平台相关) | json | `mcpServers` | `trae-cli` |
| 18 | Roo Code | VS Code globalStorage | json | `mcpServers` | — |
| 19 | GitHub Copilot | `Code/User/mcp.json` (平台相关) | json | **`servers`** | `code` |
| 20 | Codex | `~/.codex/config.toml` | **toml** | **`mcp_servers`** | `codex` |
| 21 | Antigravity | `~/.gemini/antigravity/mcp_config.json` | json | `mcpServers` | `agy` |
| 22 | QClaw | `~/.qclaw/mcp.json` | json | `mcpServers` | `qclaw` |
| 23 | WorkBuddy | `~/.workbuddy/mcp.json` | json | `mcpServers` | `workbuddy` |
| 24 | Lingma | `~/.lingma/mcp.json` | json | `mcpServers` | — |
| 25 | CoPaw | `~/.copaw/config.json` | json | **`mcp`** | `copaw` |
| 26 | Hermes | `~/.hermes/config.yaml` | yaml | **`mcp_servers`** | `hermes` |

**特殊格式 Agent：**
- **GitHub Copilot**：配置 key 为 `servers`（非 `mcpServers`）
- **Codex**：TOML 格式，key 为 `mcp_servers`
- **CoPaw**：key 为 `mcp`，嵌套路径 `mcp.clients`
- **Hermes**：YAML 格式，key 为 `mcp_servers`

**所有 Agent 均使用 stdio 传输。** CLI 和 TS 注册表共享同一数据源（`packages/mindos/bin/lib/mcp-agents.js` 导入自 TS 编译产物）。

新增 Agent 支持时需改动的文件：

| 文件 | 改什么 | 说明 |
|------|--------|------|
| `packages/web/lib/mcp-agents.ts` | `MCP_AGENTS` 对象新增 `AgentDef` | **主定义**，MCP 配置路径、传输方式、存在检测。UI 和 API 自动读取 |
| `packages/web/app/api/mcp/install-skill/route.ts` | `UNIVERSAL_AGENTS` / `AGENT_NAME_MAP` / `SKILL_UNSUPPORTED` | Skill 安装时判断是否需要 `-a` flag |
| `packages/mindos/bin/lib/mcp-agents.js` | 同步 CLI 侧注册入口 | CLI `mindos agent` / `mindos mcp install` 需要读到同一 Agent 列表 |

自动生效（不需要改）：`/api/mcp/agents`（遍历 `MCP_AGENTS`）、`SetupWizard.tsx`、`McpTab.tsx`（动态渲染）。

参考：`wiki/refs/npx-skills-mechanism.md`（Skills CLI 机制与 Agent 支持矩阵）。

## 数据流

### AI 对话流

```
用户消息 → POST /api/ask
    ├── 注入：Skill + Bootstrap (INSTRUCTION + README + CONFIG) + 当前文件 + 附件
    └── pi-coding-agent session → Anthropic/OpenAI → 24 个 KB tools + 6 个 A2A tools + 2 个 ACP tools + 2 个 IM tools → 流式输出
```

### 外部 Agent (MCP)

```
Agent → stdio: spawn node packages/protocols/mcp-server/dist/index.cjs ← stdin/stdout → MCP Server ← App API → my-mind/
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
| 认证 | Bearer Token (可选) | 简单，兼顾本地开发和网络暴露 |
| 模块格式 | ESM (`"type": "module"`) | Node.js 原生 ESM，import/export |
| 原子写入 | temp file + rename | 防写入中断丢数据 |
