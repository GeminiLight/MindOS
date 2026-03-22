<!-- Last verified: 2026-03-22 | Current stage: 规划 -->

# Stage 15 — Personal Knowledge API

## 功能汇总

| # | 功能 | 状态 | 备注 |
|---|------|------|------|
| 15A | RESTful CRUD API | 📋 | 标准化 REST 端点，替代当前内部 `/api/file` |
| 15B | 批量操作 + 导入导出 | 📋 | 批量读写、Markdown/JSON 导入导出 |
| 15C | Webhook 事件订阅 | 📋 | 文件变更 → 推送通知到外部服务 |
| 15D | API Key 管理 + 权限作用域 | 📋 | 多 key、细粒度 scope、速率限制 |

---

## 现状分析

### 当前对外接口

MindOS 目前有两种对外接口，但都不是为"外部应用集成"设计的：

```
1. MCP Server (20+ 工具)
   → 设计目标：Agent 使用（Claude Code, Cursor 等）
   → 传输协议：stdio / Streamable HTTP
   → 认证：Bearer Token（单一 token，全权限）
   → 问题：MCP 是 Agent 专用协议，Shortcuts/Zapier/Telegram 不支持

2. 内部 Web API (16 个 route)
   → 设计目标：前端 UI 内部调用
   → 传输协议：HTTP (Next.js API Routes)
   → 认证：同源豁免 / JWT cookie
   → 问题：接口设计耦合 UI 逻辑，不适合第三方调用
```

### 核心问题

| 问题 | 影响 |
|------|------|
| MCP 是 Agent 专用协议 | Shortcuts、Zapier、Telegram Bot、n8n 等自动化工具无法接入 |
| 内部 API 非标准 RESTful | `/api/file` 一个端点承载 13 种操作（action 参数区分），不符合 REST 语义 |
| 单一 Bearer Token 无作用域 | 给 Telegram Bot 的 token 拥有全部权限，包括删除文件 |
| 无事件推送机制 | 外部服务无法感知文件变更（只能轮询） |
| 无批量操作 | 导入 100 个文件需要调 100 次 API |

### 目标用户场景

| 场景 | 工具 | 需要的 API |
|------|------|-----------|
| 手机快速记笔记 | iOS Shortcuts / Android Tasker | `POST /v1/files` 创建文件 |
| 每日自动摘要推送 | Telegram Bot / Slack Bot | `GET /v1/search` + Webhook |
| 任务管理同步 | Dida365 / Todoist / Zapier | Webhook（文件变更通知）|
| 知识库备份 | 自定义脚本 | `GET /v1/export` 批量导出 |
| 博客发布 | Hugo / Hexo 构建脚本 | `GET /v1/files/:path` 读取 |
| 浏览器插件收藏 | Chrome Extension | `POST /v1/files` 追加 |
| AI workflow | n8n / Dify / Coze | RESTful CRUD + Search |

---

## API 设计总览

### 基础约定

| 约定 | 说明 |
|------|------|
| Base URL | `http://localhost:3000/v1` |
| 版本 | URL 路径前缀 `/v1`，将来不兼容变更升 `/v2` |
| 认证 | `Authorization: Bearer {api-key}` |
| 格式 | 请求/响应均为 JSON，文件内容为 UTF-8 字符串 |
| 路径参数 | 文件路径使用 URL 编码，相对于 MIND_ROOT |
| 错误格式 | `{ "error": { "code": "NOT_FOUND", "message": "..." } }` |
| 分页 | `?cursor=xxx&limit=50`（游标分页，默认 50，上限 100） |
| 速率限制 | 响应头 `X-RateLimit-Remaining` / `X-RateLimit-Reset` |

### 与现有接口的关系

```
/v1/*              ← 新增：标准 RESTful，面向外部应用
/api/*             ← 保留：前端 UI 内部使用，不暴露给外部
MCP Server         ← 保留：Agent 专用，走 MCP 协议

三者共享同一个文件系统操作层 (app/lib/fs.ts)
```

> **不做 GraphQL**。知识库操作以文件 CRUD 为主，REST 已足够表达。GraphQL 增加客户端复杂度，不符合"非技术用户也能用 Shortcuts 调"的目标。roadmap 中原写"RESTful + GraphQL"，此处决策砍掉 GraphQL。

---

## 15A: RESTful CRUD API

### 用户场景

开发者或自动化工具通过标准 HTTP 请求读写知识库文件，如同操作一个文件存储服务。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| URL 风格 | 资源路径映射：`/v1/files/{path}` | 直觉：URL 即文件路径 | action 参数（当前 `/api/file?action=read`，不 RESTful） |
| 路径编码 | URL path 编码（`/` 保留，空格 → `%20`） | 标准 HTTP 语义 | Base64 编码路径（不可读） |
| 内容格式 | JSON 包裹：`{ "content": "...", "metadata": {...} }` | 元数据和内容一起返回 | 纯文本 body（无法附带元数据） |
| 写入语义 | PUT 全量覆盖 / PATCH 局部修改 | 符合 HTTP 动词语义 | 统一 POST（不标准） |
| 目录操作 | `GET /v1/files/` 返回目录列表 | 路径末尾 `/` 表示目录 | 单独 `/v1/directories` 端点（冗余） |

### API 端点

#### 文件操作

```
GET    /v1/files/{path}          # 读取文件内容 + 元数据
PUT    /v1/files/{path}          # 创建或覆盖文件
PATCH  /v1/files/{path}          # 局部修改（追加、插入、替换章节）
DELETE /v1/files/{path}          # 删除文件
GET    /v1/files/{path}/         # 列出目录内容（注意末尾 /）
POST   /v1/files/{path}:move     # 移动/重命名文件
POST   /v1/files/{path}:copy     # 复制文件
```

#### 搜索

```
GET    /v1/search?q={query}                    # 全文搜索
GET    /v1/search?q={query}&mode=semantic       # 语义搜索（需 RAG 开启）
```

#### 元数据

```
GET    /v1/files/{path}/backlinks    # 反向链接
GET    /v1/files/{path}/history      # Git 修改历史
GET    /v1/recent                    # 最近修改的文件
GET    /v1/graph                     # 知识图谱数据
GET    /v1/stats                     # 知识库统计信息
```

### 详细契约

#### GET /v1/files/{path}

```
GET /v1/files/Projects/MindOS/roadmap.md
Authorization: Bearer mk_xxxx

→ 200
{
  "path": "Projects/MindOS/roadmap.md",
  "name": "roadmap.md",
  "content": "# Roadmap\n\n## P1...",
  "size": 2048,
  "createdAt": "2026-01-15T08:00:00Z",
  "modifiedAt": "2026-03-14T12:30:00Z",
  "mimeType": "text/markdown"
}
```

#### PUT /v1/files/{path}

```
PUT /v1/files/Inbox/quick-note.md
Authorization: Bearer mk_xxxx
Content-Type: application/json

{
  "content": "# Quick Note\n\n从 Shortcuts 创建的笔记"
}

→ 201 Created
{
  "path": "Inbox/quick-note.md",
  "modifiedAt": "2026-03-14T14:00:00Z"
}
```

#### PATCH /v1/files/{path}

```
PATCH /v1/files/Inbox/daily-log.md
Authorization: Bearer mk_xxxx
Content-Type: application/json

{
  "operation": "append",
  "content": "\n- 14:30 和客户开完会，确认了 Q2 目标"
}

→ 200
{
  "path": "Inbox/daily-log.md",
  "modifiedAt": "2026-03-14T14:30:00Z"
}
```

PATCH 支持的 `operation`：

| operation | 说明 | 额外参数 |
|-----------|------|---------|
| `append` | 追加到文件末尾 | `content` |
| `prepend` | 插入到文件开头 | `content` |
| `insert_after_heading` | 在指定标题后插入 | `heading`, `content` |
| `update_section` | 替换指定章节内容 | `heading`, `content` |
| `append_csv_row` | 追加 CSV 行 | `row` (object) |

#### GET /v1/search

```
GET /v1/search?q=项目协作&limit=10
Authorization: Bearer mk_xxxx

→ 200
{
  "results": [
    {
      "path": "Workflows/团队协作SOP.md",
      "snippet": "## 项目协作流程\n每周一 standup...",
      "score": 0.85,
      "modifiedAt": "2026-03-10T09:00:00Z"
    }
  ],
  "total": 3,
  "mode": "keyword"
}
```

#### GET /v1/stats

```
GET /v1/stats
Authorization: Bearer mk_xxxx

→ 200
{
  "totalFiles": 342,
  "totalSize": "12.5MB",
  "byType": {
    "markdown": 280,
    "csv": 45,
    "other": 17
  },
  "lastModified": "2026-03-14T14:30:00Z",
  "topDirectories": [
    { "path": "Projects/", "count": 85 },
    { "path": "Workflows/", "count": 42 }
  ]
}
```

### 错误码

| HTTP 状态 | error.code | 说明 |
|-----------|-----------|------|
| 400 | `INVALID_PATH` | 路径包含非法字符或超出沙箱 |
| 400 | `INVALID_OPERATION` | PATCH operation 不支持 |
| 401 | `UNAUTHORIZED` | API key 缺失或无效 |
| 403 | `FORBIDDEN` | API key 无此操作权限（scope 不足） |
| 403 | `WRITE_PROTECTED` | 尝试修改 INSTRUCTION.md |
| 404 | `NOT_FOUND` | 文件不存在 |
| 409 | `ALREADY_EXISTS` | PUT 创建时文件已存在（可传 `?overwrite=true` 覆盖） |
| 413 | `CONTENT_TOO_LARGE` | 文件内容超过 25,000 字符限制 |
| 429 | `RATE_LIMITED` | 超过速率限制 |

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/v1/files/[...path]/route.ts` | 新增 | 文件 CRUD 端点 |
| `app/app/v1/search/route.ts` | 新增 | 搜索端点 |
| `app/app/v1/recent/route.ts` | 新增 | 最近文件端点 |
| `app/app/v1/graph/route.ts` | 新增 | 图谱端点 |
| `app/app/v1/stats/route.ts` | 新增 | 统计端点 |
| `app/lib/api-auth.ts` | 新增 | API Key 验证 + scope 检查中间件 |
| `app/lib/api-error.ts` | 新增 | 统一错误格式处理 |
| `app/lib/rate-limit.ts` | 新增 | 内存速率限制（令牌桶算法） |

---

## 15B: 批量操作 + 导入导出

### 用户场景

用户要迁移 100 个 Obsidian 笔记到 MindOS，或定期备份知识库到本地 zip。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 批量格式 | JSON 数组（每项含 path + content） | 结构清晰，易解析 | multipart/form-data（复杂）/ NDJSON（生态小） |
| 导出格式 | `.zip`（保持目录结构） | 通用，可直接解压到新 MindOS 实例 | `.tar.gz`（Windows 用户不熟悉） |
| 导入来源 | `.zip` / JSON batch | 覆盖从 Obsidian/Notion 迁移场景 | 直接支持 .enex/.opml（过于碎片） |
| 批量上限 | 单次 100 个文件 / 50MB | 防止超时和内存溢出 | 无限制（风险大） |
| 冲突策略 | `skip` / `overwrite` / `rename`，默认 `skip` | 用户可控，安全优先 | 无冲突处理（覆盖） |

### API 端点

#### POST /v1/batch

```
POST /v1/batch
Authorization: Bearer mk_xxxx
Content-Type: application/json

{
  "operations": [
    { "method": "PUT", "path": "Inbox/note1.md", "content": "# Note 1" },
    { "method": "PUT", "path": "Inbox/note2.md", "content": "# Note 2" },
    { "method": "DELETE", "path": "Inbox/old-note.md" }
  ],
  "onConflict": "skip"
}

→ 200
{
  "results": [
    { "path": "Inbox/note1.md", "status": "created" },
    { "path": "Inbox/note2.md", "status": "created" },
    { "path": "Inbox/old-note.md", "status": "deleted" }
  ],
  "summary": { "created": 2, "deleted": 1, "skipped": 0, "failed": 0 }
}
```

#### POST /v1/import

```
POST /v1/import
Authorization: Bearer mk_xxxx
Content-Type: multipart/form-data

file: obsidian-vault.zip
targetDir: Imported/Obsidian
onConflict: rename

→ 200
{
  "imported": 87,
  "skipped": 3,
  "failed": 0,
  "targetDir": "Imported/Obsidian"
}
```

#### GET /v1/export

```
GET /v1/export?path=Projects/&format=zip
Authorization: Bearer mk_xxxx

→ 200 (Content-Type: application/zip)
(二进制 zip 流)
```

```
GET /v1/export?format=json&path=Workflows/
Authorization: Bearer mk_xxxx

→ 200
{
  "files": [
    { "path": "Workflows/daily.md", "content": "# Daily...", "modifiedAt": "..." },
    { "path": "Workflows/weekly.md", "content": "# Weekly...", "modifiedAt": "..." }
  ],
  "exportedAt": "2026-03-14T15:00:00Z"
}
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/v1/batch/route.ts` | 新增 | 批量操作端点 |
| `app/app/v1/import/route.ts` | 新增 | ZIP/JSON 导入 |
| `app/app/v1/export/route.ts` | 新增 | ZIP/JSON 导出 |
| `app/lib/zip.ts` | 新增 | ZIP 打包/解包工具（使用 `archiver` + `unzipper`） |
| `package.json` | 修改 | 添加 `archiver`, `unzipper` 依赖 |

---

## 15C: Webhook 事件订阅

### 用户场景

用户配置一个 Webhook：每当 `TODO.md` 被修改，自动通知 Telegram Bot 推送变更摘要。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| 推送协议 | HTTP POST（标准 Webhook） | 最通用，Zapier/n8n/自定义服务都支持 | WebSocket（需客户端保持连接）/ SSE（单向） |
| 注册方式 | API 注册 + Settings UI | 开发者用 API，普通用户用 UI | 仅配置文件（不友好） |
| 事件粒度 | 文件级（创建/修改/删除/移动） | 够用且不过于频繁 | 行级变更（太碎，Webhook 风暴） |
| 路径过滤 | glob 模式（如 `TODO*.md`, `Projects/**`） | 灵活，用户只订阅关心的文件 | 无过滤（所有变更都推，噪音大） |
| 存储 | `~/.mindos/webhooks.json` | 本地存储，与配置同级 | 数据库（过重） |
| 重试策略 | 失败重试 3 次（指数退避：1s → 4s → 16s），之后标记 `failed` | 容忍临时网络故障 | 无重试（丢事件）/ 无限重试（资源泄漏） |
| 安全 | HMAC-SHA256 签名（`X-MindOS-Signature`） | 接收方验证消息真实性 | 无签名（易被伪造） |

### 事件类型

| 事件 | 触发条件 | payload 包含 |
|------|---------|-------------|
| `file.created` | 新文件创建 | path, content（可选） |
| `file.modified` | 文件内容变更 | path, diff（可选）, modifiedAt |
| `file.deleted` | 文件删除 | path |
| `file.moved` | 文件移动/重命名 | oldPath, newPath |

### API 端点

#### POST /v1/webhooks

```
POST /v1/webhooks
Authorization: Bearer mk_xxxx
Content-Type: application/json

{
  "url": "https://my-bot.example.com/mindos-hook",
  "events": ["file.created", "file.modified"],
  "filter": "TODO*.md",
  "secret": "my-webhook-secret",
  "includeContent": false
}

→ 201
{
  "id": "wh_abc123",
  "url": "https://my-bot.example.com/mindos-hook",
  "events": ["file.created", "file.modified"],
  "filter": "TODO*.md",
  "status": "active",
  "createdAt": "2026-03-14T15:00:00Z"
}
```

#### Webhook 推送 payload

```
POST https://my-bot.example.com/mindos-hook
Content-Type: application/json
X-MindOS-Signature: sha256=xxxx
X-MindOS-Event: file.modified
X-MindOS-Delivery: d_xxx123

{
  "event": "file.modified",
  "timestamp": "2026-03-14T15:30:00Z",
  "file": {
    "path": "TODO.md",
    "modifiedAt": "2026-03-14T15:30:00Z",
    "size": 1024
  },
  "webhook": {
    "id": "wh_abc123"
  }
}
```

#### 管理端点

```
GET    /v1/webhooks                  # 列出所有 webhook
GET    /v1/webhooks/{id}             # 查看单个 webhook
PATCH  /v1/webhooks/{id}             # 更新 webhook（URL、events、filter）
DELETE /v1/webhooks/{id}             # 删除 webhook
POST   /v1/webhooks/{id}:test        # 发送测试事件
GET    /v1/webhooks/{id}/deliveries   # 查看推送历史（最近 50 条）
```

### Webhook 触发流程

```
文件变更（API / MCP / UI / Git sync）
    │
    ├── 写入文件系统
    │
    ├── 匹配已注册 webhook
    │   ├── 事件类型匹配？
    │   └── 路径 glob 匹配？
    │
    ├── 匹配成功 → 构建 payload → HMAC 签名
    │   → 异步 POST 到 webhook URL
    │   ├── 2xx → 记录成功
    │   └── 非 2xx / 超时 → 重试（指数退避，最多 3 次）
    │       └── 全部失败 → 记录到 deliveries，标记 failed
    │
    └── 无匹配 → 跳过
```

### Settings UI

Settings → API Tab 新增 Webhook 管理区域：

```
┌─ Webhooks ────────────────────────────────┐
│                                            │
│  wh_abc123  ● active                       │
│  https://my-bot.example.com/mindos-hook    │
│  Events: file.created, file.modified       │
│  Filter: TODO*.md                          │
│  Last delivery: 2 min ago ✅               │
│  [Test] [Edit] [Delete]                    │
│                                            │
│  [+ Add Webhook]                           │
└────────────────────────────────────────────┘
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/v1/webhooks/route.ts` | 新增 | Webhook CRUD |
| `app/app/v1/webhooks/[id]/route.ts` | 新增 | 单个 webhook 操作 |
| `app/app/v1/webhooks/[id]/deliveries/route.ts` | 新增 | 推送历史 |
| `app/lib/webhook.ts` | 新增 | 匹配引擎 + 异步推送 + HMAC 签名 + 重试 |
| `app/lib/fs.ts` | 修改 | 写操作后触发 webhook 事件 |
| `app/components/settings/ApiTab.tsx` | 新增 | Webhook 管理 UI |
| `app/components/SettingsModal.tsx` | 修改 | 添加 API Tab |

---

## 15D: API Key 管理 + 权限作用域

### 用户场景

用户给 Telegram Bot 创建一个只能读取 `Inbox/` 目录的 API key，给备份脚本创建一个只读全库的 key。

### 设计决策

| 决策点 | 选择 | 原因 | 放弃的方案 |
|--------|------|------|-----------|
| Key 格式 | `mk_{random_32}` (mind key) | 前缀可识别来源，不与 Bearer Token 混淆 | 纯随机（不可识别）/ JWT（过长） |
| 与现有 Token 关系 | **共存**：`AUTH_TOKEN` 保留为 MCP 全权限 token，`mk_*` 为细粒度 API key | 不 break 现有 Agent 配置 | 统一替换（破坏兼容性） |
| Scope 粒度 | 操作级 + 路径级 | 最灵活，如 `read:*` / `write:Inbox/**` | 仅操作级（无法限制目录） |
| 存储 | `~/.mindos/api-keys.json`（key hash + metadata） | 本地存储，key 原文只在创建时显示一次 | 数据库 / 环境变量 |
| 数量上限 | 最多 20 个 API key | 防止滥用，个人场景足够 | 无限制 |

### Scope 定义

| Scope | 说明 |
|-------|------|
| `read:*` | 读取所有文件 |
| `read:{glob}` | 读取匹配路径的文件，如 `read:Projects/**` |
| `write:*` | 写入所有文件（创建/修改/删除） |
| `write:{glob}` | 写入匹配路径的文件 |
| `search` | 使用搜索 API |
| `export` | 使用导出 API |
| `webhook:manage` | 管理 webhook（创建/删除） |

### API 端点

#### POST /v1/api-keys

```
POST /v1/api-keys
Authorization: Bearer {AUTH_TOKEN}    ← 用主 Token 创建 API key
Content-Type: application/json

{
  "name": "Telegram Bot",
  "scopes": ["read:Inbox/**", "write:Inbox/**", "search"],
  "expiresIn": "90d"
}

→ 201
{
  "id": "key_abc123",
  "name": "Telegram Bot",
  "key": "mk_a1b2c3d4e5f6...",       ← 只在创建时返回，之后不可查看
  "scopes": ["read:Inbox/**", "write:Inbox/**", "search"],
  "expiresAt": "2026-06-12T15:00:00Z",
  "createdAt": "2026-03-14T15:00:00Z"
}
```

#### 管理端点

```
GET    /v1/api-keys               # 列出所有 key（不含 key 原文）
GET    /v1/api-keys/{id}          # 查看单个 key 详情
PATCH  /v1/api-keys/{id}          # 修改 name / scopes / 续期
DELETE /v1/api-keys/{id}          # 吊销 key
```

> **创建和管理 API key 需要主 `AUTH_TOKEN`**（现有 Bearer Token），`mk_*` key 不能创建新 key（防止提权）。

### 速率限制

| 类型 | 限制 | 说明 |
|------|------|------|
| 每 key 每分钟 | 60 次请求 | 令牌桶算法，内存存储 |
| 每 key 每小时 | 1,000 次请求 | 防止持续高频调用 |
| 批量操作 | 每次最多 100 个文件 | 单次请求上限 |
| Webhook 推送 | 每分钟最多 30 次 | 防止事件风暴 |

### Settings UI

Settings → API Tab：

```
┌─ API Keys ────────────────────────────────┐
│                                            │
│  Telegram Bot                 ● active     │
│  mk_a1b2...f6  (创建于 3 天前)              │
│  Scopes: read:Inbox/**, write:Inbox/**     │
│  Expires: 2026-06-12                       │
│  Last used: 10 min ago (42 calls today)    │
│  [Edit Scopes] [Revoke]                    │
│                                            │
│  Backup Script                ● active     │
│  mk_x9y8...z7  (创建于 1 周前)              │
│  Scopes: read:*, export                    │
│  Expires: never                            │
│  Last used: yesterday (1 call)             │
│  [Edit Scopes] [Revoke]                    │
│                                            │
│  [+ Create API Key]                        │
└────────────────────────────────────────────┘
```

### 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/app/v1/api-keys/route.ts` | 新增 | API Key CRUD |
| `app/app/v1/api-keys/[id]/route.ts` | 新增 | 单个 key 操作 |
| `app/lib/api-auth.ts` | 修改 | 支持 `mk_*` key 验证 + scope 检查 |
| `app/lib/rate-limit.ts` | 修改 | 按 key 维度限流 |
| `app/components/settings/ApiTab.tsx` | 修改 | API Key 管理 UI |

---

## 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `api.enabled` | `false` | `/v1` API 总开关（首次需用户主动开启） |
| `api.rateLimit` | `60` | 每 key 每分钟请求上限 |
| `api.maxKeys` | `20` | 最大 API key 数量 |
| `api.webhookMaxRetries` | `3` | Webhook 推送失败重试次数 |

---

## 与 MCP 工具的映射关系

现有 MCP 工具不变，Knowledge API 是面向**非 Agent 应用**的独立接口：

| MCP 工具 | Knowledge API 端点 | 说明 |
|---------|-------------------|------|
| `mindos_read_file` | `GET /v1/files/{path}` | 功能等价 |
| `mindos_write_file` | `PUT /v1/files/{path}` | 功能等价 |
| `mindos_append_to_file` | `PATCH /v1/files/{path}` (append) | 功能等价 |
| `mindos_create_file` | `PUT /v1/files/{path}` | API 不限文件类型 |
| `mindos_search_notes` | `GET /v1/search` | API 支持 mode 参数 |
| `mindos_list_files` | `GET /v1/files/{path}/` | 功能等价 |
| `mindos_get_backlinks` | `GET /v1/files/{path}/backlinks` | 功能等价 |
| — | `POST /v1/batch` | **MCP 无等价物** |
| — | `GET /v1/export` | **MCP 无等价物** |
| — | `POST /v1/webhooks` | **MCP 无等价物** |
| — | `POST /v1/api-keys` | **MCP 无等价物** |

---

## 实施顺序

```
15A (RESTful CRUD, 3-4 天)
    → 15D (API Key + Scope, 2-3 天)
        → 15B (批量 + 导入导出, 2-3 天)
        → 15C (Webhook, 3-4 天)
```

> 15A 和 15D 有强依赖（API 端点需要认证中间件），所以 15D 紧跟 15A。
> 15B 和 15C 可并行，都只依赖 15A 的基础端点。

**总计：~10-14 天**

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| API 暴露到公网（用户不配置防火墙） | 知识库被未授权访问 | 默认 `api.enabled: false`；开启时在 UI 醒目提示"仅限局域网使用，公网需配合反向代理 + HTTPS" |
| Webhook 目标不可达导致堆积 | 内存/CPU 浪费在重试 | 最多 3 次重试 + 指数退避；连续失败 10 次自动禁用该 webhook |
| API key 泄漏 | 知识库被恶意操作 | scope 限制最小权限；key 支持一键吊销；操作日志可审计 |
| 与内部 `/api/*` 路由冲突 | URL 路由歧义 | `/v1/*` 独立路径前缀，不与 `/api/*` 交叉 |
| 批量导入大文件 OOM | 服务崩溃 | 单次 100 文件 / 50MB 上限；流式处理 ZIP |

---

## 遗留项 / Backlog

- OpenAPI / Swagger 文档自动生成（从 route handler 提取 schema）
- SDK 生成（TypeScript / Python / curl 示例）
- OAuth 2.0 授权流程（第三方应用标准授权，当前 API key 足够简单场景）
- Webhook 事件的 `file.modified` 支持 diff 内容（需对接 Git）
- 操作审计日志（哪个 key 在什么时间做了什么操作）
- API 用量统计仪表盘（每 key 的调用次数、热门端点等）
- 与 Knowledge Health 仪表盘（P2D）集成：`GET /v1/health` 返回过期文件、孤立文件等
