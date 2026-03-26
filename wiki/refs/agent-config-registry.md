# Agent 配置注册表（全局维护）

## 目标

统一回答 4 个问题：
1. 每个 Agent 的 MCP 配置写到哪里、如何被检测为“已配置”；
2. 每个 Agent 的 Skills 目录如何落盘（universal vs additional）；
3. token、对话、工具调用、token 用量等统计信息从哪里拿；
4. 这些信息在 App / CLI / Setup 哪些链路会用到，避免漂移。

---

## 单一事实来源（Source of Truth）

### MCP 配置定义
- `app/lib/mcp-agents.ts`（Web / App API 运行时）
- `bin/lib/mcp-agents.js`（CLI / onboard 运行时）

### Skill 安装映射
- `SKILL_AGENT_REGISTRY`（在上述两个文件中）
- `app/app/api/mcp/install-skill/route.ts`
- `scripts/setup.js`（`runSkillInstallStep`）

### 统计与审计
- 对话会话：`app/app/api/ask-sessions/route.ts`，落盘 `~/.mindos/sessions.json`
- 工具调用审计：`app/lib/core/agent-audit-log.ts`，落盘 `<mindRoot>/.mindos/agent-audit-log.json`
- Token/请求等 runtime 指标：`app/lib/metrics.ts` + `app/app/api/monitoring/route.ts`

> 注意：当前 `app/lib/mcp-agents.ts` 与 `bin/lib/mcp-agents.js` 存在条目差异（`vscode`、`codex` 在 App 侧有定义，CLI 侧缺失 MCP_AGENTS 条目），属于已知漂移风险。

---

## MCP Agent 全量配置（App 侧基准）

来源：`app/lib/mcp-agents.ts` 的 `MCP_AGENTS`。

| MCP Agent Key | 显示名 | 格式 | MCP 键名 | Global 路径 | Project 路径 | 默认传输 | Skill 模式 |
|---|---|---|---|---|---|---|---|
| `claude-code` | Claude Code | json | `mcpServers` | `~/.claude.json` | `.mcp.json` | `stdio` | additional |
| `cursor` | Cursor | json | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | `stdio` | universal |
| `windsurf` | Windsurf | json | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | - | `stdio` | additional |
| `cline` | Cline | json | `mcpServers` | `Code/User/globalStorage/.../cline_mcp_settings.json` | - | `stdio` | universal |
| `trae` | Trae | json | `mcpServers` | `~/.trae/mcp.json` | `.trae/mcp.json` | `stdio` | additional |
| `gemini-cli` | Gemini CLI | json | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | `stdio` | universal |
| `openclaw` | OpenClaw | json | `mcpServers` | `~/.openclaw/mcp.json` | - | `stdio` | additional |
| `codebuddy` | CodeBuddy | json | `mcpServers` | `~/.codebuddy/mcp.json` | - | `stdio` | additional |
| `iflow-cli` | iFlow CLI | json | `mcpServers` | `~/.iflow/settings.json` | `.iflow/settings.json` | `stdio` | additional |
| `kimi-cli` | Kimi Code | json | `mcpServers` | `~/.kimi/mcp.json` | `.kimi/mcp.json` | `stdio` | universal |
| `opencode` | OpenCode | json | `mcpServers` | `~/.config/opencode/config.json` | - | `stdio` | universal |
| `pi` | Pi | json | `mcpServers` | `~/.pi/agent/mcp.json` | `.pi/settings.json` | `stdio` | additional |
| `augment` | Augment | json | `mcpServers` | `~/.augment/settings.json` | `.augment/settings.json` | `stdio` | additional |
| `qwen-code` | Qwen Code | json | `mcpServers` | `~/.qwen/settings.json` | `.qwen/settings.json` | `stdio` | additional |
| `qoder` | Qoder | json | `mcpServers` | `~/.qoder.json` | - | `stdio` | additional |
| `trae-cn` | Trae CN | json | `mcpServers` | `Trae CN/User/mcp.json` | `.trae/mcp.json` | `stdio` | additional |
| `roo` | Roo Code | json | `mcpServers` | `Code/User/globalStorage/.../roo-cline/.../mcp_settings.json` | `.roo/mcp.json` | `stdio` | additional |
| `vscode` | VS Code | json | `servers`（`mcp.servers`） | `Code/User/settings.json` | `.vscode/mcp.json` | `stdio` | universal |
| `codex` | Codex | toml | `mcp_servers` | `~/.codex/config.toml` | - | `stdio` | universal |

---

## Skills 目录与加载机制（按 Agent）

### 1) Universal 模式（直接读取 `.agents/skills`）
适用：`cursor`、`cline`、`gemini-cli`、`kimi-cli`、`opencode`、`vscode`、`codex`。

- 项目级：`<project>/.agents/skills/<skill>/`
- 全局（`-g`）：`~/.agents/skills/<skill>/`

### 2) Additional 模式（agent 目录 symlink 到 `.agents/skills`）
适用：`claude-code`、`windsurf`、`trae`、`openclaw`、`codebuddy`、`iflow-cli`、`pi`、`augment`、`qwen-code`、`qoder`、`trae-cn`、`roo`。

- 目标目录（示例）：`~/.claude/skills/<skill>`、`~/.windsurf/skills/<skill>`、`~/.trae/skills/<skill>` 等
- 内容来源：链接到 `~/.agents/skills/<skill>`（或项目级 `.agents/skills/<skill>`）

### 3) MindOS 当前安装策略
来源：`app/app/api/mcp/install-skill/route.ts` 与 `scripts/setup.js`。

- 安装命令：`npx skills add <source> --skill <name> -a ... -g -y`
- source 优先级：`GitHub (GeminiLight/MindOS)` → 本地 fallback
- agent 传参：每个 additional agent 单独 `-a <agent>`；若无 additional 则 `-a universal`

---

## “已配置 MCP”如何加载与检测

### A. Agent 列表加载（UI 面板与 Content）
调用链：
1. `GET /api/mcp/agents`（`app/app/api/mcp/agents/route.ts`）
2. 对每个 `MCP_AGENTS` 项执行：
   - `detectInstalled(key)`：读取 global/project 配置文件
   - `detectAgentPresence(key)`：`which/where` + 目录存在性检查
3. 返回：`installed/present/scope/transport/configPath/...`

### B. 配置文件解析规则
来源：`app/lib/mcp-agents.ts`。

- json/jsonc：`parseJsonc`（支持 `//` 与 `/* */` 注释）
- toml（codex）：`parseTomlMcpEntry`
- 判定入口：`config[agent.key].mindos`（或 TOML 对应 section）

### C. MCP 安装写入规则
来源：`POST /api/mcp/install`（`app/app/api/mcp/install/route.ts`）。

- 写入目标：选中的 global/project 配置文件
- 写入字段：仅更新 `<configKey>.mindos`
- 传输：
  - `stdio`：`{ type:'stdio', command:'mindos', args:['mcp'], env:{MCP_TRANSPORT:'stdio'} }`
  - `http`：`{ url, headers.Authorization? }`
- HTTP 模式附带连通性验证（`tools/list`）

### D. MCP 运行状态读取
来源：`GET /api/mcp/status`。

- 返回：`running/endpoint/port/toolCount/authConfigured/maskedToken/authToken`
- endpoint 按请求 host 动态生成；健康检查走 server-to-self localhost

---

## token / 对话 / 统计信息如何获取（重点：Agent 隐藏目录）

这里要分两层：

1. **MindOS 自身数据层**（稳定、已接 API）  
2. **Agent 原生隐藏目录层**（例如 `~/.claude`，信息更贴近 agent 本体）

### 1) MindOS 自身数据层（当前已实现）

#### MCP token（配置与展示）
- 来源：`readSettings().authToken`
- 接口：`GET /api/mcp/status`
- 字段：
  - `maskedToken`：用于显示
  - `authToken`：用于 snippet 复制（受认证保护）

#### 对话会话（MindOS 面板会话）
- 存储文件：`~/.mindos/sessions.json`
- 接口：`/api/ask-sessions`（GET/POST/DELETE）
- 结构：`id/currentFile/createdAt/updatedAt/messages[]`

#### 工具调用审计（MindOS agent actions）
- 存储文件：`<mindRoot>/.mindos/agent-audit-log.json`
- 写入点：`/api/ask` 的 `afterToolCall -> logAgentOp -> appendAgentAuditEvent`
- 字段：`ts/tool/params/result/message/durationMs/op`
- 可视化：`AgentInspectorRenderer`

#### Runtime 统计（进程级）
- 采集器：`app/lib/metrics.ts`（进程内存态，重启清零）
- 暴露接口：`GET /api/monitoring`
- 关键字段：
  - `application.agentRequests`
  - `application.toolExecutions`
  - `application.totalTokens.input/output`
  - `application.avgResponseTimeMs`
  - `application.errors`

### 2) Agent 原生隐藏目录层（你强调的 `~/.claude` 这类）

当前代码**已读取**隐藏目录用于：
- presence 检测（`detectAgentPresence`，`presenceDirs`）
- MCP 配置检测（`detectInstalled`，global/project 配置文件）

但当前代码**尚未统一读取**各 agent 隐藏目录里的“对话历史 / token 账单 / 会话统计”文件。  
原因：不同 agent 的日志与计费文件格式、路径、版本差异较大，不适合硬编码为单一路径。

#### 已有可稳定依赖的“隐藏目录入口”（按注册表）
- `claude-code`：`~/.claude/`
- `cursor`：`~/.cursor/`
- `windsurf`：`~/.codeium/windsurf/`
- `gemini-cli`：`~/.gemini/`
- `openclaw`：`~/.openclaw/`
- `codebuddy`：`~/.codebuddy/`
- `iflow-cli`：`~/.iflow/`
- `kimi-cli`：`~/.kimi/`
- `opencode`：`~/.config/opencode/`
- `pi`：`~/.pi/`
- `augment`：`~/.augment/`
- `qwen-code`：`~/.qwen/`
- `qoder`：`~/.qoder/` 或 `~/.qoder.json`
- `codex`：`~/.codex/`

#### 推荐采集策略（后续实现）
1. 以 `presenceDirs` 为起点扫描 agent 目录；
2. 按“候选文件名模式”识别 conversation/usage/token 文件（不要写死单一路径）；
3. 做 adapter 解析（每个 agent 一个 parser），输出统一字段：
   - `sessionCount`
   - `lastActiveAt`
   - `tokenInput/Output`（若可得）
   - `cost`（若可得）
4. 解析失败只记 warning，不影响主流程。

### 当前限制（必须知晓）
- 暂无“按 agent 粒度”的 token 统计：`metrics.totalTokens` 仍是进程级累计。
- `~/.claude` 等目录的“会话/token/成本”尚未进入统一 API（目前只用于 presence 与 MCP 配置检测）。
- 不同 agent 目录结构变动频繁，必须通过 adapter + 容错扫描实现，不能依赖单一固定文件名。

---

## 常用排查入口（API / 文件）

### API
- `GET /api/mcp/agents`：每个 agent 的 present/installed/scope/transport
- `GET /api/mcp/status`：MCP 端口、endpoint、token 状态
- `GET /api/monitoring`：请求数、token 累计、错误率
- `GET /api/ask-sessions`：对话会话列表

### 文件
- `~/.mindos/config.json`：`authToken/mcpPort/ai.provider` 等
- `~/.mindos/sessions.json`：聊天会话
- `<mindRoot>/.mindos/agent-audit-log.json`：工具调用审计
- 各 agent MCP 配置文件：见上表

---

## 变更时必须同步的文件

1. `app/lib/mcp-agents.ts`
2. `bin/lib/mcp-agents.js`
3. `app/app/api/mcp/install-skill/route.ts`
4. `scripts/setup.js`
5. `docs/zh/supported-agents.md`
6. `docs/en/supported-agents.md`
7. `wiki/refs/npx-skills-mechanism.md`
8. `wiki/refs/agent-config-registry.md`（本文）
9. 相关测试（`app/__tests__/api/*`, `app/__tests__/core/*`）

---

## 最低验证命令

```bash
cd app && npx vitest run \
  __tests__/api/mcp-install.test.ts \
  __tests__/api/file.test.ts \
  __tests__/core/agent-audit-log.test.ts
```

---

## 常见漂移风险

- App 与 CLI 的 `MCP_AGENTS` 条目不一致（路径、key、格式、presence 检测漂移）
- Skill 模式（universal/additional）在 `install-skill` 与 `setup` 中实现不一致
- 文档写了“支持某 agent”，但 `MCP_AGENTS` 或 `SKILL_AGENT_REGISTRY` 未落盘
- 统计口径误解：把进程级 token 统计误当成 per-agent 统计

