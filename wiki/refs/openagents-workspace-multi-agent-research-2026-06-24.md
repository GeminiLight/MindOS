# OpenAgents Workspace 多 Agent Channel / Context 机制调研

> 日期：2026-06-24
> 调研对象：`openagents-org/openagents`
> 源码快照：`develop @ b116bd8623468fd944b56e040c4aac08ebdd3d17`
> 调研问题：OpenAgents 如何让多个 AI agent 在同一个 channel 中对话、共享 context / 文件 / 浏览器 / 任务状态，并对 MindOS 的 agent 架构有什么启发。
> 证据口径：实现细节以 OpenAgents 源码为主证据；产品定位以 README 为辅助证据；MindOS 对照以本仓库 `wiki/25-agent-architecture.md` 和既有协议调研文档为基准。

## 0. 结论摘要

OpenAgents 的核心不是“把多个 agent 的上下文全部塞进同一个大 prompt”，而是把协作拆成三层：

1. **共享事件空间**：`Workspace` 是长期 hub，`Channel` 是 thread/session，`EventRecord` 是所有消息和系统事件的统一日志。所有 agent 和人类都围绕同一条 channel event stream 工作。
2. **执行目标路由**：channel 里可以有多个参与者，但每条消息会被后端写入 `metadata.target_agents`。adapter 拉取事件时只处理明确 target 到自己的消息。也就是说，“谁能看到”与“谁应该响应”是两个不同概念。
3. **对象化 context**：历史消息、共享文件、共享浏览器、知识库、todos、timers、routines、notifications 都是 workspace 资源或事件投影，而不是每一轮都复制到 prompt 里的纯文本。

对 MindOS 最有价值的启发是：我们不必先复制 OpenAgents 的 hosted workspace，也不必一开始实现完整 agent-to-agent 协议。更合理的短期方向是把现有 `session/run/runtimeBinding/context prompt` 模型演进成：

```text
Agent Session / Thread
  + participants: runtime/assistant/human membership
  + event/run ledger: durable turn/event stream
  + targetRuntimeIds / routingDecision: who should respond
  + shared artifacts: files, recall refs, browser state, todos, outputs
  + runtimeContinuation: per runtime per thread binding
```

这比“多 agent = 多个 runtime 一起吃同一个 prompt”更稳，也更符合 MindOS 现有 local-first、context-first 的产品定位。

## 1. OpenAgents 想解决的问题

OpenAgents 在 README 中把问题定义为：用户的 agents 分散在不同终端、机器和任务中，没有统一入口，也无法自然协作。它给出的解决方案是 “unified workspace” 和 “easy collaboration”，让 agent 被拉入同一 conversation thread，并共享 files、browser 和 context。证据见 `README.md:49-58`。

README 进一步把 workspace 类比为 “Slack, but for agents”：一个持久 hub，agent 共享 threads、files、browser，人类始终有一个 URL 可以回到现场。证据见 `README.md:68-83`。这不是传统 chat app 的“群聊”概念，而是把远程 agent runtime、工作文件、浏览器会话、任务队列都聚合到一个协作控制面。

这点对 MindOS 的启发是：多 agent 协作的用户价值不只是“两个模型互相说话”，而是减少人在多个 agent 窗口之间复制上下文、转述进度、搬运文件和验证结果的成本。对 MindOS 来说，这个价值可以被表述为：把真实 context 变成可委派、可审计、可继承的行动边界，而不是只做一个消息转发器。

## 2. 总体架构地图

OpenAgents 的 workspace 架构可以概括为：

```text
Human UI / Launcher / Agent Adapter
              |
              v
        Workspace API
              |
              v
+----------------------------------------------+
| Workspace                                    |
|  - WorkspaceMember: agent roster/session     |
|  - Channel: conversation thread              |
|  - ChannelMember: per-thread participants    |
|  - EventRecord: unified event log            |
|  - FileRecord: shared files                  |
|  - BrowserTab/BrowserContext: shared browser |
|  - Todo/Timer/Routine/Notification records   |
+----------------------------------------------+
              |
              v
   adapters poll targeted events
              |
              v
 Claude / Codex / Goose / Aider / other runtimes
```

关键数据模型：

| 概念 | OpenAgents 实现 | 作用 |
|---|---|---|
| Event log | `EventRecord` 保存 `network_id/type/source/target/payload/metadata/timestamp/visibility` | 所有交互都落成事件，channel 消息只是事件的一种 |
| Workspace | `Workspace` | 长期 hub/network，承载成员、channels、设置 |
| Workspace member | `WorkspaceMember` | agent roster，记录 role、type、host、working_dir、status、session_id |
| Channel | `Channel` | named event stream，包含 title、created_by、master_agent、resume_from、status |
| Channel member | `ChannelMember` | 每个 thread 的 agent 参与者列表 |
| Shared files | `FileRecord` | workspace 文件，可绑定 channel context |
| Shared browser | `BrowserTab` / `BrowserContext` | workspace 可见 browser tab 和持久浏览器上下文 |
| Planning state | `TodoRecord` / `TimerRecord` / routines | agent 进度、唤醒和 recurring tasks |

核心证据：

- `workspace/backend/app/models.py:46-68`：`EventRecord` 是统一事件表。
- `workspace/backend/app/models.py:76-118`：`Workspace` 与 `WorkspaceMember`，后者包含 agent 的状态和 session revocation 机制。
- `workspace/backend/app/models.py:125-166`：`Channel` 与 `ChannelMember` 把 session/thread 和参与者建模为数据库实体。
- `workspace/backend/app/models.py:261-278`：共享文件元数据。
- `workspace/backend/app/models.py:285-304`：共享浏览器 tab。
- `workspace/backend/app/models.py:404-444`：todos 与 timers。

## 3. 一条人类消息的完整流转

OpenAgents 的多 agent channel 不是靠前端直接叫某个 agent，而是通过事件和路由元数据流转。

```text
1. Human sends message in channel
2. Frontend uploads attachments, posts workspace.message.posted
3. Backend resolves channel, known agents, mentions, participants
4. Backend decides target_agents
5. Event is persisted with metadata.target_agents
6. Agent adapters poll pending events
7. Adapter filters out events not targeting itself
8. Adapter invokes its runtime with per-channel continuation
9. Agent output is posted back as workspace.message.posted
10. Backend may route agent output to another agent, or stop
```

对应实现：

- 前端 `workspaceApi.sendMessage(...)` 会把消息和附件发往当前 `sessionId/channel`，并可带 mentions 与 attachments。证据见 `workspace/frontend/components/chat/chat-view.tsx:367-431`。
- API client 通过 `workspace.message.posted` 事件表达消息，`target` 是 `channel/<channelName>`。证据见 `packages/agent-connector/src/workspace-client.js:157-176`。
- 后端只对 `human:` 和 `openagents:` source 做路由；`thinking/status/todos` 这类中间消息不会触发其他 agent。证据见 `workspace/backend/app/mods/workspace_mod.py:916-954`。
- 路由结果总是写入 `event.metadata["target_agents"]`。没有人应该响应时写入 `["__no_response__"]` sentinel，避免老 client 把空数组误判为广播。证据见 `workspace/backend/app/mods/workspace_mod.py:975-984`。
- agent client 拉取事件后按 `target_agents` 过滤，跳过自己的消息；human 消息若没有 `target_agents` 才按 legacy broadcast 兼容。证据见 `packages/agent-connector/src/workspace-client.js:291-333`。

### 关键设计判断

这条链路最重要的是：**channel 是共享可见性，target_agents 是执行触发权**。这能避免两种常见失败：

- 每个 agent 看到同一条人类消息后都抢答。
- agent 的中间状态、todo 更新、思考流触发其他 agent，形成循环。

这对 MindOS 非常重要。MindOS 当前 canonical endpoint 是 `POST /api/agent/sessions/:sessionId/turns`，request body 里有 `selectedRuntime` 和 `runtimeBinding`，但还没有把“一个 session 有多个 runtime 参与者”和“本轮 target 哪些 runtime”显式建模。现有架构见 `wiki/25-agent-architecture.md:7-33`、`wiki/25-agent-architecture.md:35-68`。

## 4. 多 agent 路由机制

OpenAgents 的路由分两类：单 agent channel 的确定性 fallback，以及多 agent channel 的可选 LLM router。

### 4.1 确定性 fallback

`_fallback_targets()` 的优先级是：

1. 显式 `@mention`。
2. channel 的 `master_agent`。
3. 没有 master 时选择第一个 participant。

如果 agent 自己就是 master，它自己的消息不会再触发自己。证据见 `workspace/backend/app/mods/workspace_mod.py:503-519`。

### 4.2 LLM router

当 channel 中真实参与者数量不少于 2 时，后端优先使用 LLM router。router prompt 的职责是判断下一轮应该由谁响应，或者是否 stop。它会输入：

- channel participants。
- master agent。
- 最近消息历史。
- latest message source/content。
- 明确规则：人类消息必须选一个 agent；agent 消息如果是最终答复或确认则 stop；不要 self-loop。

证据见 `workspace/backend/app/mods/workspace_mod.py:522-582`、`workspace/backend/app/mods/workspace_mod.py:626-797`。

值得注意的 guardrail：

- LLM router 只看最近 5 条 `workspace.message.posted`，并跳过 `thinking/status`。证据见 `workspace/backend/app/mods/workspace_mod.py:639-668`。
- router 返回未知 agent 时，agent 消息直接 stop，人类消息则 fallback，保证用户不会被静默丢弃。证据见 `workspace/backend/app/mods/workspace_mod.py:746-784`。
- agent 消息如果 router 选回自己，会被拒绝，避免 self-loop。证据见 `workspace/backend/app/mods/workspace_mod.py:759-766`。

### 4.3 自动加入参与者

后端会把人类消息 target 到的 agent 自动加入 channel participants，但只在人类消息上做：

- 不加入 `__no_response__` sentinel。
- agent-to-agent routing 不会把旁观 agent 自动拖入 thread。
- routine channel 不自动加其他人。

证据见 `workspace/backend/app/mods/workspace_mod.py:986-1016`。

### 4.4 风险判断

这个设计比“所有 agent 自由决定是否回复”更可控，但也有风险：

- LLM router 是隐藏决策，如果 UI 不展示理由，用户会不理解为什么某个 agent 被唤醒。
- fallback 只取第一个 mention 或 master，会牺牲并行多 target 的能力。
- router prompt 以单 agent `next:<agent>` 为主，不适合需要真正并行分工的任务，除非上层做 explicit task decomposition。
- `__no_response__` 是兼容性补丁，说明 routing metadata 一旦进入协议，就需要稳定 schema 和版本治理。

对 MindOS 的建议：短期先做 deterministic router。优先规则应该是显式选择 / `@runtime` / 当前 active runtime / assistant ownership / last responder，而不是立即引入 LLM router。LLM router 可以作为多参与者时的可选“建议”，但必须写入 run ledger 并在 UI 上可审计。

## 5. Context 共享不是 prompt 拼接，而是对象化资源

OpenAgents 让多个 agent “共享 context”主要靠对象化资源和按需工具，而不是每次给所有 agent 复制完整上下文。

### 5.1 Message history

事件日志是最基础的 context。adapter 可以拉当前 channel 或指定 channel 的历史。`workspace_get_history` 是 MCP tool；无 MCP 的 agent 也会被注入 curl 说明访问 `/v1/events`。证据见：

- `packages/agent-connector/src/workspace-client.js:203-241`
- `packages/agent-connector/src/mcp-server.js:28-43`
- `packages/agent-connector/src/adapters/workspace-prompt.js:274-280`

### 5.2 Shared files

文件不是作为消息纯文本永久贴在 prompt 里，而是上传到 workspace file storage，再由消息 attachment 引用。证据：

- 数据模型：`workspace/backend/app/models.py:261-278`
- 前端上传：`workspace/frontend/components/chat/chat-view.tsx:409-431`
- MCP tool：`packages/agent-connector/src/mcp-server.js:57-100`
- REST/curl prompt：`packages/agent-connector/src/adapters/workspace-prompt.js:160-185`

### 5.3 Shared browser

共享浏览器是一等资源。OpenAgents 给 agent 暴露打开 tab、导航、点击、输入、截图、accessibility snapshot、persistent contexts 等能力。证据：

- 数据模型：`workspace/backend/app/models.py:285-304`
- client API：`packages/agent-connector/src/workspace-client.js:527-604`
- MCP tool：`packages/agent-connector/src/mcp-server.js:103-199`
- prompt 中强调 browser 是 workspace 共享资源，而不是 agent 本地 browser。证据见 `packages/agent-connector/src/adapters/workspace-prompt.js:35-55`。

### 5.4 Todos / timers / routines / notifications

OpenAgents 把“进度”和“未来唤醒”也对象化：

- todos 是 channel 里的 agent task state，可 assignee 到其他 agent。
- timers 是延迟唤醒。
- routines 是 recurring scheduled task，并且每个 routine 有自己的 dedicated thread。
- notifications 进入 workspace inbox，不混在普通 chat stream。

证据：

- 数据模型：`workspace/backend/app/models.py:404-444`
- client API：`packages/agent-connector/src/workspace-client.js:608-625`
- MCP tools：`packages/agent-connector/src/mcp-server.js:238-385`
- prompt 说明：`packages/agent-connector/src/adapters/workspace-prompt.js:295-386`

### 5.5 Knowledge base

OpenAgents 的 workspace knowledge 是全局 markdown 文档，可被所有 agent 读取，并支持 `@knowledge:slug`。证据见 `packages/agent-connector/src/mcp-server.js:388-433` 和 `packages/agent-connector/src/adapters/workspace-prompt.js:389-412`。

这点与 MindOS 的天然优势重叠：MindOS 已经以本地 Markdown KB、active recall、file context signatures 和 MCP 为核心，不需要复制 OpenAgents 的轻量 knowledge store。更重要的是把 MindOS 现有 KB 从“被单个 runtime 检索的背景资料”，升级成“多个 runtime 的共享 artifact registry / context source”。

## 6. Adapter 策略：统一 workspace API，保留 runtime 差异

OpenAgents 的 agent connector 没有强迫所有 agent runtime 实现同一种内部协议，而是用 adapter 层做桥接。

### 6.1 BaseAdapter 的公共职责

`BaseAdapter` 抽象出：

- join workspace 与 heartbeat。
- event cursor、去重、poll loop。
- control event polling。
- per-channel queue。
- status/thinking/response/todos/error posting。
- session revocation。

证据见 `packages/agent-connector/src/adapters/base.js:1-13`、`packages/agent-connector/src/adapters/base.js:515-670`、`packages/agent-connector/src/adapters/base.js:698-826`。

其中 per-channel queue 很关键：同一个 channel 串行，避免同一 thread 内 prompt/runtime 状态交叉；不同 channel 可并行。证据见 `packages/agent-connector/src/adapters/base.js:608-670`。

### 6.2 Claude adapter

Claude adapter 的特点：

- 用 Claude CLI `stream-json` 子进程执行。
- 为每个 channel 保存 Claude CLI `session_id`。
- 支持 MCP mode 和 skills/curl mode 两套 workspace tool 注入。
- 动态拼接 workspace system prompt，并在已有 session 时 `--resume`。

证据见：

- `packages/agent-connector/src/adapters/claude.js:1-8`
- `packages/agent-connector/src/adapters/claude.js:32-49`
- `packages/agent-connector/src/adapters/claude.js:394-441`
- `packages/agent-connector/src/adapters/claude.js:490-595`

### 6.3 Codex adapter

Codex adapter 的特点：

- 使用 Codex CLI `exec --json`，或 OpenAI-compatible direct API fallback。
- per-channel 保存 Codex thread id。
- 解析 JSON events，把 agent_message、command_execution、file_change 转成 workspace thinking/status。
- stale thread 会清除 binding 并重试 fresh run。

证据见：

- `packages/agent-connector/src/adapters/codex.js:1-10`
- `packages/agent-connector/src/adapters/codex.js:42-49`
- `packages/agent-connector/src/adapters/codex.js:281-338`
- `packages/agent-connector/src/adapters/codex.js:367-414`

### 6.4 Goose adapter

Goose adapter 的特点：

- 每个 `(workspace, agent, channel)` 映射到稳定 session name。
- 用 `goose run --output-format stream-json --name ... --resume`。
- headless 模式自动运行工具。
- 带 inactivity watchdog，避免 channel 被 hung run 卡住。

证据见：

- `packages/agent-connector/src/adapters/goose.js:1-23`
- `packages/agent-connector/src/adapters/goose.js:84-90`
- `packages/agent-connector/src/adapters/goose.js:393-413`
- `packages/agent-connector/src/adapters/goose.js:444-545`
- README 对 Goose session isolation 的说明：`README.md:297-327`

### 6.5 Aider adapter

Aider adapter 的特点：

- 使用非交互 scripting mode。
- per-channel chat history 与 input history 存在 `~/.openagents/sessions/aider`。
- 关闭 auto-commits 和 dirty commits，保护用户工作区。
- Aider 无 JSON event protocol，所以以文本流和最终输出适配。

证据见：

- `packages/agent-connector/src/adapters/aider.js:1-31`
- `packages/agent-connector/src/adapters/aider.js:295-335`
- `packages/agent-connector/src/adapters/aider.js:450-485`
- README 对 Aider per-channel chat history 与 git 行为的说明：`README.md:217-228`

### 6.6 对 MindOS 的直接启发

MindOS 已经有 `selectedRuntime` 和 `runtimeBinding` 的分层：前者表达本轮选择，后者是外部 runtime session/thread 的唯一续跑来源。证据见 `wiki/25-agent-architecture.md:59-68`。OpenAgents 证明这层可以继续扩展：

```text
runtimeBinding currently:
  sessionId -> one selected runtime continuation

future runtimeContinuations:
  session/channel id
    -> runtimeId: codex
       threadId: ...
    -> runtimeId: claude
       sessionId: ...
    -> runtimeId: mindos-pi
       run state: ...
```

也就是说，一个 MindOS session 可以有多个 runtime continuation，但每次 turn 明确 target 哪些 runtime。共享 context 留在 session/channel ledger 和 artifact registry，不塞进某个 runtime 私有 session。

## 7. 前端交互模型

OpenAgents 的前端不是只提供一个聊天框，而是让用户显式管理 thread participants。

关键入口：

- 创建 thread 时选择 online agents、lead/master、可选 resumeFrom。证据见 `workspace/frontend/components/threads/new-thread-dialog.tsx:24-119`。
- API client 用 `network.channel.create` 事件创建 channel，并写入 master、participants、resume_from。证据见 `workspace/frontend/lib/api.ts:187-220`。
- thread 内可以 add/remove participant。证据见 `workspace/frontend/lib/api.ts:222-240` 和 `workspace/frontend/components/chat/chat-view.tsx:639-704`。
- 输入框提供 agent 与 knowledge 的 @mention suggestions。证据见 `workspace/frontend/components/chat/chat-input.tsx:70-96`。
- message optimistic UI 里存在 `targetAgents` 字段，说明 routing 结果是 message model 的一部分。证据见 `workspace/frontend/components/chat/chat-view.tsx:375-399`。

对 MindOS 的 UI 启发：

1. Chat session header/composer 需要能显示当前 participants，而不只是一个 selected runtime。
2. `@runtime` 或 `@assistant` mention 应该是“路由请求”，不应该只是文本。
3. UI 要区分 lead/master、participants、last responder、currently running。
4. target routing 最好可视化，例如“本轮发送给 Codex / Claude / MindOS Pi”，否则多 agent 行为会显得像黑箱。

## 8. 与 MindOS 当前架构的对照

MindOS 当前 agent 架构的核心是 canonical turn endpoint：

```text
Web UI
  ChatContent.tsx -> useAgentChat
  agent-session-store: session metadata + runtime binding
  agent-run-store: per-session messages/runs/unread

POST /api/agent/sessions/:sessionId/turns
  strict request validation
  runtime selection + runtimeBinding validation
  turn context prompt assembly
  MindOS Pi / native runtime / ACP dispatch
  SSE stream + run ledger writes
```

证据见 `wiki/25-agent-architecture.md:7-33`。

当前 request body 包含 `messages/currentFile/attachedFiles/uploadedFiles/selectedRuntime/runtimeBinding/agentMode/permissionMode`。证据见 `wiki/25-agent-architecture.md:16-18` 和 `wiki/25-agent-architecture.md:35-58`。

当前 context 机制已经比较成熟：

- prompt 分为 system prompt、Active Assistant overlay、Turn context prompt。证据见 `wiki/25-agent-architecture.md:81-100`。
- Turn context 包含时间、session context、attached files、uploaded files、active recall、initialization context。证据见 `wiki/25-agent-architecture.md:102-110`。
- 文件上下文按签名去重，避免每轮重复注入全文。证据见 `wiki/25-agent-architecture.md:111-130`。
- run ledger 记录 session/file context signatures 与注入状态。证据见 `wiki/25-agent-architecture.md:158-168`。
- 工具真实授权来自 runtime registry，而不是 prompt 文本。证据见 `wiki/25-agent-architecture.md:132-145`。

这说明 MindOS 不缺单 agent turn/context 机制。短板在于：session 还没有显式 participants 和 routing metadata，shared artifacts 还没有被抽象成可被多个 runtime 共同消费的 channel-level context bus。

## 9. MindOS 可借鉴的架构原则

### 9.1 把 Session 升级为 Channel/Thread，而不是只扩展 selectedRuntime

目前 MindOS 的 `selectedRuntime` 表达“本轮选谁”。多 agent 后，如果继续把它扩成数组，会很快混淆：

- 哪些 runtime 是这个 session 的长期参与者？
- 哪些 runtime 只是本轮 target？
- 哪个 runtime 拥有当前 continuation？
- 哪些输出是可见消息，哪些是内部状态？

建议新增或显式化：

```ts
type AgentParticipant = {
  id: string;
  kind: "runtime" | "assistant" | "human";
  runtimeId?: string;
  assistantId?: string;
  role: "lead" | "member" | "observer";
  status: "online" | "offline" | "running" | "paused";
};

type RoutingDecision = {
  targetRuntimeIds: string[];
  targetAssistantIds?: string[];
  reason: "explicit" | "mention" | "last_responder" | "lead" | "router" | "none";
  decidedBy: "ui" | "server" | "llm-router";
};
```

先把这些元数据写进 run ledger，不必马上改变所有 UI。

### 9.2 把 run ledger 变成 event-like projection

OpenAgents 的 `EventRecord` 很干净：每件事都是事件，状态表只是 projection。MindOS 已有 run ledger，不一定需要复制完整 event sourcing，但可以吸收这几个字段：

```text
event/run:
  id
  sessionId/channelId
  type: user_message | runtime_status | runtime_response | tool_result | artifact_added | routing_decision
  source: human:<id> | runtime:<runtimeId> | assistant:<id> | system:<module>
  visibility: user | channel | internal
  payload
  metadata:
    targetRuntimeIds
    contextSignature
    artifactRefs
    routingTrace
```

这样后续 UI 可以从 ledger 投影出：

- message list。
- running state。
- participants activity。
- context/artifact timeline。
- routing/debug trace。

### 9.3 分离“共享上下文”和“runtime 私有上下文”

OpenAgents 的 adapter 会保存 per-channel Claude session、Codex thread、Goose session、Aider history，但 channel event stream 独立存在。这个分层对 MindOS 很关键：

- 共享上下文：session/channel ledger、MindOS files、uploaded artifacts、active recall refs、todos、decision records。
- 私有上下文：Codex thread id、Claude session id、MindOS Pi internal state、ACP session。

当某个 runtime continuation 坏掉时，不应该丢掉共享 channel；应该能基于 channel ledger 和 artifact refs 重建 prompt，或者换另一个 runtime 接手。

### 9.4 用 target metadata 控制唤醒，避免广播式混乱

建议 MindOS 多 runtime turn 的第一版就强制写 `targetRuntimeIds`。即使是单 runtime，也写明确目标，避免未来兼容问题。

OpenAgents 用 `["__no_response__"]` 解决旧客户端空数组广播问题。MindOS 可以在一开始设计更清晰：

```ts
type RoutingDecision =
  | { kind: "targets"; targetRuntimeIds: string[] }
  | { kind: "none"; reason: string };
```

不要让空数组承担“没有目标”“广播”“尚未计算”三种语义。

### 9.5 Router 应先 deterministic，再可选 LLM

MindOS 的 context-first 产品气质更适合可解释规则：

1. 用户显式选择 runtime 或 participants。
2. 消息中 `@codex` / `@claude` / `@assistant`。
3. 如果用户回复的是某个 runtime 刚问的问题，延续 last responder。
4. 默认 lead runtime。
5. 只有 participants >= 2 且规则无法判断时，才调用 optional router。

LLM router 的输出必须落 ledger：

```text
routingTrace:
  candidates
  chosenTargets
  reasonSummary
  model
  promptVersion
```

这样用户和开发者能复盘“为什么这次叫醒了 Claude 而不是 Codex”。

### 9.6 Shared artifacts 要成为 context bus 的核心

MindOS 已经有更强的本地知识库和 file context signatures。建议围绕 session/channel 增加 artifact refs：

| Artifact | MindOS 现有基础 | 建议 |
|---|---|---|
| Mind files | `currentFile/attachedFiles`、file signatures | 升级为 channel artifact refs，支持多个 runtime 共享 |
| Uploaded files | 本轮输入 | 可选择保存为 session artifact，不默认进 KB |
| Active recall | turn context prompt | 保存召回 refs 与使用情况，供后续 runtime 接力 |
| Browser state | pi-web-access / browser bridge 方向 | 抽象为 shared browser session/ref，而不是 runtime 私有工具状态 |
| Todos | 目前主要是 agent 内部进度 | 做成 channel-level task projection，可分配给 runtime/assistant |
| Decisions/SOP | MindOS KB 强项 | 从对话中沉淀为可继承规则，而不是只做 chat memory |

这和既有 MindOS 策略一致：核心不是卖“Agency”口号，而是把真实 context 转成行动边界、判断规则和可继承 SOP。

## 10. 不建议直接复制的地方

### 10.1 不必复制 polling-heavy 架构

OpenAgents agent connector 使用 polling、adaptive delay、cursor、dedup。这适合远程 daemon + hosted API。MindOS Web 当前已经有 canonical turn endpoint、SSE stream 和 run ledger，不应为了模仿而退回 polling。OpenAgents 的关键启发是 event/routing model，而不是 transport。

### 10.2 不应把 token/curl 大段注入作为默认工具机制

OpenAgents 为非 MCP agent 注入 REST/curl instructions，并把 `X-Workspace-Token` 写进 prompt 片段。这个设计兼容性强，但对 MindOS 来说风险更高。MindOS 已经明确“工具真实授权来自 runtime registry，而不是 prompt 文本”，见 `wiki/25-agent-architecture.md:132-145`。因此 MindOS 应优先走 tool registry / MCP / extension registry，而不是让模型通过 prompt 记住 token 和 curl。

### 10.3 不要把 LLM router 做成不可见魔法

OpenAgents 的 LLM router 实用，但如果隐藏在后端，用户很难理解 agent 为什么被唤醒。MindOS 要做多 agent，更应该强调可审计：routing decision、reason、target、override 都应该进入 UI 和 ledger。

### 10.4 不要先做完整云 workspace

OpenAgents 的 hosted workspace、邀请链接、browserbase/live URL 等很适合跨设备和远程 agent。MindOS 的基本盘是 local-first KB、plain text、MCP、桌面/本地控制。短期更适合做 local channel/context bus，把多 runtime 协作嵌入现有 session，而不是先变成 SaaS workspace。

### 10.5 不要把所有 agent-to-agent 都升级为协议实现

既有协议调研已经指出：MCP 负责工具/知识，ACP/A2A 负责 agent-to-agent 互操作，长期应关注 A2A 方向，见 `wiki/refs/agent-communication-protocol-survey.md:21-48`。OpenAgents 这类 workspace event bus 可以作为产品内协作机制，不必等同于外部 A2A 协议。

## 11. 建议路线图

### Phase 0：写一份 MindOS Agent Channel / Context Bus spec

目标：把概念边界定清楚，不先动大代码。

建议 spec 包含：

- session/channel 的定义。
- participants 与 roles。
- routing decision schema。
- run ledger event type。
- runtimeContinuation map。
- artifact refs。
- UI 最小闭环。
- 不做范围：不做 hosted workspace、不做复杂 LLM router、不做完整 A2A。

验收标准：

- 能解释单 runtime、双 runtime、assistant + runtime 三种 case。
- 能解释 target none、single target、future multi target。
- 能解释 runtime continuation 丢失后的恢复路径。
- 能说明与现有 `selectedRuntime/runtimeBinding` 的迁移关系。

### Phase 1：Ledger metadata first

在不改 UI 主流程的前提下，先让每个 run 记录：

- `participantSnapshot`。
- `targetRuntimeIds`。
- `routingDecision`。
- `routingReason`。
- `contextArtifactRefs`。

收益：低风险地给未来 UI 和调试积累数据。

### Phase 2：Thread participants UI

在 Chat header 或 composer row 增加：

- 当前 runtime/assistant participants。
- lead runtime。
- add/remove runtime。
- `@runtime` autocomplete。
- 本轮 target preview。

这一步可以参考 OpenAgents 的 new thread dialog 和 manage agents dropdown，但视觉上应遵守 MindOS 的 warm / restrained / content-first 设计原则。

### Phase 3：Shared artifact registry

把 session 内文件、上传物、recall refs、browser refs、todo refs 统一成 channel artifacts。

关键原则：

- 上传文件默认是 session artifact，不默认写入 KB。
- MindOS KB 文件是 stable reference。
- active recall 不只塞进 prompt，还记录“这轮用了哪些 recall refs”。
- runtime 输出的大文件、报告、截图应优先变成 artifact，而不是长消息。

### Phase 4：Deterministic router

先实现可解释 router：

```text
explicit target > @mention > reply-to/last responder > lead runtime > none/error
```

只在这个规则无法判断、且用户开启“智能路由”时，才引入 LLM router。

### Phase 5：Observability and governance

多 agent 一旦进入产品，最难的不是调起多个模型，而是解释和治理：

- 谁被唤醒了。
- 为什么被唤醒。
- 用了哪些 context。
- 哪些文件被读取/修改。
- 哪个 runtime 产生了最终结果。
- 哪些规则应沉淀为 SOP。

这和 MindOS 的 context-to-agency 方向高度一致。多 agent 不是表演更多 agent，而是让用户能稳定委派、检查、纠偏、沉淀。

## 12. 一个更贴近 MindOS 的目标架构草案

```text
MindOS Agent Channel
  |
  +-- participants
  |     +-- human:user
  |     +-- runtime:mindos-pi
  |     +-- runtime:codex
  |     +-- assistant:researcher
  |
  +-- ledger
  |     +-- user_message
  |     +-- routing_decision
  |     +-- runtime_status
  |     +-- runtime_response
  |     +-- artifact_added
  |     +-- context_recall_used
  |
  +-- context bus
  |     +-- mind_files
  |     +-- uploaded_files
  |     +-- recall_refs
  |     +-- browser_refs
  |     +-- todos
  |     +-- decisions/SOP candidates
  |
  +-- runtime continuations
        +-- mindos-pi: internal session/run state
        +-- codex: thread_id
        +-- claude: session_id
        +-- acp/a2a: external conversation id
```

### 最小可行用户体验

用户不需要理解上述模型。界面上只需要看到：

1. 这个 thread 里有哪些 agent/runtime。
2. 当前准备把消息发给谁。
3. 可以 `@` 另一个 agent 让它接手。
4. 每个 agent 的状态和输出归属清晰。
5. 共享文件、引用、浏览器、todo 都在同一 thread 里可见。

## 13. 证据地图

| 结论 | 证据 | 质量 | 备注 |
|---|---|---|---|
| OpenAgents 的主抽象是 workspace + channel + event | `workspace/backend/app/models.py:46-166` | 高 | 源码数据模型 |
| 每条消息用 `workspace.message.posted` 表示，target 是 channel | `packages/agent-connector/src/workspace-client.js:157-176` | 高 | adapter client |
| 多 agent 响应由 `metadata.target_agents` 控制 | `workspace/backend/app/mods/workspace_mod.py:975-984`、`packages/agent-connector/src/workspace-client.js:291-333` | 高 | 后端写入，client 过滤 |
| 中间消息不触发其他 agent | `workspace/backend/app/mods/workspace_mod.py:916-919` | 高 | 避免循环 |
| 多参与者 channel 使用 LLM router，可 fallback | `workspace/backend/app/mods/workspace_mod.py:959-973` | 高 | 路由流程 |
| 人类消息不会被 router 静默 drop | `workspace/backend/app/mods/workspace_mod.py:771-784` | 高 | safety net |
| 自动加入 targeted agents 只发生在人类消息 | `workspace/backend/app/mods/workspace_mod.py:986-1016` | 高 | 防止 agent-to-agent 拖入旁观者 |
| OpenAgents 通过 MCP tools 暴露 workspace history/files/browser/todos/knowledge | `packages/agent-connector/src/mcp-server.js:23-435` | 高 | 工具定义 |
| 无 MCP agent 通过 prompt 中 REST/curl instructions 访问 workspace | `packages/agent-connector/src/adapters/workspace-prompt.js:118-423` | 高 | prompt builder |
| adapter 保留 per-channel continuation | Claude: `claude.js:32-49`; Codex: `codex.js:42-49`; Goose: `goose.js:84-90`; Aider: `aider.js:19-24` | 高 | runtime-specific |
| frontend 支持创建 thread participants、add/remove、@mention | `workspace/frontend/lib/api.ts:187-240`、`chat-input.tsx:70-96`、`chat-view.tsx:639-704` | 高 | UI/API |
| MindOS 当前是 single selected runtime + runtimeBinding 的 turn 架构 | `wiki/25-agent-architecture.md:35-68` | 高 | 本仓库架构文档 |
| MindOS 当前 context prompt 和 file signature 已有较强基础 | `wiki/25-agent-architecture.md:81-130` | 高 | 本仓库架构文档 |

## 14. 仍需确认的问题

1. OpenAgents 的 LLM router 是否在生产中足够稳定，是否有 trace UI 或评估集？本次源码看到 routing guardrails，但未看到完整评测。
2. OpenAgents 的 event log 是否支持长期压缩、摘要、归档与权限分层？目前模型能说明事件存储，但长期 context budget 策略需要继续查。
3. Shared browser 的 backend 实现、Browserbase 依赖与安全边界，本次只查到数据模型/API/tool 层，未深入验证运行时隔离。
4. MindOS 多 runtime 的第一版是否要支持真正并行 multi target，还是只支持 one next responder？建议第一版只做 one target，schema 保留数组。
5. MindOS 的 participants 应该绑定 runtime instance、assistant profile，还是二者组合？这需要结合现有 Assistant 与 runtime selection 设计再写 spec。

## 15. 推荐下一步

建议新建 `wiki/specs/spec-agent-channel-context-bus.md`，把这篇调研收敛成 MindOS 内部设计 spec。第一版不动大架构，只做 schema 和 ledger 增量：

- `participants`。
- `targetRuntimeIds` / `routingDecision`。
- `runtimeContinuations` map。
- `contextArtifactRefs`。
- `routingTrace`。

这会给之后的 UI 与多 runtime execution 留出清晰接口，同时不破坏当前 canonical turn endpoint。
