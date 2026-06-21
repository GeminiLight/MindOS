# MindOS Agent 架构

> 最后更新: 2026-06-21
>
> 当前 canonical turn endpoint 是 `POST /api/agent/sessions/:sessionId/turns`。历史文档中的 `/api/ask` 只代表旧实现或历史记录，不能作为新代码入口。

## 一、系统分层

```
┌─────────────────────────────────────────────────────────────────┐
│                         Web UI                                  │
│  ChatContent.tsx → useAgentChat                                 │
│       ├─ agent-session-store: session metadata + runtime binding │
│       └─ agent-run-store: per-session messages/runs/unread       │
│                                                                 │
│  Request body:                                                   │
│  { messages, currentFile, attachedFiles, uploadedFiles,          │
│    selectedRuntime, runtimeBinding, agentMode, permissionMode }  │
└────────────────────────────┬────────────────────────────────────┘
                             │ POST /api/agent/sessions/:sessionId/turns
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js API Route Layer                       │
│  packages/web/app/api/agent/sessions/[sessionId]/turns/route.ts  │
│  packages/web/app/api/agent/_lib/turn-runner.ts                  │
│                                                                 │
│  1. Strict request contract validation                           │
│  2. Runtime selection + runtimeBinding validation                 │
│  3. Turn context prompt assembly                                 │
│  4. MindOS Pi / native runtime / ACP 分发                         │
│  5. SSE stream + run ledger 写入                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 二、请求契约

Turn request 使用严格契约。旧字段不再迁移、不再推断语义，直接返回 `400 Unknown field: ...`。

| 字段 | 当前语义 |
|---|---|
| `messages` | 前端会话消息 |
| `currentFile` / `attachedFiles` | MindOS 知识库或本地 workspace 中的已存在文件 |
| `uploadedFiles` | 用户本轮上传的文件内容，不默认存在于 MindOS 知识库 |
| `selectedRuntime` | 本轮选择的 runtime identity，只表达 `mindos` / `codex` / `claude` / `acp` 等身份 |
| `runtimeBinding` | 外部 runtime session/thread 的唯一续跑来源 |
| `agentMode` | turn 行为模式，当前默认 `default`，为未来 `plan` / `goal` 保留 |
| `permissionMode` | 本轮权限模式：`read` / `ask` / `auto` / `full` |

以下字段是明确非法字段：

| 非法字段 | 原因 |
|---|---|
| `mode` | 旧 ask/chat/agent 混合语义已移除 |
| `options.permissionMode` | 旧兼容层已移除 |
| `runtimeOptions.permissionMode` | 权限是 turn 顶层字段 |
| `runtimeOptions.agentMode` | agent mode 是 turn 顶层字段 |
| `selectedRuntime.externalSessionId` | 外部 session 只能由 `runtimeBinding` 表达 |

## 三、Runtime 选择与绑定

`selectedRuntime` 和 `runtimeBinding` 是两个不同层次：

- `selectedRuntime`：用户本轮选择哪个 runtime，只用于展示和路由。
- `runtimeBinding`：已有 Codex thread / Claude session / ACP session 的续跑绑定。
- 后端会先校验 `runtimeBinding.runtime` / `runtimeBinding.runtimeId` 是否匹配 `selectedRuntime`。
- `runtime_binding` SSE event 是写入 binding 的唯一来源。
- UI 展示“当前选择 Codex/Claude/MindOS”时看 `selectedRuntime`；展示“已连接到 Codex thread xxx”时看 `runtimeBinding`。

## 四、执行路径

`turn-runner.ts` 只做总控，具体执行路径拆到独立模块：

| 路径 | 文件 | 说明 |
|---|---|---|
| MindOS Pi | `packages/web/app/api/agent/_lib/turn-runner-mindos-pi.ts` | 创建 MindOS Pi runtime，注入 system/context prompt，注册 MindOS Pi tools/extensions |
| External runtime | `packages/web/app/api/agent/_lib/turn-runner-external.ts` | Codex / Claude / ACP 的 prompt bridge、stream 转换、ledger 写入 |
| Shared request/context | `turn-request.ts` / `turn-context.ts` / `runtime-selection.ts` | 请求校验、上下文装载、runtime/binding 解析 |

为了避免 Next.js route 静态引入 Node-only pi runtime，`turn-runner.ts` 使用动态 import 加载执行路径。

## 五、Prompt 与上下文

Prompt 分两层：

| 层 | 变化频率 | 来源 |
|---|---|---|
| System prompt | 稳定，创建 runtime/session 时使用 | `packages/mindos/src/agent/prompt/agent-prompt.txt` + `buildMindosSystemPrompt()` |
| Turn context prompt | 每轮动态计算，但按签名去重 | `buildMindosContextPrompt()` / `renderMindosContextPrompt()` |

Turn context 包括：

- 当前时间：每轮精简注入。
- Session Context：仅当 workDir / selected spaces / assistants / warnings 签名变化时注入。
- Attached MindOS files：文件选择或内容变化时注入全文；未变化时只注入轻量引用。
- Uploaded files：用户本轮上传的文件内容，按本轮请求处理。
- Active recall：按用户消息召回相关知识片段。
- Initialization context：MindOS Pi 初始化失败、截断或规则加载结果。

### MindOS 文件上下文去重

`currentFile` / `attachedFiles` 会先被本地读取并生成签名：

```
fileContextSignature = JSON.stringify({
  files: [{ label, path, hash, size }],
  failed: [...]
})
```

如果当前 session 最近一次 run 的 `fileContextSignature` 相同，本轮 prompt 不再重复文件全文，只渲染：

```
These selected MindOS files are unchanged since the last turn, so their full content is not repeated.
- Current: ...
- Attached: ...
```

这意味着：用户一直停在同一个文件上时，模型不会每轮重复收到全文；如果文件内容、文件列表或读取失败状态变化，则重新注入全文。

## 六、工具与权限

工具分 runtime 处理：

| Runtime | 工具来源 | 权限处理 |
|---|---|---|
| MindOS Pi | MindOS Pi registered tools/extensions：KB tools、subagent、ask-user-question、pi-web-access 等 | `createMindosAgentPermissionPolicy()` 根据 `permissionMode` 生成 Pi policy |
| Codex | Codex adapter / SDK / app-server | 由 Codex runtime adapter 映射并执行权限模型 |
| Claude Code | Claude CLI / SDK bridge | 由 Claude adapter 和 permission prompt bridge 处理 |
| ACP | ACP session tools | 由 ACP adapter 与 runtime binding 控制 |

工具 schema 本身不需要写进 system prompt。Pi runtime 通过注册的 `ToolDefinition` / extension registry 把工具交给模型；prompt 只保留必要的高层能力说明。

## 七、文件与附件

MindOS 区分两类文件：

| 类型 | 来源 | 处理方式 |
|---|---|---|
| Attached files from the MindOS knowledge base | `currentFile` / `attachedFiles` 指向已存在的 MindOS/base/workspace 文件 | 可稳定引用路径；按签名决定全文或轻量引用 |
| Files uploaded by the user for this request | 用户本轮上传的本地文件或图片 | 作为本轮输入传给 runtime；不默认写入知识库 |

图片与可传递文件会同时转换为 runtime attachment，让支持多模态/文件输入的 adapter 直接消费；不支持的 runtime 会退化为文本上下文或文件引用。

## 八、Session 与 Run Ledger

| 数据 | 权威源 |
|---|---|
| Chat session metadata | `agent-session-store` + `/api/agent/sessions` |
| Messages / running state / unread | `agent-run-store` |
| Runtime binding | `runtime_binding` SSE event → session store |
| Agent run timeline | run ledger |
| File/session context signatures | run metadata |

Run metadata 会记录 `sessionContextSignature`、`fileContextSignature`、是否注入全文、以及相关路径，供下一轮 turn 判断是否需要重复注入。

## 九、关键文件索引

| 文件 | 职责 |
|---|---|
| `packages/web/components/chat/ChatContent.tsx` | 前端 Chat/Agent 入口 |
| `packages/web/hooks/useAgentChat.ts` | 发起 turn、消费 SSE、写入 run/session store |
| `packages/web/lib/agent-session-store.ts` | session metadata + runtime binding |
| `packages/web/lib/agent-run-store.ts` | messages/runs/unread/persist timers |
| `packages/web/app/api/agent/sessions/[sessionId]/turns/route.ts` | canonical turn endpoint |
| `packages/web/app/api/agent/_lib/turn-request.ts` | strict request contract |
| `packages/web/app/api/agent/_lib/runtime-selection.ts` | selectedRuntime / runtimeBinding 解析与校验 |
| `packages/web/app/api/agent/_lib/turn-context.ts` | session/file context 签名与去重 |
| `packages/web/app/api/agent/_lib/turn-runner.ts` | turn 总控 |
| `packages/web/app/api/agent/_lib/turn-runner-mindos-pi.ts` | MindOS Pi 执行路径 |
| `packages/web/app/api/agent/_lib/turn-runner-external.ts` | Codex / Claude / ACP 执行路径 |
| `packages/mindos/src/agent/prompt/agent-prompt.txt` | MindOS 默认 base prompt |
| `packages/mindos/src/agent/prompt/context-prompt.ts` | context prompt 渲染 |
| `packages/mindos/src/agent/turn/index.ts` | turn 输入、上传文件、外部 runtime prompt bridge |
| `packages/mindos/src/agent/mindos-pi/**` | MindOS Pi extensions / permissions / runtime config |
