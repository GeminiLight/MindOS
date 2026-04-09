<!-- Last verified: 2026-04-10 | Current stage: v0.6 -->

# MindOS 系统架构 (System Architecture)

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 & 外部 Agent                         │
└──────────┬──────────────────────┬───────────────────────────────┘
           │ Browser (GUI)         │ MCP Protocol (stdio/HTTP)
           ▼                       ▼
┌─────────────────────┐  ┌────────────────────────┐
│   app/ (Next.js 16) │  │  mcp/ (MCP Server)     │
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
├── app/                        # Next.js 16 前端
│   ├── app/                    # App Router 页面 + API Routes
│   ├── components/             # UI 组件
│   │   ├── agents/             # Agent 管理面板
│   │   │   ├── AgentDetailContent.tsx    # 详情页编排（741 行）
│   │   │   ├── AgentDetail*.tsx          # 6 个子组件（Header/Skills/Mcp/Space/Config/SkillEditor）
│   │   │   ├── AgentsSkillsSection.tsx   # Skills 工作台（655 行）
│   │   │   ├── AgentsSkillsByAgent.tsx   # ByAgent 视图 + AgentCard
│   │   │   ├── AgentsPanelA2aTab.tsx     # A2A 面板（297 行）
│   │   │   └── AcpRegistrySection.tsx    # ACP 注册表 + AgentCard
│   │   ├── ask/                # AI 对话
│   │   ├── file-tree/          # 文件树子组件
│   │   │   └── FileTreeContextMenus.tsx  # 右键菜单（Shell/Space/Folder）
│   │   ├── renderers/          # 插件渲染器（11 个）
│   │   │   ├── csv/            # CsvRenderer 拆分：types, EditableCell, TableView, GalleryView, BoardView, ConfigPanel
│   │   │   └── todo/           # TodoRenderer 拆分：parse-todos, FilterBar, SectionCard
│   │   └── settings/           # 设置面板
│   │       ├── DesktopUpdateCards.tsx     # Desktop Core/Shell 更新卡片
│   │       ├── McpConnectGuides.tsx       # MCP 连接指南（CLI/MCP）
│   │       ├── SyncEmptyState.tsx         # Git Sync 初始化向导
│   │       └── ...                        # AiTab, AppearanceTab, KnowledgeTab 等
│   ├── lib/                    # 核心模块
│   │   ├── fs.ts               # 文件系统操作
│   │   ├── agent/              # 内置 Agent (model + tools + prompt)
│   │   │   ├── sse/            # SSE 事件处理（events.ts）
│   │   │   ├── skill-resolver.ts  # Skill 解析
│   │   │   ├── non-streaming.ts   # 非流式响应
│   │   │   ├── file-context.ts    # 文件上下文构建
│   │   │   └── request-utils.ts   # 请求工具
│   │   ├── a2a/               # A2A Protocol (Agent-to-Agent 通信)
│   │   ├── acp/               # ACP Protocol (Agent Client Protocol 集成)
│   │   ├── hooks/              # 共享 React hooks
│   │   │   └── useDirectoryDragDrop.ts  # 文件拖放 hook
│   │   ├── stores/             # 全局状态 stores
│   │   │   ├── mcp-store.ts    # MCP 数据 (Zustand)
│   │   │   ├── locale-store.ts # 语言切换
│   │   │   └── hidden-files.ts # 隐藏文件 store
│   │   ├── parsing/            # 纯逻辑解析器
│   │   │   └── parse-todos.ts  # TODO 解析、行操作、日期、样式
│   │   ├── settings.ts         # 配置管理
│   │   └── renderers/          # 插件注册表
│   └── data/skills/            # 内置 Skill 上下文
├── mcp/                        # MCP Server（工具见 mcp/README 表格）
├── bin/                        # CLI 入口
│   ├── cli.js                  # 命令路由 + 入口 (~742 行)
│   └── lib/                    # 13 个模块
│       ├── commands/           # 模块化命令 (7 个: file, space, ask, status, api, agent, search)
│       ├── constants.js        # ROOT, CONFIG_PATH, BUILD_STAMP 等
│       ├── colors.js           # ANSI 颜色函数
│       ├── utils.js            # run(), expandHome()
│       ├── config.js           # loadConfig(), getStartMode(), isDaemonMode()
│       ├── build.js            # needsBuild(), ensureAppDeps(), cleanNextDir()
│       ├── port.js             # isPortInUse(), assertPortFree()
│       ├── pid.js              # savePids(), loadPids(), clearPids()
│       ├── stop.js             # stopMindos()
│       ├── gateway.js          # systemd/launchd/getPlatform/runGatewayCommand
│       ├── startup.js          # printStartupInfo(), getLocalIP()
│       ├── mcp-spawn.js        # spawnMcp()
│       ├── mcp-install.js      # MCP_AGENTS, mcpInstall()
│       └── sync.js             # Git 自动同步
├── skills/                     # Agent 工作流技能
├── templates/{en,zh}/          # 预设知识库模板
├── landing/                    # 静态 Landing Page
├── scripts/                    # setup.js, release.sh
└── wiki/                       # 项目文档（本文件所在）
```

## 模块详解

### 1. app/ — Next.js 16 前端

**技术栈：** Next.js 16 (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui + TipTap + CodeMirror 6 + pi-agent-core 0.60.0

**API Routes (51)：**

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

**核心组件拆分：**

| 组件 | 拆分前 | 拆分后 |
|------|--------|--------|
| CsvRenderer | 693 行 | 71 行 + 6 子文件 (csv/types.ts, EditableCell.tsx, TableView.tsx, GalleryView.tsx, BoardView.tsx, ConfigPanel.tsx) |
| SettingsModal | 588 行 | 347 行 (SettingsContent.tsx) + 14 子文件 (settings/types.ts, Primitives.tsx, AiTab.tsx, AppearanceTab.tsx, KnowledgeTab.tsx, SyncTab.tsx, McpTab.tsx, UpdateTab.tsx, AgentsTab.tsx, McpAgentInstall.tsx, McpSkillsSection.tsx, MonitoringTab.tsx, PluginsTab.tsx, ShortcutsTab.tsx) |

**插件渲染器 (11个)：**

| 渲染器 | 功能 | 主文件 | 大小 |
|--------|------|--------|------|
| agent-inspector | Agent调用记录查看 | AgentInspectorRenderer.tsx | 11.74 KB |
| backlinks | 反向链接展示 | BacklinksRenderer.tsx | 5.56 KB |
| config | 配置文件渲染 | ConfigRenderer.tsx | 9.49 KB |
| csv | CSV表格/看板/画廊视图 | CsvRenderer.tsx + 6子文件 | 3.27 KB (主文件) |
| diff | 文件差异对比 | DiffRenderer.tsx | 12.76 KB |
| graph | 知识图谱可视化 | GraphRenderer.tsx | 13.27 KB |
| summary | 内容摘要 | SummaryRenderer.tsx | 9.48 KB |
| timeline | 时间线视图 | TimelineRenderer.tsx | 8.28 KB |
| todo | 待办事项看板 | TodoRenderer.tsx | 14.81 KB |
| workflow | Markdown 工作流（旧版） | WorkflowRenderer.tsx | 15.74 KB |
| workflow-yaml | YAML 工作流引擎 | WorkflowYamlRenderer.tsx | — |

**安全：** middleware.ts Bearer Token 认证，同源浏览器免认证。

### 2. mcp/ — MCP Server

**传输：** stdio (本地 Agent) / Streamable HTTP (远程设备，Bearer Token)

**工具覆盖：** 读取 (bootstrap, list, read, recent, backlinks, history) / 搜索 (search_notes) / 写入 (write, create, append, append_csv) / 语义编辑 (insert_after_heading, update_section, insert_lines, update_lines) / 管理 (delete, rename, move) — 完整列表以 `mcp/src/index.ts` 注册为准。

**安全边界：** 路径沙箱 (`MIND_ROOT` 内) + `INSTRUCTION.md` 写保护 + 25,000 字符上限

### 3. bin/ — CLI

13 个 lib 模块 + cli.js 主入口。ESM (`"type": "module"`)。

**命令：** start, dev, stop, open, sync, mcp, mcp install, gateway, token, config, doctor, update, logs, help

### 4. skills/ — Agent Skill

`mindos` (EN) + `mindos-zh` (ZH) + 28 条 evals。定义结构感知路由、搜索回退、多文件审批等最佳实践。

同步：`skills/` → `app/data/skills/` 手动同步。

### 6. A2A Protocol — Agent 间通信

**协议：** Google A2A (Agent-to-Agent) 标准协议

**端点：**
- `/.well-known/agent-card.json` — Agent Card 发现
- `POST /api/a2a` — JSON-RPC 入口（SendMessage / GetTask / CancelTask）

**暴露能力：** Search Knowledge Base, Read Note, Write Note, List Files, Organize Files

**Agent 工具 (6)：** `list_remote_agents`, `discover_agent`, `discover_agents`, `delegate_to_agent`, `check_task_status`, `orchestrate`

### 7. ACP Protocol — Agent Client Protocol

**协议：** ACP 标准协议，支持远程 Agent subprocess 调用

**端点：** `/api/acp/*`（registry / detect / install / config / session）

**注册表：** 31+ 个 ACP Agent 可用

**Agent 工具 (2)：** `list_acp_agents`, `call_acp_agent`

### 8. Agent 支持体系

新增 Agent 支持时需改动的文件：

| 文件 | 改什么 | 说明 |
|------|--------|------|
| `app/lib/mcp-agents.ts` | `MCP_AGENTS` 对象新增 `AgentDef` | **主定义**，MCP 配置路径、传输方式、存在检测。UI 和 API 自动读取 |
| `app/app/api/mcp/install-skill/route.ts` | `UNIVERSAL_AGENTS` / `AGENT_NAME_MAP` / `SKILL_UNSUPPORTED` | Skill 安装时判断是否需要 `-a` flag |

自动生效（不需要改）：`/api/mcp/agents`（遍历 `MCP_AGENTS`）、`SetupWizard.tsx`、`McpTab.tsx`（动态渲染）。

参考：`wiki/refs/npx-skills-mechanism.md`（完整 40 个 agent 清单 + Skills CLI 机制）。

## 数据流

### AI 对话流

```
用户消息 → POST /api/ask
    ├── 注入：Skill + Bootstrap (INSTRUCTION + README + CONFIG) + 当前文件 + 附件
    └── pi-agent-core 0.60.0 → Anthropic/OpenAI → 25 个 KB tools + 6 个 A2A tools + 2 个 ACP tools → 流式输出
```

### 外部 Agent (MCP)

```
Agent → stdio: spawn node mcp/dist/index.js ← stdin/stdout → MCP Server ← fs → my-mind/
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
