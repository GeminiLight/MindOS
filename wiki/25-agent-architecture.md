# MindOS Agent 架构

> 最后更新: 2026-04-04

## 一、系统分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web UI (浏览器)                          │
│  AskContent.tsx → useAskSession hook → sessions.json (前端持久化) │
│  发送: { messages[], sessionId, currentFile, attachedFiles }     │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /api/ask (SSE)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js API Route Layer                       │
│                  app/app/api/ask/route.ts                        │
│                                                                 │
│  1. System Prompt 组装                                           │
│  2. Tools 组装 (内置 + Skills + MCP)                             │
│  3. Session 创建 (持久化或 inMemory)                              │
│  4. SSE 流式响应                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 二、包依赖关系

```
@mariozechner/pi-ai              ← LLM provider 抽象 (Anthropic/OpenAI)
    └─ @mariozechner/pi-agent-core   ← agent 执行循环 + session 管理
```

MindOS 使用 `pi-agent-core` 的部分：

- `AgentSession` — agent 执行循环（tool call → execute → respond）
- `SessionManager` — session 持久化 (~/.mindos/sessions/)
- `ToolDefinition` — TypeBox schema 工具定义
- `subscribe('turn_end')` + `steer()` — Loop 检测与 abort
- `ModelRegistry` — provider/model 路由

MindOS **不使用**的部分：

- 内置 coding tools（bash/edit/write）— 用自己的 25 个知识库工具替代
- CLI / TUI — MindOS 是 Web UI 产品
- 默认 system prompt — 用 MindOS 自己的 prompt 覆盖

## 三、工具体系

Agent 能使用的工具分四类：

| 类别 | 数量 | 来源文件 | 工具列表 |
|---|---|---|---|
| 知识库工具 | 25 | `app/lib/agent/tools.ts` | list_files, read_file, read_file_chunk, search, write_file, create_file, batch_create_files, append_to_file, insert_after_heading, update_section, edit_lines, delete_file, rename_file, move_file, get_backlinks, get_history, get_file_at_version, append_csv, get_recent, web_search, web_fetch, list_skills, load_skill, list_mcp_tools, call_mcp_tool |
| A2A 工具 | 6 | `app/lib/a2a/a2a-tools.ts` | list_remote_agents, discover_agent, discover_agents, delegate_to_agent, check_task_status, orchestrate |
| ACP 工具 | 2 | `app/lib/acp/acp-tools.ts` | list_acp_agents, call_acp_agent |
| **合计** | **33** | | |

### 工具执行安全机制

```
用户/Agent 调用工具
        │
        ▼
toPiCustomToolDefinitions 里的 execute wrapper
        │
        ├─ 是写操作？→ assertNotProtected() 检查
        │               失败 → 返回错误文本，不执行
        │
        ├─ 执行实际工具逻辑
        │
        └─ logAgentOp() 记录操作日志
```

### 动态工具组装流程

每次请求调用 `getRequestScopedTools()`：

1. 加载内置 `knowledgeBaseTools`（包含知识库工具 + skill 工具 + MCP 桥接工具）
2. MindOS 内置 MCP server 始终可用
3. 额外 MCP servers 可通过 `~/.mindos/mcp.json` 配置（当前为 stub，预留扩展）

然后 `toPiCustomToolDefinitions()` 把全部 `AgentTool[]` 转成 pi 的 `ToolDefinition[]`，在每个工具的 `execute` 里嵌入写保护和日志。

### Chat 模式 vs Agent 模式

MindOS 支持两种对话模式，用户可在 Ask 面板顶部切换：

| 维度 | Chat 模式 | Agent 模式 |
|---|---|---|
| System Prompt | 精简 ~250 tokens | 完整 prompt + Skill + Bootstrap |
| 工具数量 | 8 个（只读） | 33 个（读写 + A2A + ACP） |
| 可用工具 | list_files, read_file, read_file_chunk, search, get_recent, get_backlinks, web_search, web_fetch | 全部 33 个 |
| Step 上限 | 8 | 默认 25 |
| Token 节省 | ~81% overhead 减少 | — |
| 适用场景 | 快速问答、文件检索 | 文件编辑、多步操作、Agent 协作 |

## 四、Session 持久化

```
前端 (useAskSession)                 后端 (ask route)
┌──────────────────┐                ┌──────────────────────────┐
│ ChatSession      │                │ Pi SessionManager        │
│   id: "1710..."  │───sessionId──→│                          │
│   messages: [...]│                │ ~/.mindos/sessions/      │
│   updatedAt      │                │   └─ <sessionId>/        │
│                  │                │       └─ *.jsonl          │
│ 权威源: 前端     │                │ 作用: compaction 缓存     │
│ 存储: sessions.json│              │ + extension lifecycle     │
└──────────────────┘                └──────────────────────────┘
```

### 请求时行为

| 场景 | 行为 |
|---|---|
| 有 sessionId + 已有 pi session | 复用已有 session（pi 负责 compaction） |
| 有 sessionId + 无 pi session | 创建新 session + 灌入前端历史（惰性迁移） |
| 无 sessionId | inMemory（一次性请求，如 Echo insight） |

### 清理

前端删除 session 时，`DELETE /api/ask-sessions` 同时清理 `~/.mindos/sessions/<sessionId>/` 目录。

## 五、资源发现

### Skills（纯 prompt 扩展）

扫描 4 个目录（按优先级，先到先得）：

| 优先级 | 目录 | 类型 | 可编辑 |
|---|---|---|---|
| 1 | `app/data/skills/` | MindOS 内置 | 否 |
| 2 | `skills/` | 项目级内置 | 否 |
| 3 | `{mindRoot}/.skills/` | 知识库用户自定义 | 是 |
| 4 | `~/.mindos/skills` | 全局用户自定义 | 是 |

用途：注入到 system prompt，增强 agent 的专业能力。设置页可启用/禁用每个 skill。

### Extensions（可执行代码扩展）

- **发现**：`DefaultResourceLoader` 扫描 `.pi/extensions/` 目录
- **能力**：注册工具（`registerTool`）、注册命令（`registerCommand`）、拦截生命周期事件
- **示例**：`.pi/extensions/current-time.ts` — 在每次 LLM 调用前注入当前时间
- **管理**：设置页可启用/禁用，显示 tools/commands 计数
- **持久化**：`~/.mindos/config.json` 的 `disabledExtensions` 字段

### MCP Tools（外部服务工具）

- **内置**：MindOS MCP server 始终可用（通过 `mcp/` 目录内置）
- **扩展**：额外 MCP servers 通过 `~/.mindos/mcp.json` 配置
- **接入方式**：
  - 静态桥接：`list_mcp_tools` / `call_mcp_tool`（通用入口）
- **容错**：MCP 不可用时静默跳过，不影响其他功能

## 六、System Prompt 结构

组装顺序（从上到下，越靠后优先级越高）：

| 段落 | 内容 | 来源 |
|---|---|---|
| AGENT_SYSTEM_PROMPT | 身份、7 条 Core Directives、Context Mechanics、Output 格式 | `app/lib/agent/prompt.ts` |
| Time Context | 当前 UTC / 本地时间 / Unix 时间戳 | 运行时生成 |
| Init Status | bootstrap 加载结果 | 运行时检测 |
| Init Context | SKILL.md + 用户规则 + INSTRUCTION.md + 首页 + config | 知识库文件 |
| Attached Files | 用户正在浏览的文件内容 | 前端传入 |
| Uploaded Files | 用户上传的附件内容 | 前端传入 |
| LANGUAGE LOCK | 动态检测用户语言并锁定回复语言 | 运行时检测 |

### 语言对齐机制

三层保障确保 Agent 用用户的语言回复：

1. Core Directive 第 7 条：静态规则，"You MUST reply in the same language"
2. Output 段落：静态强调，"CRITICAL: Reply in the SAME language"
3. LANGUAGE LOCK：运行时检测最后一条用户消息是否含中文，在 prompt 末尾追加明确的语言锁定指令

## 七、Agents 管理

MindOS 把自己注册为和其他 coding agent 同类的 agent：

```
MCP_AGENTS 注册表 (app/lib/mcp-agents.ts)
├─ claude-code    检测 ~/.claude/
├─ cursor         检测 ~/.cursor/
├─ windsurf       检测 ~/.codeium/windsurf/
├─ pi             检测 ~/.pi/
├─ mindos         检测 ~/.mindos/          ← MindOS 自己
├─ ...            (共 20+ 个 agent)
└─ codex          检测 ~/.codex/
```

在 Agents 页面 (`/agents`)，所有 agent 并列显示连接状态、MCP servers、安装的 skills。

## 八、SSE 流协议

POST /api/ask 返回 Server-Sent Events，自定义 6 种事件类型：

| 事件 | 格式 | 说明 |
|---|---|---|
| `text_delta` | `{ content: string }` | 文本增量 |
| `thinking_delta` | `{ content: string }` | Extended Thinking 增量 |
| `tool_start` | `{ name, args }` | 工具调用开始 |
| `tool_end` | `{ name, result }` | 工具调用结束 |
| `done` | `{ usage }` | 流结束 |
| `error` | `{ message, code }` | 错误 |

## 九、A2A & ACP 协作

### A2A Protocol (Agent-to-Agent)

MindOS 实现了 Google A2A 协议，使得不同 MindOS 实例（或任何 A2A 兼容 Agent）可以互相通信：

```
MindOS A ──── A2A JSON-RPC ────▶ MindOS B
  │                                   │
  ├─ discover_agent(url)              ├─ /.well-known/agent-card.json
  ├─ delegate_to_agent(task)          ├─ POST /api/a2a (SendMessage)
  └─ check_task_status(id)            └─ GET /api/a2a (GetTask)
```

**暴露的 KB 技能：** Search Knowledge Base, Read Note, Write Note, List Files, Organize Files

### ACP Protocol (Agent Client Protocol)

MindOS 集成了 ACP 协议，可作为客户端调用远程 ACP Agent：

- **注册表**：31+ 个 ACP Agent 可用（/api/acp/registry）
- **Session**：通过 subprocess 启动 ACP agent，管理生命周期
- **工具**：`list_acp_agents` 列举可用 Agent，`call_acp_agent` 调用指定 Agent

## 十、关键文件索引

| 文件 | 职责 |
|---|---|
| `app/app/api/ask/route.ts` | 核心入口：prompt 组装、session 创建、SSE 流 |
| `app/lib/agent/prompt.ts` | 静态 system prompt 模板 |
| `app/lib/agent/tools.ts` | 工具定义 + request-scoped 动态组装 |
| `app/lib/agent/to-agent-messages.ts` | 前端消息 → pi AgentMessage 转换 |
| `app/lib/agent/model.ts` | 模型配置（provider/key/model 选择） |
| `app/lib/agent/log.ts` | 工具操作日志 |
| `app/lib/pi-integration/skills.ts` | skill 扫描（app-builtin / project-builtin / mindos-user） |
| `app/lib/pi-integration/extensions.ts` | extension 发现 |
| `app/lib/pi-integration/mcporter.ts` | MCP 工具接口（当前 stub，预留 ~/.mindos/mcp.json 扩展） |
| `app/lib/pi-integration/session-store.ts` | session 路径管理 (~/.mindos/sessions/) |
| `app/lib/mcp-agents.ts` | agent 注册表（含 MindOS） |
| `app/lib/settings.ts` | 持久化配置（disabledSkills/Extensions） |
| `.pi/extensions/current-time.ts` | 示例 extension（pi 兼容） |
| `app/components/ask/AskContent.tsx` | 前端发消息入口 |
| `app/hooks/useAskSession.ts` | 前端 session 管理 |
| `app/components/settings/McpSkillsSection.tsx` | 设置页：skills + extensions + toggle |
| `app/lib/a2a/a2a-tools.ts` | A2A 工具定义（6 个） |
| `app/lib/a2a/agent-card.ts` | Agent Card 生成 |
| `app/lib/a2a/task-handler.ts` | A2A 任务处理 |
| `app/lib/acp/acp-tools.ts` | ACP 工具定义（2 个） |
| `app/lib/acp/session.ts` | ACP Session 管理 |
| `app/lib/acp/registry.ts` | ACP Agent 注册表 |
