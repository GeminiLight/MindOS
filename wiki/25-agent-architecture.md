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

- `remote-control` 与 `unattended-automation` 分开。Codex / Claude / ACP / MindOS Pi 可以是 `server-runnable`，但 24/7 仍是 `limited`，因为还缺 scheduler、approval routing、wake/resume、failure audit。MindOS 已有只读 automation runtime projection contract，把“可远程手动控制”和“可无人值守自动化”拆成两个 readiness 字段。
- `team-coordination` 现在最多是 `limited`。MindOS 已有 shared context，但还没有 first-class mailbox / task-board primitives，不应该在 UI 上承诺复杂 Team Mode。
- `permission-governance` 已有只读 permission runtime projection contract。它能解释 Pi 的 `read/ask/auto/full` policy、native runtime 的交互式 permission bridge、ACP adapter 的未知审批契约；但 durable approval queue 还没有实现，所以 native bridge 不能等同 24/7 可用。
- `skill-execution` 现在是 `limited`。MindOS 能注入/加载 skill，读取 `SKILL.md` runtime requirements，提供 skill × runtime matcher，并在明确 `blocked` 时阻止显式选中的不兼容 skill；但还没有自动 runtime routing，也不会把 `limited/unknown` 在 turn 前变成 UI warning。
- `mcp-tooling` 对 native runtime 仍是 `limited`。MindOS 已有只读 MCP runtime projection contract，可以解释每个 runtime 当前是 `ready` / `projectable` / `limited` / `blocked` / `unknown`；但不会自动改写 Codex / Claude / ACP adapter 的外部 MCP 配置。
- `artifact-governance` 现在是 `limited` / `blocked` / `unknown`。MindOS 已有只读 artifact runtime projection contract，可以解释 runtime 的 text/diff/checkpoint/artifact/branch/PR 输出形态；但 MindOS 还没有跨 runtime artifact index，所以不能把“runtime 会产出”说成“MindOS 已统一治理”。

### Runtime Readiness Aggregation

Runtime readiness aggregation 是 Runtime Doctor / Compatibility Center 的只读聚合契约，位于 `packages/mindos/src/server/handlers/runtime-readiness.ts`，通过 `/api/agent-runtimes/readiness?permissionMode=<read|ask|auto|full>` 暴露。它把 `AgentRuntimeDescriptor.compatibility` 与四个细分 projection 合并成每个 runtime 的用例级 readiness：

| 用例 | 来源 |
|---|---|
| `interactive-turn` / `coding-workflow` / `session-continuity` / `context-governance` / `skill-execution` / `team-coordination` | runtime compatibility profile |
| `permission-governance` | permission runtime projection |
| `mcp-tooling` | MCP runtime projection |
| `artifact-governance` | artifact runtime projection |
| `remote-control` / `unattended-automation` | automation runtime projection |

aggregation 输出：

| 字段 | 语义 |
|---|---|
| `overallStatus` | `ready` / `usable` / `limited` / `blocked` / `unknown`；只用于总览，不替代用例级判断 |
| `recommendations` | 当前 runtime 适合强推荐或条件推荐的用例，例如交互式 coding、MCP tooling、remote manual control |
| `useCases` | 每个场景的 `status`、`source`、`sourceStatus`、requirements、blockers 和少量安全的 details |
| `gaps` | 去重后的缺口清单，按 `mindos-product` / `runtime-native` / `adapter-contract` / `deployment` / `user-setup` / `shared` 分类 |
| `blockers` | 只列 truly blocking 的缺口，例如 runtime 不可用；`limited` 的产品缺口仍留在 `gaps` 中 |

这层有三个硬边界：

- **不做自动路由**：它解释 runtime 适合什么，不替用户切 runtime，也不在 turn 前自动改写选择。
- **不触发副作用**：它不启动 runtime、不同步 MCP、不创建 scheduler、不写 artifact index，只聚合现有只读诊断。
- **不把单点能力说成产品 ready**：Codex / Claude 的 native permission bridge 仍只是 `interactive-only`；server-runnable 仍不等于 24/7；reviewable output 仍不等于 MindOS artifact governance ready。

### Automation Runtime Projection

Automation runtime projection 是 `remote-control` 和 `unattended-automation` compatibility 的只读诊断契约，位于 `packages/mindos/src/server/handlers/runtime-automation-projections.ts`，通过 `/api/agent-runtimes/automation-projections` 暴露。它不启动后台任务，也不创建 scheduler；只解释 runtime 当前是否能被远程手动控制，以及距离 24/7 / scheduled / headless 自动化还缺什么。

projection 输出：

| 字段 | 语义 |
|---|---|
| `status` | `ready` / `remote-only` / `limited` / `blocked` / `unknown`；当前通常是 `limited`，因为 24/7 前置条件未齐 |
| `remoteControl` | runtime 是否可在 MindOS server host 上被远程手动控制；包含 `mode`（如 `server-runnable`）和 remote blockers |
| `unattendedAutomation` | runtime 是否适合 24/7 / scheduled / headless；明确区分 technical runnable 与 product-ready automation |
| `productPrerequisites` | 当前统一列出 `scheduler`、`approval-routing`、`wake-resume`、`failure-audit` 四个产品层前置条件 |
| `reasons` / `blockers` | runtime availability、server-runnable、remote control surface、unattended automation 及各前置条件的逐项判断 |

当前结论：

- MindOS Pi / Codex / Claude / ACP 可以是 `server-runnable`，但这只证明 remote/manual control 的底层可能性。
- 24/7 readiness 需要 durable scheduler、无人值守审批路由、wake/resume/missed trigger reconciliation、failure audit；缺一项就不能在 UI 上承诺 fully unattended。
- Native runtime 的 permission bridge 是交互式能力，不自动升级成后台任务审批；automation projection 会继续把它标成 `limited`，直到 durable approval queue 落地。
- Generic ACP 需要 adapter-specific health / permission / artifact contract 才能进一步从 `limited` 或 `unknown` 提升。

### Permission Runtime Projection

Permission runtime projection 是 `permission-governance` compatibility 的只读诊断契约，位于 `packages/mindos/src/server/handlers/runtime-permission-projections.ts`，通过 `/api/agent-runtimes/permission-projections?permissionMode=<read|ask|auto|full>` 暴露。它只解释当前 runtime 在某个 MindOS permission mode 下的权限治理状态，不直接批准、拒绝或重放任何运行时请求。

projection 输出：

| 字段 | 语义 |
|---|---|
| `status` | `ready` / `interactive-only` / `limited` / `blocked` / `unknown` |
| `harnessPermissionModel` | runtime harness 当前声明的权限模型：`mindos-only` / `runtime-bridged` / `none` / `unknown` |
| `interactiveApproval` | 交互式场景中权限由 Pi policy、native bridge、external runtime 还是 adapter 自己处理 |
| `unattendedApproval` | 只从 permission 角度判断是否适合 headless / scheduled；scheduler、wake/resume、failure audit 仍属于 `unattended-automation` 场景 |
| `policy` / `policyModes` | MindOS Pi 的 `read/ask/auto/full` policy 摘要：KB 写入范围、terminal/MCP/IM/schedule/user-extension/delegation 是否开启 |
| `reasons` / `blockers` | runtime availability、permission owner、bridge、durable approval queue、adapter approval contract 等逐项判断 |

当前结论：

- MindOS Pi 的 `read` mode 从 permission 角度可无人值守，因为没有写入、terminal、MCP、IM、schedule 或 user-extension scope；但真正 24/7 仍需要 scheduler / wake-resume / failure audit。
- MindOS Pi 的 `ask` mode 是交互安全默认值，不等于 durable approval queue；后台任务如果需要保留“问用户”的语义，还需要持久审批队列。
- Codex / Claude 的 permission bridge 是 `interactive-only`：MindOS 能把 native permission prompt 变成产品流事件，但 pending 状态在 active run 的进程内，不能当作 headless / resumed run 的 durable approval。
- Generic ACP 仍是 `unknown`：ACP adapter 必须声明自己的 approval contract，MindOS 才能可靠路由或预授权。

### MCP Runtime Projection

MCP runtime projection 是 `mcp-tooling` compatibility 的只读诊断契约，位于 `packages/mindos/src/server/handlers/mcp-runtime-projections.ts`，通过 `/api/agent-runtimes/mcp-projections` 暴露。它把三类现有信息合在一起：

1. `AgentRuntimeDescriptor`：runtime identity、kind、status、capabilities、`mcpAgentKey`；
2. MCP agent profile：来自 `/api/mcp/agents` 的每个 agent 配置路径、已检测 server 名称与来源；
3. canonical MindOS MCP config：`~/.mindos/mcp.json` 中的 server 名称，以及 MindOS Agent runtime allowlist。

projection 输出：

| 字段 | 语义 |
|---|---|
| `status` | `ready` / `projectable` / `limited` / `blocked` / `unknown` |
| `configuredServers` | 当前 runtime 自己的 MCP 配置中已检测到的 server 名称 |
| `mindosConfigServers` | canonical MindOS MCP config 中的 server 名称 |
| `projectedServers` | 当前 runtime 实际可投影的 server 名称；MindOS Pi 只包含显式 allowlist，native runtime 等同其已检测配置 |
| `reasons` / `blockers` | runtime availability、MCP profile、MindOS config、allowlist/native config 等逐项判断 |

这层有两个硬边界：

- **不泄露 secrets**：只暴露 server 名称、来源和状态，不返回 command、args、env、headers、token。
- **不自动写配置**：`projectable` 只表示 MindOS 有足够信息提示用户去 install/copy/sync，不代表当前 runtime 已可用；外部 runtime 的 MCP config 仍由显式 `/api/mcp/install`、`/api/mcp/copy-server` 或用户自己的配置动作修改。

### Artifact Runtime Projection

Artifact runtime projection 是 `artifact-governance` compatibility 的只读诊断契约，位于 `packages/mindos/src/server/handlers/runtime-artifact-projections.ts`，通过 `/api/agent-runtimes/artifact-projections` 暴露。它把 runtime descriptor 中的 `harnessCapabilities.output` 投影成产品可解释的产物治理状态，不创建、不修改、不索引真实 artifact。

projection 输出：

| 字段 | 语义 |
|---|---|
| `status` | `ready` / `limited` / `blocked` / `unknown`；当前通常不会是 `ready`，因为统一 artifact index 尚未实现 |
| `outputKinds` | runtime 声明可产出的原始输出形态：`text` / `diff` / `checkpoint` / `artifact` / `branch` / `pr` |
| `reviewableOutputKinds` | 可复查或可交付的输出子集：`diff` / `checkpoint` / `artifact` / `branch` / `pr` |
| `nativeHandoffTargets` | 面向 UI / Runtime Doctor 的交付目标：message、diff、checkpoint、artifact、branch、pull-request |
| `nativeReview` | runtime 是否声明了可复查输出；Codex / Claude 通常是有，generic ACP 需要 adapter 声明 |
| `artifactIndex` | MindOS 是否已经具备统一 cross-runtime artifact index；当前为 `missing` |
| `rollback` | runtime 是否声明 checkpoint 输出，可作为未来 Compare / Restore / rollback 的锚点 |
| `branchPr` | runtime 是否能交付 branch 或 PR reference |
| `reasons` / `blockers` | runtime availability、output contract、artifact projection contract、artifact index、checkpoint、branch/PR 等逐项判断 |

当前结论：

- MindOS Pi 有 text/artifact 输出，所以 artifact projection 是 `limited`：能说明产物形态，但缺统一 artifact index。
- Codex / Claude 能声明 diff/artifact/branch/PR 等 native coding output，所以适合 Runtime Doctor 展示“可复查输出”，但仍不能跳过 MindOS artifact index。
- Generic ACP 默认是 `unknown`：ACP 只证明 text/tool-event streaming，不证明 adapter 能交付 diff、branch、PR 或 checkpoint。
- Artifact projection 的边界是诊断和路由，不代替真实 artifact 存储；下一步如果要从 `limited` 走向 `ready`，需要实现 cross-runtime artifact index、source/run binding、review/rollback metadata。

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
| `packages/mindos/src/server/handlers/runtime-permission-projections.ts` | Permission runtime projection contract，统一解释每个 runtime 的交互式审批与 unattended permission readiness |
| `packages/mindos/src/server/handlers/mcp-runtime-projections.ts` | MCP runtime projection contract，统一解释每个 runtime 的 MCP ready/projectable/limited/blocked/unknown |
| `packages/mindos/src/server/handlers/runtime-artifact-projections.ts` | Artifact runtime projection contract，统一解释每个 runtime 的 output/handoff/artifact-index readiness |
| `packages/mindos/src/server/handlers/runtime-automation-projections.ts` | Automation runtime projection contract，统一解释 remote-control 与 24/7 unattended readiness |
| `packages/mindos/src/server/handlers/runtime-readiness.ts` | Runtime Doctor 聚合契约，把 compatibility profile 与 permission/MCP/artifact/automation projection 合并成用例级 readiness / gaps / recommendations |
| `packages/mindos/src/agent/prompt/agent-prompt.txt` | MindOS 默认 base prompt |
| `packages/mindos/src/agent/prompt/assistant-prompt.ts` | Active Assistant overlay 解析与渲染 |
| `packages/mindos/src/agent/prompt/context-prompt.ts` | context prompt 渲染 |
| `packages/mindos/src/agent/turn/index.ts` | turn 输入、上传文件、外部 runtime prompt bridge |
| `packages/mindos/src/agent/mindos-pi/**` | MindOS Pi extensions / permissions / runtime config |
