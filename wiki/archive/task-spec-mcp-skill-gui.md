# Spec: GUI Configuration for MCP Servers & Skills

> Status: **Draft** — 待 review 后实现
> Date: 2026-03-14

## 背景

当前 MCP 和 Skill 只能通过 CLI 配置：
- **MCP 安装**：`mindos mcp install`（交互式多选 agent + transport + scope）
- **Skill**：手动放文件到 `skills/` 或 `app/data/skills/`，无 GUI 管理

用户需求：在 Settings GUI 中直接管理 MCP 连接和 Skill，覆盖"本地 + 云端"两种部署场景。

## 核心区分：本地 vs 云端

| 维度 | 本地部署 | 云端 / 远程部署 |
|------|---------|---------------|
| MCP transport | `stdio`（直接 spawn 进程） | `http`（URL + auth header） |
| MCP server 生命周期 | MindOS 自己管（`spawnMcp()`） | 用户自行启动，MindOS 只连接 |
| Skill 文件 | 本地 `skills/` 目录，可直接读写 | 与 Web 服务同机，也是本地文件 |
| 端口配置 | 可在 GUI 改 | 需展示当前连接 URL |

**设计原则**：GUI 不区分 "local/cloud" 模式 —— 用户选 transport type 即可，系统自适应。

---

## 一、MCP Tab

在 Settings Modal 新增 `MCP` tab（替代当前 Plugins tab，或与 Plugins 合并为 `Extensions` tab）。

### 1.1 MCP Server Status 卡片

显示 MindOS 内建 MCP server 的运行状态：

```
┌─────────────────────────────────────────────┐
│ 🔌 MindOS MCP Server                       │
│                                             │
│ Status      ● Running                       │
│ Transport   HTTP                            │
│ Endpoint    http://127.0.0.1:8787/mcp       │
│ Tools       20 registered                   │
│ Auth        ✔ Token set                     │
│                                             │
│ [Copy Endpoint]  [Copy Config]              │
└─────────────────────────────────────────────┘
```

**数据来源**：`GET /api/mcp/status`（新 API）

**字段**：
- `running: boolean` — MCP 进程是否活跃
- `transport: 'http' | 'stdio'`
- `endpoint: string` — 当前监听地址
- `port: number`
- `toolCount: number`
- `authConfigured: boolean`

### 1.2 Agent Install 面板

一键配置 MCP 到各 AI 客户端（映射 CLI 的 `mindos mcp install`）。

```
┌─────────────────────────────────────────────┐
│ Agent Configuration                         │
│                                             │
│ ┌─────────────┬──────────┬─────────┬──────┐ │
│ │ Agent       │ Transport│ Scope   │      │ │
│ ├─────────────┼──────────┼─────────┼──────┤ │
│ │ Claude Code │ stdio    │ Global  │ [✔]  │ │
│ │ Cursor      │ http     │ Project │ [✔]  │ │
│ │ Windsurf    │ —        │ —       │ [ ]  │ │
│ │ Cline       │ —        │ —       │ [ ]  │ │
│ │ ...         │          │         │      │ │
│ └─────────────┴──────────┴─────────┴──────┘ │
│                                             │
│ Transport: ○ stdio (recommended)  ○ http    │
│                                             │
│ HTTP Settings (if http selected):           │
│ URL:   [http://localhost:8787/mcp        ]  │
│ Token: [••••••••••] 👁                      │
│                                             │
│ [Install Selected]                          │
└─────────────────────────────────────────────┘
```

**交互流程**：
1. 列出 `MCP_AGENTS` 注册表中的 9 个 agent（名称 + 是否已配置 badge）
2. 用户勾选要配置的 agents
3. 选择 transport：`stdio`（推荐）或 `http`
4. 若 http → 展开 URL + Token 输入（Token 默认从 config 读取）
5. 每个 agent 可选 scope（Project / Global），无 project 路径的 agent 自动锁定 Global
6. 点击 "Install Selected" → `POST /api/mcp/install`

**后端**：`POST /api/mcp/install`
- 复用 `mcp-install.js` 的写文件逻辑（提取为 `installMcpForAgent(agentKey, entry, scope)` 纯函数）
- 接收 `{ agents: [{ key, scope }], transport, url?, token? }`
- 返回 `{ results: [{ agent, status: 'ok'|'error', path, message }] }`

**检测已安装**：`GET /api/mcp/agents`
- 扫描各 agent 的 config 文件，检查 `mcpServers.mindos` 是否存在
- 返回 `{ agents: [{ key, name, installed: boolean, scope?, transport?, configPath? }] }`

### 1.3 Port 配置

```
MCP Port  [ 8787     ]  (1024-65535)
⚠ Changes require restart
```

已经在 settings 中有 `mcpPort`，此处直接复用，保存时写入 config。

---

## 二、Skill Tab（合并到 MCP tab 或独立）

### 2.1 Skill 列表

```
┌─────────────────────────────────────────────┐
│ Skills                                      │
│                                             │
│ ┌─ mindos ──────────────────────────── ✔ ─┐ │
│ │ Knowledge base operation guide          │ │
│ │ Source: app/data/skills/mindos/SKILL.md │ │
│ │ Auto-loaded on every /ask request       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─ create-plugin ──────────────────── ✔ ─┐ │
│ │ Guide for creating plugins              │ │
│ │ Source: .claude/skills/create-plugin/   │ │
│ │ Scope: Claude Code only                 │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [+ Add Skill]                               │
└─────────────────────────────────────────────┘
```

**数据来源**：`GET /api/skills`
- 扫描以下目录中的 `SKILL.md`：
  1. `skills/` — 项目根目录
  2. `app/data/skills/` — app bundled
  3. `{mindRoot}/.skills/` — 用户自定义（新增目录约定）
- 解析 YAML frontmatter（name, description）
- 返回 `{ skills: [{ name, description, path, source, enabled }] }`

### 2.2 Skill CRUD

**查看/编辑**：点击 skill 卡片 → 展开 → 显示 SKILL.md 内容（只读 markdown 预览 + 编辑按钮）

**新增 Skill**：`[+ Add Skill]` → 表单：
- Name（slug，用作目录名）
- Description（一行）
- Content（SKILL.md 正文，markdown 编辑器）
- 保存到 `{mindRoot}/.skills/{name}/SKILL.md`

**启用/禁用**：toggle 开关，状态保存到 `~/.mindos/config.json` 的 `disabledSkills: string[]`

**删除**：仅允许删除 `{mindRoot}/.skills/` 下用户自建的 skill

### 2.3 Skill 同步规则

`skills/mindos/SKILL.md` ↔ `app/data/skills/mindos/SKILL.md` 必须一致（按 CLAUDE.md 规则），GUI 编辑内建 skill 时自动同步。

---

## 三、API 设计

### `GET /api/mcp/status`

```json
{
  "running": true,
  "transport": "http",
  "endpoint": "http://127.0.0.1:8787/mcp",
  "port": 8787,
  "toolCount": 20,
  "authConfigured": true
}
```

实现：检查 MCP 进程存活（`fetch(endpoint)` 或检查 PID），从 config 读取 port/auth 信息。

### `GET /api/mcp/agents`

```json
{
  "agents": [
    {
      "key": "claude-code",
      "name": "Claude Code",
      "installed": true,
      "scope": "global",
      "transport": "stdio",
      "configPath": "~/.claude.json"
    },
    {
      "key": "cursor",
      "name": "Cursor",
      "installed": false,
      "hasProjectScope": true,
      "hasGlobalScope": true
    }
  ]
}
```

实现：遍历 `MCP_AGENTS`，读取各 config 文件检查 `mcpServers.mindos`。

### `POST /api/mcp/install`

Request:
```json
{
  "agents": [
    { "key": "claude-code", "scope": "global" },
    { "key": "cursor", "scope": "project" }
  ],
  "transport": "stdio",
  "url": "http://localhost:8787/mcp",
  "token": "xxxx-xxxx-xxxx"
}
```

Response:
```json
{
  "results": [
    { "agent": "claude-code", "status": "ok", "path": "~/.claude.json" },
    { "agent": "cursor", "status": "ok", "path": ".cursor/mcp.json" }
  ]
}
```

实现：从 `mcp-install.js` 提取 `buildEntry()` + `writeAgentConfig()` 为纯函数，API route 调用。

### `GET /api/skills`

```json
{
  "skills": [
    {
      "name": "mindos",
      "description": "Knowledge base operation guide...",
      "path": "app/data/skills/mindos/SKILL.md",
      "source": "builtin",
      "enabled": true,
      "editable": false
    },
    {
      "name": "my-custom-skill",
      "description": "Custom workflow",
      "path": "{mindRoot}/.skills/my-custom-skill/SKILL.md",
      "source": "user",
      "enabled": true,
      "editable": true
    }
  ]
}
```

### `POST /api/skills`

Actions: `create`, `update`, `delete`, `toggle`

```json
{ "action": "create", "name": "my-skill", "description": "...", "content": "..." }
{ "action": "update", "name": "my-skill", "content": "..." }
{ "action": "delete", "name": "my-skill" }
{ "action": "toggle", "name": "my-skill", "enabled": false }
```

---

## 四、UI 组件结构

### Settings Tab 变更

```
现有 tabs: AI | Appearance | Knowledge | Sync | Plugins | Shortcuts
新 tabs:   AI | Appearance | Knowledge | Sync | MCP | Plugins | Shortcuts
```

`types.ts` 的 `Tab` union 新增 `'mcp'`。

### 新文件

| 文件 | 说明 |
|------|------|
| `app/components/settings/McpTab.tsx` | MCP + Skill 管理面板 |
| `app/app/api/mcp/status/route.ts` | MCP server 状态 |
| `app/app/api/mcp/agents/route.ts` | Agent 安装状态检测 |
| `app/app/api/mcp/install/route.ts` | 批量安装 MCP 到 agents |
| `app/app/api/skills/route.ts` | Skill CRUD |
| `bin/lib/mcp-install-core.js` | 从 `mcp-install.js` 提取的纯函数 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `app/components/SettingsModal.tsx` | 新增 MCP tab |
| `app/components/settings/types.ts` | Tab union 加 `'mcp'` |
| `app/lib/i18n.ts` | 新增 `settings.mcp` 段 |
| `app/lib/settings.ts` | `ServerSettings` 加 `disabledSkills?: string[]` |
| `bin/lib/mcp-install.js` | 重构：核心逻辑提取到 `mcp-install-core.js`，CLI 版调用它 |

---

## 五、i18n Keys（新增）

```
settings.tabs.mcp = "MCP" / "MCP"
settings.mcp.serverTitle = "MindOS MCP Server" / "MindOS MCP 服务"
settings.mcp.status = "Status" / "状态"
settings.mcp.running = "Running" / "运行中"
settings.mcp.stopped = "Stopped" / "已停止"
settings.mcp.transport = "Transport" / "传输方式"
settings.mcp.endpoint = "Endpoint" / "端点"
settings.mcp.tools = "Tools" / "工具"
settings.mcp.toolsRegistered = (n) => `${n} registered` / (n) => `已注册 ${n} 个`
settings.mcp.auth = "Auth" / "认证"
settings.mcp.authSet = "Token set" / "已设置 Token"
settings.mcp.authNotSet = "No token" / "未设置"
settings.mcp.copyEndpoint = "Copy Endpoint" / "复制端点"
settings.mcp.copyConfig = "Copy Config" / "复制配置"
settings.mcp.agentsTitle = "Agent Configuration" / "Agent 配置"
settings.mcp.agent = "Agent" / "Agent"
settings.mcp.scope = "Scope" / "范围"
settings.mcp.project = "Project" / "项目"
settings.mcp.global = "Global" / "全局"
settings.mcp.installed = "Installed" / "已安装"
settings.mcp.notInstalled = "Not installed" / "未安装"
settings.mcp.transportStdio = "stdio (recommended)" / "stdio（推荐）"
settings.mcp.transportHttp = "http" / "http"
settings.mcp.httpUrl = "MCP URL" / "MCP URL"
settings.mcp.httpToken = "Auth Token" / "认证 Token"
settings.mcp.installSelected = "Install Selected" / "安装选中"
settings.mcp.installSuccess = (n) => `${n} agent(s) configured` / (n) => `已配置 ${n} 个 agent`
settings.mcp.portLabel = "MCP Port" / "MCP 端口"
settings.mcp.portHint = "Changes require server restart" / "修改后需重启服务"
settings.mcp.skillsTitle = "Skills" / "Skills"
settings.mcp.skillAutoLoaded = "Auto-loaded on every request" / "每次请求自动加载"
settings.mcp.skillSource = "Source" / "来源"
settings.mcp.skillBuiltin = "Built-in" / "内置"
settings.mcp.skillUser = "Custom" / "自定义"
settings.mcp.addSkill = "+ Add Skill" / "+ 添加 Skill"
settings.mcp.deleteSkill = "Delete" / "删除"
settings.mcp.editSkill = "Edit" / "编辑"
settings.mcp.skillName = "Name" / "名称"
settings.mcp.skillDesc = "Description" / "描述"
settings.mcp.skillContent = "Content" / "内容"
```

---

## 六、边界情况

1. **MCP 进程未启动**：Status 显示 "Stopped"，Agent Install 仍可用（写 config 不依赖进程）
2. **权限不足写 config**：install 返回 error，展示具体路径和错误信息
3. **Cloud 场景**：用户部署在远程服务器 → transport 选 http → URL 填远程地址 → token 填服务器 auth token
4. **Agent config 冲突**：其他工具也用同一 config → 只写 `mcpServers.mindos` 字段，不覆盖其他 key
5. **Skill 同名冲突**：用户创建的 skill 名与 builtin 同名 → 拒绝创建，提示冲突
6. **大 SKILL.md**：编辑器限制 50KB，超过提示用外部编辑器

---

## 七、实现顺序

1. `bin/lib/mcp-install-core.js` — 提取纯函数
2. API routes — `mcp/status`, `mcp/agents`, `mcp/install`, `skills`
3. `app/lib/i18n.ts` — 新增 i18n keys
4. `app/components/settings/McpTab.tsx` — UI 组件
5. `app/components/settings/types.ts` + `SettingsModal.tsx` — 集成新 tab
6. Tests — API route 测试 + 组件渲染测试

---

## 八、不在范围内

- MCP server 的远程管理（start/stop/restart）—— 这是进程管理，不属于 GUI config
- 第三方 MCP server 注册（只管 MindOS 自己的 MCP）
- Skill marketplace / 在线安装 —— 未来 feature
- Skill 版本管理 —— 用 git 即可
