# Spec: MindOS CLI Skill（替代 MCP Skill 的低 Token 方案）

## 目标

创建 `mindos` CLI Skill，让 AI Agent 通过 bash 命令操作知识库，替代当前 28 个 MCP 工具的高 token 开销。现有 MCP Skill 重命名为 `mindos-mcp`（保留兼容），新 CLI Skill 作为默认。

## 现状分析

**当前 MCP 方案的问题：**
- 28 个 MCP 工具 schema 常驻 context ≈ 15-20K tokens
- 每次对话开始都要加载全部 schema，即使只用 2-3 个工具
- JSON-RPC 协议开销：每次调用额外 15-30 tokens

**CLI 的优势：**
- Skill 按需加载，metadata ~100 tokens，触发后 ~5K tokens
- CLI 命令本身是文本，LLM 天然理解，无 schema 开销
- `--json` 输出结构化，`--help` 就是给 Agent 的 prompt
- 调研数据：CLI 比 MCP 省 76-90% tokens

**MindOS CLI 现状（已实现）：**
- `mindos file` — list, read, create, delete, rename, search
- `mindos space` — create, list, rename, delete
- `mindos search` — 全文搜索
- `mindos ask` — AI 查询
- `mindos status` — 诊断
- `mindos api` — REST 代理
- `mindos agent` — Agent 管理
- `mindos sync` — Git 同步
- `mindos config` — 配置管理

## 数据流

```
Agent (Claude Code / Cursor / Gemini CLI)
  ↓ 读取 SKILL.md（~5K tokens，一次性）
  ↓ 执行 bash 命令
  → mindos file read "笔记/meeting.md"
  → (本地模式) 直接 fs 读写，零网络开销
  → (远程模式) HTTP → localhost:4567/api/* + Bearer token
  ↓ stdout 返回结果（text 或 JSON）
  → Agent 解析并继续
```

vs 当前 MCP 方案：
```
Agent
  ↓ 加载 28 个工具 schema（~15K tokens）
  ↓ JSON-RPC call
  → MCP Server (port 8781) → HTTP → App (port 3456) → API → fs
  ↓ JSON-RPC response
  → Agent 解析
```

## 方案

### 1. 重命名现有 Skill

```
skills/mindos/SKILL.md          → skills/mindos-mcp/SKILL.md
skills/mindos-zh/SKILL.md       → skills/mindos-mcp-zh/SKILL.md
```

新建：
```
skills/mindos/SKILL.md          ← 新 CLI Skill（英文）
skills/mindos-zh/SKILL.md       ← 新 CLI Skill（中文）
```

### 2. CLI Skill 内容设计（三层架构，参考飞书）

```markdown
# MindOS — Knowledge Base CLI Skill

## 连接配置

本地模式（默认）：
  mindos 命令直接读写本地知识库，无需配置。

远程模式：
  export MINDOS_URL=http://<IP>:<PORT>
  export AUTH_TOKEN=<token>
  # 获取 token: mindos token

## Layer 1: 快捷操作（推荐首选）

| 命令 | 用途 |
|------|------|
| mindos search "关键词" | 全文搜索 |
| mindos file read <path> | 读取文件 |
| mindos file list [dir] | 列出文件 |
| mindos file create <path> --content "..." | 创建文件 |
| mindos space list | 列出所有空间 |
| mindos status | 系统状态 |

## Layer 2: 完整命令

### 文件操作
mindos file list [目录] [--json]
mindos file read <路径> [--lines START:END]
mindos file create <路径> --content "内容"
mindos file delete <路径>
mindos file rename <旧路径> <新路径>
mindos file search <关键词> [--json]

### 空间操作
mindos space list [--json]
mindos space create <名称>
mindos space rename <旧名> <新名>

### 搜索与 AI
mindos search <查询> [--json]
mindos ask "问题"

### 同步
mindos sync now
mindos sync conflicts

## Layer 3: Raw API（高级）
mindos api GET /api/files
mindos api POST /api/file --body '{"action":"read","path":"notes/x.md"}'

## 规则
- 所有写操作前先 mindos file read 确认当前内容
- 输出默认 human-readable，加 --json 给程序解析
- 错误信息包含修复建议，可直接重试
```

### 3. 远程连接设计

**认证方式：** `MINDOS_URL` + `AUTH_TOKEN`（与现有 MCP 认证一致）

```bash
# 本地（默认，CLI 直接读写文件系统）
mindos file read "笔记/会议.md"

# 远程（通过 HTTP API）
MINDOS_URL=http://192.168.1.100:4567 AUTH_TOKEN=xxx mindos file read "笔记/会议.md"

# 或者持久化配置
mindos config set url http://192.168.1.100:4567
mindos config set token xxx
```

CLI 已有 HTTP 回退逻辑：
- `bin/commands/search.js`、`ask.js` 等已通过 `fetch(MINDOS_URL/api/*)` + Bearer token 调用
- `bin/commands/file.js`、`space.js` 等直接读 fs，远程模式需走 HTTP

**需要补充的：**
- `file.js` 和 `space.js` 加 HTTP 回退：当 `MINDOS_URL` 设置且非 localhost 时，走 HTTP API 而非直接 fs
- `mindos config set url/token` 持久化到 `~/.mindos/config.json`

### 4. app/data/skills 同步

按 CLAUDE.md 规则，`skills/` 和 `app/data/skills/` 保持一致：
```
app/data/skills/mindos/       ← 新 CLI skill
app/data/skills/mindos-zh/    ← 新 CLI skill 中文
app/data/skills/mindos-mcp/   ← 原 MCP skill
app/data/skills/mindos-mcp-zh/ ← 原 MCP skill 中文
```

## 影响范围

- `skills/mindos/` — 新内容（CLI skill）
- `skills/mindos-zh/` — 新内容（CLI skill 中文）
- `skills/mindos-mcp/` — 重命名自原 mindos
- `skills/mindos-mcp-zh/` — 重命名自原 mindos-zh
- `app/data/skills/` — 同步上述 4 个目录
- `bin/commands/file.js` — 添加 HTTP 回退（远程模式）
- `bin/commands/space.js` — 添加 HTTP 回退（远程模式）
- `.claude-internal/skills/mindos/` — 如果存在，同步更新

**不受影响：**
- MCP server 本身（`mcp/`）— 保持不变，MCP skill 仍可用
- `bin/cli.js` — 命令已实现，无需改动
- Web UI — 无关

## 边界 case 与风险

1. **用户已安装旧 skill**：重命名后旧 `mindos` skill 变成 CLI 版本。如果用户依赖 MCP 工具名（如 `mindos_read_file`），需要手动切换到 `mindos-mcp` skill。→ 在 SKILL.md 开头加迁移说明
2. **远程模式下 CLI 命令的 auth 失败**：返回清晰的错误信息 + `mindos token` 提示
3. **本地/远程模式自动检测**：如果 `MINDOS_URL` 未设置或是 localhost，走本地 fs；否则走 HTTP
4. **CLI 不可用时**（如 npx 未安装 mindos）：Skill 里注明安装方式 `npm i -g @geminilight/mindos`

## 验收标准

- [ ] `skills/mindos/SKILL.md` 是 CLI 版本，包含三层命令架构 + 远程连接配置
- [ ] `skills/mindos-mcp/SKILL.md` 是原 MCP 版本，内容不变
- [ ] Agent 使用 CLI skill 可以：读文件、写文件、搜索、列空间（本地模式）
- [ ] Agent 使用 CLI skill 可以：通过 `MINDOS_URL` + `AUTH_TOKEN` 远程操作
- [ ] `app/data/skills/` 与 `skills/` 保持一致
- [ ] `mindos file read/list/create` 在远程模式下走 HTTP API

## 实施验证记录（2026-04-05）

### 已验证可行
- ✅ `npx @geminilight/mindos` 一次性使用（无需全局安装）
- ✅ `npm i -g @geminilight/mindos` 全局安装
- ✅ `mindos config set <key> <value>` 通用实现，任意 key 都支持
- ✅ `config.json` 已有 `authToken` 字段（值如 `05bc-36d2-8a49-79d8-2366-85cd`）

### 发现的问题（需在实施前解决）

1. **`file.js` 完全是本地 fs 操作**（import fs, readFileSync 等），没有 HTTP 回退。远程模式下 `mindos file read` 不能用。需要加 HTTP 分支：当 `MINDOS_URL` 非 localhost 时走 `fetch(/api/file)`
2. **`search.js` 硬编码 `localhost:PORT`**，不走 `MINDOS_URL`。远程机器跑不了。需改为优先读 `MINDOS_URL`
3. **config 里没有 `url` 字段**。`mindos config set url http://...` 可以存但没有代码读取它。需要在 `loadConfig()` 里支持 `config.url` → 设置 `MINDOS_URL` 环境变量
4. **Onboarding 流程默认安装 MCP**。有了 CLI Skill 后是否还需要？→ 讨论：MCP 仍有价值（IDE 集成、非 CLI Agent），但可以从"必装"变成"可选"
5. **Web UI 设置页**：Agents tab 目前展示 MCP 安装状态，需要加 CLI Skill 安装引导

### 分阶段计划

**P0（本次）：** Skill 重命名 + 新 CLI SKILL.md 编写
- 重命名 `skills/mindos` → `skills/mindos-mcp`
- 新建 `skills/mindos/SKILL.md`（CLI 版本）
- 同步 `app/data/skills/`

**P1（紧跟）：** CLI 远程模式
- `bin/commands/file.js` 加 HTTP 回退
- `bin/commands/space.js` 加 HTTP 回退
- `search.js` 改为读取 `MINDOS_URL`
- `loadConfig()` 支持 `config.url` → `MINDOS_URL`

**P2（后续）：** Onboarding / UI 更新
- Onboarding: MCP 安装从"必须"变"推荐"
- Web UI Agents tab: 加 CLI Skill 安装引导
- `mindos token` 输出加 CLI Skill 配置说明

### MindOS Agent 模式与 Bash 支持

**现状：**
- `pi-coding-agent` 内置 `bash` tool（`core/tools/bash.js`）
- MindOS `createAgentSession()` 传 `tools: []`，跳过了 pi-coding-agent 的所有内置工具（包括 bash）
- MindOS Agent 只用 `customTools`（28 个知识库工具 + MCP 动态工具）

**改动（P1 一起做）：**
- Agent 模式下把 `tools: []` 改为 `tools: ['bash']`（或等价写法），启用 bash 执行能力
- 这样 MindOS Agent 就能直接跑 `mindos file read` 等 CLI 命令
- Chat 模式保持不变（只读工具，不启用 bash）

**安全考量：**
- bash 工具执行范围受 `cwd`（= mindRoot）限制
- pi-coding-agent 内置沙箱/确认机制
- Agent 模式本身已有写操作的 INSTRUCTION.md 保护（`assertNotProtected`）

**Token 收益：**
- 有 bash 后，Agent 模式可以不加载全部 28 个 customTools 的 schema
- 改为加载 CLI Skill prompt（~5K tokens）+ 1 个 bash tool（~200 tokens）
- 节省 ~15K tokens / 对话
