# MindOS Agent 架构

> 最后更新: 2026-06-25
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
│  4. Runtime lane 解析：MindOS Pi / native runtime / ACP           │
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

## 四、Runtime Lifecycle Contract

Agent 兼容不只看协议适配或单个 capability boolean。`AgentRuntimeDescriptor.lifecycle` 是 runtime governance 的统一投影，描述每个 runtime 在以下阶段的归属与支持方式：

```
detect → health → configure → launch → session → context
       → execute → interrupt → archive → remote → coordinate
```

每个 stage 都标注：

| 字段 | 语义 |
|---|---|
| `support` | `owned` / `delegated` / `unsupported` / `unknown` |
| `owner` | 当前阶段由 `mindos` 还是 `external` runtime 持有 |
| `sources` | 这个判断来自 settings、native health、ACP detect、turn-runner、run-ledger 等哪一层 |
| `summary` | 给 Runtime Health / Compatibility Center / 调试 UI 展示的人类可读解释 |

当前归属原则：

| Runtime | Lifecycle 归属 |
|---|---|
| MindOS Pi | MindOS 拥有 configure / launch / session / context / execute；Pi `SessionManager` 拥有完整 history 与 compaction entry |
| Codex / Claude Code | MindOS 拥有 detect / health / prompt bridge；外部 runtime 拥有 model、auth、permission、session、compact、execute |
| ACP | MindOS 拥有 registry/detect 与 launch metadata；具体 adapter 拥有 auth、session、context window、execute |

`lifecycle.remote` 不等于“已经有 24/7 调度器”。它只回答 runtime 是否能在 MindOS server 所在主机运行，以及 unattended 能力是否完整。当前 native / ACP / MindOS Pi 都是 `server-runnable`，但 unattended 仍是 `limited`：还需要 scheduler、approval routing、wake/resume、missed trigger 和失败审计这些产品层能力。

`lifecycle.coordination` 是未来 Team Mode 的底层边界，不是当前 UI 承诺。现在只声明 runtime 是否能消费共享 MindOS context，以及是否已有 mailbox / task-board primitives。当前共享 context 已有，mailbox 与 task-board 还没有 first-class contract。

### Runtime Compatibility Profile

`AgentRuntimeDescriptor.compatibility` 是 lifecycle 的场景化投影：lifecycle 回答“哪个阶段由谁拥有”，compatibility 回答“这个 runtime 适不适合某类产品场景，以及还缺什么”。它同样是 core runtime descriptor 的一部分，由 `packages/mindos/src/agent/runtime/compatibility.ts` 生成，Web/API/Capability Registry 只消费结果，不重复推断。

当前 profile 覆盖这些场景：

| Scenario | 语义 |
|---|---|
| `interactive-turn` | 当前 runtime 是否适合一轮普通交互式对话/执行 |
| `coding-workflow` | 是否适合真实 coding agent 工作流，如 shell/file/git/diff/branch/PR |
| `session-continuity` | 是否有清晰的 resume/list/attach/archive 或等价 session 续跑能力 |
| `context-governance` | MindOS 与 runtime 如何分工 context 注入、history、compact、context-window |
| `permission-governance` | 权限请求由谁处理，能否被 MindOS 桥接和审计 |
| `mcp-tooling` | MCP/tool 配置是否可由 MindOS 投影到 runtime |
| `skill-execution` | Skill 能否被当前 runtime 正确加载/执行，以及是否已有机器可读 runtime requirements |
| `artifact-governance` | 产物、diff、branch、PR、artifact 是否能被 MindOS 统一索引和复查 |
| `remote-control` | 这个 runtime 是否能在 MindOS server host 上被远程手动控制 |
| `unattended-automation` | 是否适合 24/7 / scheduled / headless 自动化 |
| `team-coordination` | 是否具备 shared context、mailbox、task-board 等多 agent 协作 primitives |

每个 scenario 使用：

| 字段 | 语义 |
|---|---|
| `level` | `ready` / `limited` / `blocked` / `unknown` |
| `owner` | `mindos` / `external` / `shared` |
| `requirements` | 机器可读的已满足、外部拥有、缺失或未知前置条件 |
| `blockers` | 阻止该场景成为 ready 的关键缺口 |

当前几个刻意保守的结论：

- `remote-control` 与 `unattended-automation` 分开。Codex / Claude / ACP / MindOS Pi 可以是 `server-runnable`，但 24/7 仍是 `limited`，因为还缺 scheduler、approval routing、wake/resume、failure audit。
- `team-coordination` 现在最多是 `limited`。MindOS 已有 shared context，但还没有 first-class mailbox / task-board primitives，不应该在 UI 上承诺复杂 Team Mode。
- `skill-execution` 现在是 `limited`。MindOS 能注入/加载 skill，也能从 `SKILL.md` frontmatter 读取机器可读的 skill runtime requirements；但还没有 first-class matcher/enforcement，因此不能可靠自动判断某个 skill 应该跑在 Pi、Codex、Claude 还是 ACP。
- `mcp-tooling` 对 native runtime 是 `limited`。外部 runtime 可能有自己的 MCP 配置，但 MindOS 还没有“配置一次、按 runtime 投影”的统一 MCP projection contract。
- `artifact-governance` 现在是 `limited` 或 `blocked`。部分 runtime 能产出 diff/artifact/branch/PR，但 MindOS 还没有跨 runtime artifact index。

## 五、执行路径

`turn-runner.ts` 只做总控：完成 request/session/file context 解析后，通过 `turn-runtime-lane.ts` 选择 runtime lane，再把本轮 turn input 交给对应 lane。这样 MindOS Pi、Codex、Claude、ACP 在入口上并列，runtime/session/compact 语义仍由各 runtime 自己拥有。

| 路径 | 文件 | 说明 |
|---|---|---|
| Runtime lane facade | `packages/web/app/api/agent/_lib/turn-runtime-lane.ts` | 将已校验的 `selectedRuntime` / ACP 选择解析为 `native`、`acp`、`mindos-pi` lane |
| MindOS Pi lane | `packages/web/app/api/agent/_lib/turn-runner-mindos-pi.ts` | 创建 MindOS Pi runtime，注入 system/context prompt，注册 MindOS Pi tools/extensions |
| Native runtime lane | `packages/web/app/api/agent/_lib/turn-runner-external.ts` | Codex / Claude 的 prompt bridge、permission bridge、stream 转换、ledger 写入 |
| ACP runtime lane | `packages/web/app/api/agent/_lib/turn-runner-external.ts` | ACP session create/prompt stream/close、permission 映射、ledger 写入 |
| Shared request/context | `turn-request.ts` / `turn-context.ts` / `runtime-selection.ts` | 请求校验、上下文装载、runtime/binding 解析 |

为了避免 Next.js route 静态引入 Node-only pi runtime，各 lane 在执行时使用动态 import 加载具体 runner。

### Skill Runtime Requirements

Skill requirements 是 `skill-execution` compatibility 的第一层机器可读契约，来源于每个 `SKILL.md` 的 frontmatter，由 server handler 统一解析并投影到 `/api/skills` 与 `/api/skills/matrix`。缺少 requirements 的旧 skill 继续可用，但 `runtimeRequirements.declared=false`，且 remote / unattended / approval / user-input 状态都是 `unknown`，不能被 runtime matcher 当作“全 runtime 安全”。

当前支持的字段：

| Field | 语义 |
|---|---|
| `runtimeKinds` / `runtimes` | 可声明 `mindos`、`codex`、`claude`、`acp`、`native`、`any` |
| `requiredTools` / `tools` | 可声明 `shell`、`file`、`git`、`browser`、`mcp`、`plugins`、`skills` |
| `requiredCapabilities` / `capabilities` | 额外能力标签，如 `artifact-output`、`approval-routing` |
| `remoteSafe` | skill 是否适合远程手动控制场景 |
| `unattendedSafe` | skill 是否适合 24/7 / scheduled / headless 场景 |
| `requiresApprovals` | skill 是否需要人工或 runtime 权限审批 |
| `requiresUserInput` | skill 执行中是否需要用户输入 |
| `runtimeNotes` | 给 runtime matcher / UI / 审计看的简短说明 |

这层只解决“skill 需要什么”的 declaration，不等于已经有自动调度。runtime requirements 的共享类型位于 `packages/mindos/src/agent/runtime/skill-runtime-requirements.ts`，`SKILL.md` frontmatter 解析仍由 server handler 负责。

### Skill Runtime Matcher

Skill runtime matcher 是 `skill-execution` compatibility 的第二层诊断契约，位于 `packages/mindos/src/agent/runtime/skill-runtime-matcher.ts`，通过 `/api/skills/runtime-matches?scenario=<scenario>` 暴露。它把 skill requirements 与 `AgentRuntimeDescriptor` / `harnessCapabilities` 做匹配，输出：

- `level`: `ready` / `limited` / `blocked` / `unknown`
- `reasons`: runtime kind、runtime scenario readiness、required tools、known capabilities、approval/user-input、remote/unattended safety 的逐项解释
- `blockers`: 缺失的硬依赖，如 `runtime-kind`、`tool:git`、`capability:pr-output`、`remote-unsafe`、`user-input-required`

matcher 只回答“这个 skill 和这个 runtime 在某个 scenario 下是否匹配，以及为什么”。它不启动自动路由，也不替代 runtime 自己的权限、session、compact 或执行语义。

### Skill Runtime Enforcement

Skill runtime enforcement 是 `skill-execution` compatibility 的第三层 turn-runner gate，位于 `packages/web/app/api/agent/_lib/skill-runtime-enforcement.ts`。当用户显式选择 skill 时，`POST /api/agent/sessions/:sessionId/turns` 会在构造 prompt、启动 Pi / Codex / Claude / ACP runtime 之前：

1. 解析当前 runtime lane 的 `AgentRuntimeDescriptor`；
2. 从实际 skill roots 读取该 skill 的 runtime requirements；
3. 用 matcher 计算 `interactive-turn` 匹配结果；
4. 只在 `level=blocked` 时返回 `409 skill-runtime-blocked`，并带上 `runtimeId`、`runtimeKind`、`skillName`、`blockers` 与逐项 `reasons`。

这条 gate 只处理“明确不能跑”的硬不兼容。缺少 requirements 的旧 skill、`unknown`、`limited` 仍继续进入当前 runtime，避免破坏现有 skill 生态。当前 readiness blocker 因此前移到 `skill-runtime-routing`：MindOS 还不会自动帮用户切换到更合适的 runtime，也还没有在 turn 前把 `limited/unknown` 以 UI warning 的方式展示出来。

## 六、Prompt 与上下文

Prompt 分三层，分别处理稳定规则、Assistant 角色合同和每轮动态材料：

| 层 | 变化频率 | 来源 |
|---|---|---|
| System prompt | 稳定，创建 runtime/session 时使用 | `packages/mindos/src/agent/prompt/agent-prompt.txt` + `buildMindosSystemPrompt()` |
| Active Assistant overlay | 仅 Assistant run 或选中 Assistant 时注入 | `.mindos/assistants/<id>.md` / 内置 Assistant prompt + `packages/mindos/src/agent/prompt/assistant-prompt.ts` |
| Turn context prompt | 每轮动态计算，但按签名去重 | `buildMindosContextPrompt()` / `renderMindosContextPrompt()` |

`agent-prompt.txt` 是 MindOS 的 base prompt，不被 Assistant 替换。Assistant Markdown body 会被解析成 `## Active Assistant` overlay：它描述当前 Assistant 的 id/name/instructions/skills/MCP hints/permission 默认值，但不能覆盖 system、安全、permission 或 tool-use 规则。

不同 runtime 的注入位置不同：

| Runtime | Assistant 注入方式 |
|---|---|
| MindOS Pi | `buildMindosSystemPrompt({ activeAssistant })` 直接把 overlay 放入 system prompt |
| Codex / Claude Code / ACP | `prependMindosActiveAssistantPrompt()` 把 overlay 放在 external prompt 前面，由各自 adapter 再映射 runtime 能力 |

Assistant run 的目标、文件、上传内容、recall 和 session metadata 仍属于 Turn context，不复制 Assistant 的长期规则。

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

## 七、工具与权限

工具分 runtime 处理：

| Runtime | 工具来源 | 权限处理 |
|---|---|---|
| MindOS Pi | MindOS Pi registered tools/extensions：KB tools、subagent、ask-user-question、pi-web-access 等 | `createMindosAgentPermissionPolicy()` 根据 `permissionMode` 生成 Pi policy |
| Codex | Codex adapter / SDK / app-server | 由 Codex runtime adapter 映射并执行权限模型 |
| Claude Code | Claude CLI / SDK bridge | 由 Claude adapter 和 permission prompt bridge 处理 |
| ACP | ACP session tools | 由 ACP adapter 与 runtime binding 控制 |

工具 schema 本身不需要写进 system prompt。Pi runtime 通过注册的 `ToolDefinition` / extension registry 把工具交给模型；prompt 只保留必要的高层能力说明。

Assistant profile 中的 `skills` / `mcp` 只表达偏好和激活提示，不等于真实工具授权。真实可用工具始终来自当前 runtime registry；真实 skill 内容通过 `load_skill` 等 runtime tool 按需加载。

## 八、文件与附件

MindOS 区分两类文件：

| 类型 | 来源 | 处理方式 |
|---|---|---|
| Attached files from the MindOS knowledge base | `currentFile` / `attachedFiles` 指向已存在的 MindOS/base/workspace 文件 | 可稳定引用路径；按签名决定全文或轻量引用 |
| Files uploaded by the user for this request | 用户本轮上传的本地文件或图片 | 作为本轮输入传给 runtime；不默认写入知识库 |

图片与可传递文件会同时转换为 runtime attachment，让支持多模态/文件输入的 adapter 直接消费；不支持的 runtime 会退化为文本上下文或文件引用。

## 九、Session 与 Run Ledger

| 数据 | 权威源 |
|---|---|
| Chat session metadata | `agent-session-store` + `/api/agent/sessions` |
| Messages / running state / unread | `agent-run-store` |
| Runtime binding | `runtime_binding` SSE event → session store |
| Agent run timeline | run ledger |
| File/session context signatures | run metadata |

Run metadata 会记录 `sessionContextSignature`、`fileContextSignature`、是否注入全文、以及相关路径，供下一轮 turn 判断是否需要重复注入。

MindOS Pi 的 persisted session 由 Pi `SessionManager` 自己持有完整 JSONL history 与 compaction entry；common layer 只在新建/空 session 时 bootstrap 一次 UI history。恢复已有 Pi session 时，MindOS 可以读取 `buildSessionContext()` 计算 context usage / fallback payload，但不能把 common history 重新 append 进 Pi session，也不能用 run ledger 代存完整 transcript。Run ledger 只保留 run 索引、状态摘要和 runtime archive pointer（`sessionId` / `path`）。

## 十、关键文件索引

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
| `packages/web/app/api/agent/_lib/turn-runtime-lane.ts` | runtime lane facade，统一 MindOS Pi / native / ACP 入口 |
| `packages/web/app/api/agent/_lib/turn-runner-mindos-pi.ts` | MindOS Pi 执行路径 |
| `packages/web/app/api/agent/_lib/turn-runner-external.ts` | Codex / Claude / ACP 执行路径 |
| `packages/web/app/api/assistant-runs/route.ts` | Assistant run 入口，解析 Active Assistant 后委托 agent turn |
| `packages/mindos/src/agent/runtime/registry.ts` | Runtime descriptor / capability / lifecycle 类型源头 |
| `packages/mindos/src/agent/runtime/lifecycle.ts` | MindOS Pi / native / ACP lifecycle metadata builder |
| `packages/mindos/src/agent/runtime/compatibility.ts` | Runtime compatibility profile builder，投影 interactive / remote / unattended / skill / team 场景 readiness |
| `packages/mindos/src/agent/runtime/descriptors.ts` | Runtime descriptor 组装，统一暴露 capability / harness / lifecycle |
| `packages/mindos/src/agent/prompt/agent-prompt.txt` | MindOS 默认 base prompt |
| `packages/mindos/src/agent/prompt/assistant-prompt.ts` | Active Assistant overlay 解析与渲染 |
| `packages/mindos/src/agent/prompt/context-prompt.ts` | context prompt 渲染 |
| `packages/mindos/src/agent/turn/index.ts` | turn 输入、上传文件、外部 runtime prompt bridge |
| `packages/mindos/src/agent/mindos-pi/**` | MindOS Pi extensions / permissions / runtime config |
