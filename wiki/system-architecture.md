# MindOS 系统架构 (System Architecture)

## 整体架构

MindOS 采用三层架构，围绕一个共享的本地文件系统（`my-mind/`）实现人机协同：

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 & 外部 Agent                         │
└──────────┬──────────────────────┬───────────────────────────────┘
           │ Browser (GUI)         │ MCP Protocol (stdio/HTTP)
           ▼                       ▼
┌─────────────────────┐  ┌────────────────────────┐
│   app/ (Next.js 16) │  │  mcp/ (MCP Server)     │
│   ─────────────────  │  │  ────────────────────  │
│   • 前端 UI 组件     │  │  • 20+ MCP 工具        │
│   • API Routes       │  │  • stdio + HTTP 传输   │
│   • 内置 Agent       │  │  • Bearer Token 认证   │
│   • 插件渲染器       │  │  • 安全沙箱 & 写保护   │
└──────────┬──────────┘  └──────────┬─────────────┘
           │                        │
           ▼                        ▼
┌──────────────────────────────────────────────────┐
│              my-mind/ (本地纯文本知识库)             │
│  ──────────────────────────────────────────────── │
│  Markdown (.md) + CSV (.csv) + JSON (.json)      │
│  目录结构 = 语义结构 (Profile, Workflows, ...)    │
│  Git 版本控制 → 时光机 & 审计                     │
└──────────────────────────────────────────────────┘
```

## 模块详解

### 1. app/ — Next.js 16 前端应用

**技术栈：**
- Next.js 16 (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui (Button, Dialog, Input, ScrollArea, Toggle, Tooltip)
- TipTap (WYSIWYG 富文本编辑器) + CodeMirror 6 (Markdown 源码编辑器)
- Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/react`)

**页面路由：**

| 路由 | 文件 | 功能 |
|------|------|------|
| `/` | `app/page.tsx` | 首页 — 最近修改文件列表、快捷搜索、AI 入口 |
| `/view/[...path]` | `app/view/[...path]/page.tsx` | 文件/目录查看 — 自动匹配渲染器 |

**API Routes（10 个）：**

| 端点 | 功能 |
|------|------|
| `POST /api/ask` | AI 对话 — 流式输出，自动注入 bootstrap + skill 上下文 |
| `GET /api/ask-sessions` | 会话管理 — 多轮对话历史 |
| `GET /api/backlinks?path=...` | 反向链接查询 |
| `POST /api/extract-pdf` | PDF 文本提取（上传文件处理） |
| `GET/PUT/DELETE /api/file?path=...` | 单文件 CRUD |
| `GET /api/files` | 文件树列表 |
| `GET /api/graph` | 知识图谱数据（节点 + 边） |
| `GET /api/recent-files` | 最近修改文件 |
| `GET /api/search?q=...` | 全文搜索 |
| `GET/PUT /api/settings` | 应用设置 |

**核心组件：**

| 组件 | 功能 |
|------|------|
| `SidebarLayout` + `Sidebar` + `FileTree` | 左侧文件树导航，自动同步当前文件 |
| `MarkdownView` + `MarkdownEditor` | Markdown 阅读/编辑双模式 |
| `WysiwygEditor` | TipTap 富文本编辑器 |
| `CsvView` | CSV 表格视图（Table/Gallery/Board） |
| `JsonView` | JSON 配置文件查看 |
| `DirView` | 目录浏览视图 |
| `SearchModal` (⌘K) | 全局模糊搜索 + snippet 预览 |
| `AskModal` + `AskFab` (⌘/) | AI 对话侧边栏，支持 `@` 文件引用 + 文件上传 |
| `Backlinks` | 反向链接面板 |
| `TableOfContents` | 目录大纲 |
| `ThemeToggle` | 亮/暗主题切换 |
| `ErrorBoundary` | 错误边界保护 |

**lib/ 核心模块：**

| 模块 | 功能 |
|------|------|
| `lib/fs.ts` | 文件系统操作 — 读写、搜索、反向链接、行级操作、语义操作（insertAfterHeading, updateSection）|
| `lib/agent/` | 内置 Agent — model.ts (Anthropic/OpenAI 模型初始化) + tools.ts (8 个知识库工具) + prompt.ts (系统提示词) |
| `lib/api.ts` | 前端 API 调用封装 |
| `lib/settings.ts` | 配置管理（MIND_ROOT、AI Provider 等） |
| `lib/renderers/` | 插件渲染器注册表 |
| `lib/types.ts` | 类型定义（FileNode, SearchResult 等） |

**Hooks：**

| Hook | 功能 |
|------|------|
| `useAskSession` | AI 对话会话管理 |
| `useFileUpload` | 文件上传处理（PDF 提取等） |
| `useMention` | `@` 引用文件自动补全 |

**安全机制：**
- `middleware.ts`：Bearer Token 认证保护所有 `/api/*` 路由
- 同源浏览器请求免认证（`Sec-Fetch-Site: same-origin`）
- `AUTH_TOKEN` 未设置时为开放模式（本地开发）

### 2. mcp/ — MCP Server

**技术栈：**
- `@modelcontextprotocol/sdk` (MCP SDK)
- TypeScript + Zod (参数校验)
- 单文件实现：`src/index.ts`（约 900 行）

**传输方式：**

| 模式 | 环境变量 | 适用场景 |
|------|---------|---------|
| `stdio` (默认) | `MCP_TRANSPORT=stdio` | 本地 Agent 直接调用 |
| `Streamable HTTP` | `MCP_TRANSPORT=http` | 远程设备通过 URL 调用 |

HTTP 模式支持 `AUTH_TOKEN` Bearer 认证、`MCP_HOST`/`MCP_PORT`/`MCP_ENDPOINT` 配置。

**暴露的 MCP 工具（20+）：**

| 类别 | 工具 | 说明 |
|------|------|------|
| **读取** | `mindos_bootstrap` | 一次加载系统上下文（INSTRUCTION + README + CONFIG + 目标目录） |
| | `mindos_list_files` | 文件树（Markdown ASCII / JSON） |
| | `mindos_read_file` | 读文件内容（支持分页 offset+limit） |
| | `mindos_read_lines` | 按行号数组读取 |
| | `mindos_get_recent` | 最近修改文件 |
| | `mindos_get_backlinks` | 反向链接查询 |
| | `mindos_get_history` | Git 提交历史 |
| | `mindos_get_file_at_version` | 读取特定版本文件内容 |
| **搜索** | `mindos_search_notes` | 全文搜索（支持 scope、file_type 过滤） |
| **写入** | `mindos_write_file` | 原子覆写（temp + rename） |
| | `mindos_create_file` | 创建新文件（自动创建父目录） |
| | `mindos_append_to_file` | 追加内容 |
| | `mindos_append_csv` | CSV 追加行（RFC 4180 转义） |
| **语义编辑** | `mindos_insert_after_heading` | 在标题后插入内容 |
| | `mindos_update_section` | 替换整个章节 |
| | `mindos_insert_lines` | 行级插入 |
| | `mindos_update_lines` | 行级替换 |
| **管理** | `mindos_delete_file` | 删除文件 |
| | `mindos_rename_file` | 重命名文件 |
| | `mindos_move_file` | 移动文件（返回反向链接列表） |

**安全边界：**
- 路径沙箱：所有路径解析后必须在 `MIND_ROOT` 内
- 写保护：根目录 `INSTRUCTION.md` 禁止通过 MCP 修改
- 字符限制：单文件读取上限 25,000 字符

### 3. skills/ — Agent 工作流技能

| Skill | 文件 | 说明 |
|-------|------|------|
| `mindos` | `skills/mindos/SKILL.md` | 知识库操作指南（英文） |
| `mindos-zh` | `skills/mindos-zh/SKILL.md` | 知识库操作指南（中文） |
| — | `skills/mindos/evals/evals.json` | 28 条评估测试用例 |

Skill 定义了 Agent 使用 MCP 工具时的最佳实践：
- 结构感知的多文件路由
- 目录树作为一等语义资产
- 搜索回退层级策略
- 多文件更新需用户审批
- 不在根目录创建文件

**同步机制：** `skills/` → `app/data/skills/` 需要手动同步，内置 Agent 从 `app/data/skills/` 读取 Skill 上下文。

### 4. templates/ — 预设知识库模板

提供 `en/` 和 `zh/` 两套完整模板，用户初始化时复制到 `my-mind/`：

```
templates/{en,zh}/
├── 👤 Profile/          # 身份、偏好、聚焦目标
├── 📝 Notes/            # 收件箱、想法、会议、待反馈
├── 🚀 Projects/         # 产品项目、科研项目、归档
├── 🔄 Workflows/        # SOP 流程（信息、媒体、科研、配置、创业）
├── 🔗 Connections/      # 人脉管理（家人、朋友、同学、同事）
├── 📚 Resources/        # CSV 资源库（AI 产品、工具、学者、KOL）
├── INSTRUCTION.md       # 系统内核（只读）
├── README.md            # 知识库根索引
├── CONFIG.json/md       # 配置
├── TODO.md              # 任务清单
└── CHANGELOG.md         # 变更日志
```

### 5. landing/ — 静态 Landing Page

纯 HTML/CSS 静态页面，通过 GitHub Actions 自动部署到 `gh-pages` 分支。

### 6. experience/ — 经验沉淀（空）

预留目录，用于存放从对话中提炼的经验和 SOP。

## 数据流

### AI 对话流（内置 Agent）

```
用户消息 → POST /api/ask
    ├── 自动注入：Skill (app/data/skills/mindos/SKILL.md)
    ├── 自动注入：Bootstrap (INSTRUCTION + README + CONFIG)
    ├── 自动注入：当前文件 + 附件 + 上传文件
    ├── System Prompt (AGENT_SYSTEM_PROMPT)
    └── streamText() → Vercel AI SDK → Anthropic/OpenAI
         ├── 可调用 8 个 knowledgeBaseTools
         └── 流式输出 → 前端渲染
```

### 外部 Agent 调用流（MCP）

```
外部 Agent (Claude Code / Cursor / ...)
    │
    ├── stdio: 直接 spawn node mcp/dist/index.js
    │   └── Agent ← stdin/stdout → MCP Server ← fs → my-mind/
    │
    └── HTTP: POST http://host:8787/mcp
        └── Bearer Token 认证 → MCP Server ← fs → my-mind/
```

### 知识图谱构建

```
GET /api/graph
    → 扫描所有 .md 文件
    → 提取 WikiLink ([[...]]) + Markdown Link ([text](path.md))
    → 构建 nodes[] + edges[]
    → 前端 force-directed 图谱渲染
```

## CI/CD

`.github/workflows/sync-to-mindos.yml`：

1. **Landing 部署**：`landing/` → `mindos-dev` 和 `mindos` 的 `gh-pages` 分支
2. **代码同步**：`mindos-dev`（私有开发仓库）→ `mindos`（公开发布仓库）
   - 同步目录：`app/`, `mcp/`, `skills/`, `templates/`, `assets/`
   - 使用 `rsync --delete` 保持一致
   - `.gitignore.prod` 覆盖为发布版 `.gitignore`

## 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 前端框架 | Next.js 16 App Router | 服务端组件 + 流式渲染 + API Routes 一体化 |
| 编辑器 | TipTap + CodeMirror 6 | 富文本 + 源码双模式，各自领域最优 |
| AI SDK | Vercel AI SDK | 统一 Anthropic/OpenAI 接口，原生流式支持 |
| MCP SDK | `@modelcontextprotocol/sdk` | 标准协议，跨 Agent 兼容 |
| 存储 | 本地纯文本 + Git | 隐私、主权、可审计、零依赖 |
| 认证 | Bearer Token (可选) | 简单有效，兼顾本地开发和网络暴露场景 |
| 原子写入 | temp file + rename | 防止写入中断导致数据丢失 |
| 文件缓存 | 内存缓存 (5s TTL) | 平衡性能与实时性 |

---
*Last Updated: 2026-03-11*
