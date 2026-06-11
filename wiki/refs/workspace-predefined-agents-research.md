# Workspace 内置 / 预定义 Agents 与 Assistants 调研

> Last verified: 2026-06-11
> Scope: 官方文档可验证的 IDE / CLI、workspace agent platform、workflow agent builder、以及知识型 assistant/profile 产品。
> Related: `wiki/specs/spec-local-assistant-library.md`, `wiki/specs/spec-space-kit-agent-employment.md`, `wiki/discussions/discussion-agent-command-center-and-routines.md`

## 调研范围与总数

本次有效纳入 **16 个产品 / 平台**。其中最接近 MindOS 当前问题的是 Claude Code、VS Code / Copilot、OpenCode、Cursor、Windsurf / Devin 这一类 **本地文件 / repo 原生配置**；Dust、Glean、Rovo、Copilot Studio、Dify、Lindy 代表 **workspace 云端 agent registry / agent builder**；LangGraph / LangSmith 代表 **Assistant 作为 runtime config profile**；Claude Projects、Gemini Gems、OpenAI GPTs 代表 **用户可复用的 persona / 知识 assistant**。

未把 n8n 计入主表。n8n 的 AI Agent Node 是 workflow 节点模式，对 trigger / execution history 有启发，但它不是“workspace 里预置多个可选 agent/profile”的产品形态。

## 一句话结论

业界已经基本收敛成四层概念：

1. **Instruction substrate**：repo / workspace / user 级的持久指令，例如 `AGENTS.md`、`.cursor/rules`、`.github/instructions`。
2. **Named profile**：可被用户选择、@ 调用或自动委派的命名 Agent / Assistant / Gem / GPT。
3. **Tools / knowledge / permissions**：工具、知识源、上下文、权限和审批不应该藏在 prompt 里，而应该显式建模。
4. **Run / execution runtime**：真正执行任务的是 runtime / graph / workflow / external agent，profile 只是配置、路由和约束。

这和 MindOS 已经明确的产品语义一致：**Agent 是运行体，Assistant 是本地 profile / persona / routing descriptor**。因此 MindOS 不应该把 Assistant 继续做成前端 mock preset，也不应该把 Codex、Claude Code、MindOS Agent 这类运行体混成 Assistant；正确方向是让 Assistant 从 `.mindos/assistants/<assistant-id>/` 动态加载，并把 UI 做成这个本地 registry 的浏览、编辑、运行入口。

## 对比矩阵

| 产品 | 官方概念名 | 作用域 | 定义载体 | 选择 / 触发 | Tools / Knowledge | 权限 / 共享 / 版本 | 对 MindOS 的启发 |
|---|---|---|---|---|---|---|---|
| Claude Code | subagents | user / project | Markdown + YAML frontmatter，个人目录 `~/.claude/agents/`，项目目录 | `/agents` 管理，可自动委派或显式调用 | tools、model、permissions、skills、hooks、memory 等字段 | user / project 分层 | file-backed Assistant 是合理默认；frontmatter + Markdown prompt 足够透明 |
| Cursor | Rules / AGENTS.md | project / user / team | `.cursor/rules/*.mdc`、`AGENTS.md` | 自动按规则和路径应用 | 主要是 instructions，不是完整 agent object | user / project / team 分层 | MindOS 可兼容 instruction substrate，但 Assistant 要比 rules 更结构化 |
| VS Code / GitHub Copilot | custom agents / prompt files / instructions | workspace / user | `.agent.md`、`.prompt.md`、`.github/instructions`、`AGENTS.md` | Chat 里选择 agent / prompt | agent 可定义 tools、model、handoffs | workspace 与 user profile；instructions 可随 repo | `.agent.md` 证明 profile 可以是文件对象，不必藏 DB |
| GitHub Copilot repository instructions | repository instructions / AGENTS.md | repo | `.github/copilot-instructions.md`、`.github/instructions/*.instructions.md`、`AGENTS.md` | Copilot coding agent / chat 自动读取 | 主要是 repo 指令 | nearest `AGENTS.md` 优先 | MindOS 可读取 workspace 指令作为 Assistant context，但不能替代 Assistant registry |
| Windsurf / Devin | Memories / Rules / Workflows / Skills | global / workspace / system | `.devin/rules/`、`.windsurf/rules/`、`.windsurf/workflows/`、`AGENTS.md` | rules 自动应用，workflow 用 slash command 调用 | memories、rules、skills、workflow 分开 | global/workspace/system 分层 | 不要把记忆、规则、工作流、assistant profile 混成一种对象 |
| OpenCode | agents | global / project | `opencode.json` 或 Markdown agent files，`~/.config/opencode/agents/`、`.opencode/agents/` | 切换 primary agent，或 `@` 调用 subagent | prompt、model、temperature、mode、permission | config merge / built-in + custom | MindOS 应支持 built-in template + local override，但最终落成本地文件 |
| Dust | Agents | workspace / personal access | workspace agent objects | agent library 搜索、筛选、使用 | Spaces、Tools、MCP servers、credentials | default/editable filters；restricted spaces；tool approval risk levels | 资源权限和工具风险要显式；Assistant 不能越权读取用户没权限的数据 |
| Glean | Agents | team / workspace | Agent Builder steps | agent library 发现、启动、管理 | steps、actions、connectors、enterprise data | 依赖企业权限模型 | 适合借鉴“可复用 workflow step”，但 MindOS 初版不做复杂 builder |
| Atlassian Rovo | Rovo agents | personal / team / org | Chat / Studio 创建的 agent object | Chat / Studio 创建，agent search / favorites | instructions、knowledge、tools | 可分享给自己、团队、组织；共享不提升数据权限 | 共享 Assistant 只能复用配置，不能扩大访问权 |
| Microsoft Copilot Studio | agents | org / channel | graphical low-code agent | triggers、topics、channels | instructions、knowledge、topics、tools、connectors | per-user auth 决定可见数据 | MindOS 的 Channel 是交付面，Assistant 是配置，runtime 才执行 |
| Claude Projects | Projects | project workspace | project instructions + knowledge | 项目内 chat | project knowledge base | Team / Enterprise sharing: use / edit | 是 workspace context，不是多 assistant registry；可作为 MindOS Space 的类比 |
| Gemini Gems | Gems | user | Gem name + instructions + optional files | 选择 Gem 对话 | uploaded files / Google Drive knowledge | 用户级复用 | 对普通用户易懂：Assistant 需要名字、用途、知识，而不是技术字段优先 |
| OpenAI GPTs | GPTs | user / workspace depending plan | name、instructions、knowledge、capabilities、actions | GPT picker / share link | knowledge files、capabilities、actions | 可分享 / 发布；配置型 persona | 证明非开发者也能理解 profile；但 MindOS 应保持本地文件透明性 |
| Dify | Agent app | workspace | app config / prompt / variables / tools | Web app / API | knowledge、Dify tools、external APIs | app version / prompt history / workspace | prompt 版本和 rollback 对 Assistant 编辑很重要 |
| LangGraph / LangSmith | Assistants | deployment / graph | assistant config over graph | API / UI create/list/update/version | prompts、LLM selection、tools config | versioned assistant config history | 最贴合 MindOS：Assistant 是运行体之上的可版本化配置 |
| Lindy | custom agent / workflow | workspace / account | workflow graph with triggers/actions | trigger-based 或 chat-based | integrations、actions、account connections | workflow ownership / connected accounts | Schedule 是 trigger + run template，不应和 Assistant profile 混在一起 |

## 产品详解

### 1. Claude Code

Claude Code 把可复用专项能力称为 **subagents**。官方文档说明，用户可以创建 task-specific subagents，并通过 `/agents` 管理；subagent 使用 Markdown 文件和 YAML frontmatter 定义，个人级保存到 `~/.claude/agents/`，也支持项目级。文档还把 description、system prompt、tools、model、permissions、skills、hooks、memory 等作为 subagent 配置字段的一部分。

用户流上，Claude Code 同时支持自动委派和显式调用。也就是说，profile 不只是展示卡片，而是会影响任务路由和工具可用性。

对 MindOS 的启发：

- `.mindos/assistants/<id>/prompt.md` 是合理的本地 source of truth。
- `profile.json` 应只承载跨场景稳定的 profile metadata，例如 `preferredAgent`、`skills`、`mcp`；页面入口、权限模式和输出策略留给 Runtime Context / Run input / Schedule。
- Assistant 可以被 UI 显式选择，也可以作为路由建议，但运行仍交给 Agent runtime。

Source: [Claude Code subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)

### 2. Cursor

Cursor 的核心不是命名 agent registry，而是 **persistent instructions**：Project Rules、User Rules、Team Rules，以及 repo 内的 `AGENTS.md`。Project Rules 位于 `.cursor/rules`，规则文件使用 `.mdc` 格式，可以带 metadata；`AGENTS.md` 是纯 Markdown 替代方案。Cursor 还支持子目录里的 `AGENTS.md`，更靠近文件的规则优先。

这类设计说明：用户和团队会接受“文件即配置”的工作流，但 rules 和 Assistant 的边界不同。Rules 更像背景指令；Assistant 更像可选择、可运行、可解释的 profile。

对 MindOS 的启发：

- MindOS 应保留对 repo / space 指令文件的读取能力。
- 但 Assistant 不应该退化成一堆 loose rules；它至少要有 `name`、`description`、`preferredAgent`、`skills`、`mcp` 等结构化字段。

Source: [Cursor Rules](https://cursor.com/docs/rules)

### 3. VS Code / GitHub Copilot Customization

VS Code Copilot 已经把可复用 AI 配置拆成 custom agents、prompt files 和 custom instructions。Custom agents 是 `.agent.md` 文件，可定义 specialized persona、instructions、tool access、model、handoffs 等；workspace 位置包括 `.github/agents/`，也兼容 `.claude/agents/`。Prompt files 使用 `.prompt.md`，可带 `description`、`name`、`argument-hint`、`agent`、`model`、`tools` 等 frontmatter。Instructions 则包括 `.github/copilot-instructions.md`、`.github/instructions/*.instructions.md`、`AGENTS.md`、`CLAUDE.md`。

对 MindOS 的启发：

- Assistant 文件可以采用“Markdown + metadata”的人类可编辑形态。
- Assistant detail 页应该同时展示 prompt、profile metadata、tools/skills、handoff/runtime 关系。
- Prompt template 与 Assistant profile 是相邻概念，但不要混淆：prompt 可以绑定某个 Assistant，Assistant 本身还包含运行策略。

Sources: [VS Code custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents), [VS Code prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files), [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)

### 4. GitHub Copilot Repository Instructions

GitHub Copilot 的 repository-wide instructions 位于 `.github/copilot-instructions.md`；path-specific instructions 位于 `.github/instructions/NAME.instructions.md`，frontmatter 用 `applyTo` 表示适用范围。GitHub 也支持 repo 中的 `AGENTS.md`，并按 nearest file precedence 应用。

这不是命名 Assistant，但它说明“repo 自带 AI 操作约束”已经变成常规设计。

对 MindOS 的启发：

- MindOS Assistant 应该能把当前 workspace / space 的 instruction substrate 纳入 context。
- 但指令 substrate 不等于 Assistant 本身：`AGENTS.md` 是环境约束，`.mindos/assistants/<id>` 是可选择 profile。

Source: [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)

### 5. Windsurf / Devin

Windsurf / Devin 把 **Memories、Rules、Workflows、Skills、AGENTS.md** 分成不同层。Memories 可以在对话中自动生成；持久规则可放在 `.devin/rules/`、legacy `.windsurf/rules/` 或 repo `AGENTS.md`；workflow 是 `.windsurf/workflows/` 下的 Markdown 文件，并通过 slash command 调用。它还区分 global、workspace、system-level rules。

对 MindOS 的启发：

- Assistant、Rules、Memory、Workflow、Skill 应该是不同对象。
- Assistant 可以引用 rules / memory / skills，但不应该把所有内容复制进 profile。
- 如果未来做 Schedule，应使用独立 trigger/run ledger，而不是让 Assistant 自己隐式定时运行。

Sources: [Windsurf memories](https://docs.windsurf.com/windsurf/cascade/memories), [Windsurf workflows](https://docs.windsurf.com/windsurf/cascade/workflows), [Windsurf llms.txt](https://docs.windsurf.com/llms.txt)

### 6. OpenCode

OpenCode 的 **Agents** 分为 primary agents 和 subagents。配置可以写在 `opencode.json`，也可以用 Markdown agent files；全局目录为 `~/.config/opencode/agents/`，项目目录为 `.opencode/agents/`。Markdown frontmatter 可定义 `description`、`mode: subagent`、`model`、`temperature`、`permission` 等。OpenCode 还同时存在 built-in agents 和 hidden system agents。

对 MindOS 的启发：

- Assistant registry 应允许 built-in template 和 local custom 共存。
- 内置 Assistant 不应只存在于前端常量；默认模板应 instantiate 成本地可审计文件，用户修改后不被升级覆盖。
- `permission` 这种执行约束应是 profile 一等字段。

Sources: [OpenCode agents](https://opencode.ai/docs/agents/), [OpenCode config](https://opencode.ai/docs/config/)

### 7. Dust

Dust 把 Agents 做成 workspace 内可搜索、可筛选、可管理的对象。Agent 可以使用 Spaces 中的数据，Spaces 支持 open / restricted；Restricted Space 中的数据只能给有权限的成员使用。Dust 还把 Tools 和 MCP servers 也放入 Space 管理，并区分 workspace-shared credentials 和 personal credentials。工具执行有风险 / 审批等级：高风险每次显式确认，中风险可保存特定范围审批，低风险可降低确认。

对 MindOS 的启发：

- Assistant 不能授予新权限，只能在当前用户已有文件 / tool 权限内工作。
- Tools、Skills、MCP、Knowledge 应显式列在 Assistant detail 页。
- 对写文件、发消息、远程调用等操作应有 Dust 式 risk / approval policy。

Sources: [Dust agents](https://docs.dust.tt/docs/managing-agents), [Dust data spaces](https://docs.dust.tt/docs/data), [Dust tools management](https://docs.dust.tt/docs/tools-management), [Dust credentials](https://docs.dust.tt/docs/personal-vs-workspace-credentials-for-tools-mcp-servers)

### 8. Glean

Glean Agents 是可复用 workflow，用 Agent Builder 配置 steps、actions、conditions 等。用户可以从 agent library 发现、启动、管理 agents。Actions 可以读取数据、写数据、起草内容、更新外部系统。

对 MindOS 的启发：

- Glean 更像企业 workflow agent，不是本地 profile。
- MindOS 可以借鉴“step / action / condition”的解释方式，但初版不应该先做复杂 builder；先把本地 Assistant profile 和运行记录做实。

Source: [Glean Agents](https://docs.glean.com/agents/how-agents-work)

### 9. Atlassian Rovo

Rovo agents 可从 Chat 或 Studio 创建，用 instructions、knowledge、tools 配置。可见范围可以是个人、团队或整个组织。官方文档强调：共享 agent 不会授予额外数据权限，用户只能看到自己本来有权访问的内容。Rovo 也提供 favorites、my agents 等搜索 / 管理方式。

对 MindOS 的启发：

- Assistant detail 页需要清楚显示它会使用哪些 knowledge source 和 tools。
- 共享或模板化 Assistant 只能共享配置，不能绕过本地文件权限。
- 工具数量应该克制；Rovo 文档建议不要给 agent 加过多 tools，这对性能和可控性都有帮助。

Source: [Atlassian Rovo agents](https://support.atlassian.com/rovo/docs/create-and-edit-agents/)

### 10. Microsoft Copilot Studio

Copilot Studio 是低代码 agent builder。Agent 由 instructions、context、knowledge sources、topics、tools、inputs、triggers 等组成，并可发布到 Teams、Web、mobile、Azure Bot Service 等 channel。Knowledge 可以是 agent-level 或 topic-level，SharePoint / Dataverse 等连接器会按 per-user auth 限制内容可见性。

对 MindOS 的启发：

- Channel 是发布 / 交付面，不是 Assistant 本身。
- Knowledge 和 trigger 应独立建模；Assistant 可以引用它们。
- per-user auth 原则适用于本地：Assistant 不应该因为被选中就获得更高文件权限。

Sources: [What is Microsoft Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio), [Copilot Studio knowledge](https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio)

### 11. Claude Projects

Claude Projects 是 self-contained workspace，带自己的 chat history、knowledge base 和 project instructions。Team / Enterprise 可设置项目共享权限，例如 can use 和 can edit。

它不是多个命名 Assistant 的 registry，但它证明了一个重要产品模式：**workspace-level context + instructions** 可以成为长期工作环境。

对 MindOS 的启发：

- Space / workspace context 和 Assistant profile 应该互相引用。
- Project/Space 是工作环境；Assistant 是在这个环境中被选择或雇佣的角色。

Source: [Anthropic Projects](https://support.anthropic.com/en/articles/9517075-what-are-projects)

### 12. Gemini Gems

Gemini Gems 是用户自定义的 reusable assistant。用户给 Gem 命名、写 instructions，也可以添加 Knowledge 文件或 Google Drive 文件。Gemini 还可以帮助用户生成 instructions。

对 MindOS 的启发：

- 对普通用户来说，“名字 + 用途 + instructions + knowledge”比“agent config schema”更容易理解。
- MindOS UI 应该把复杂 schema 渐进披露：列表和详情首屏先讲职责、入口、可用资源，JSON/profile 放到次级 tab。

Source: [Gemini Gems](https://support.google.com/gemini/answer/15235603?hl=en)

### 13. OpenAI GPTs

OpenAI GPTs 是 ChatGPT 中面向特定目的配置的 custom versions。配置包括 instructions、conversation starters、knowledge、capabilities、apps、actions 等；GPT 可以私有、按链接分享、在 workspace 内共享，或在符合条件时发布到 GPT Store。它不是本地文件模式，但代表了大众用户已经熟悉的“自定义助手 / persona + 知识 + action”心智。

对 MindOS 的启发：

- Assistant 应该有非技术用户能读懂的职责描述。
- Actions/tools 必须显式展示，否则用户难以判断风险。
- MindOS 与 GPTs 最大差异是 local-first：配置和 prompt 应在本机文件系统中可审计、可 git diff。

Sources: [GPTs in ChatGPT](https://help.openai.com/en/articles/8554407-gpts-in-chatgpt), [Creating and editing GPTs](https://help.openai.com/en/articles/8554397-creating-and-editing-gpts)

### 14. Dify

Dify 的 Agent app 是 chat-style app，模型可以 reason、make decisions、autonomously use tools。Agent prompt 支持 variables，variables 会变成运行时 input fields；Dify 还支持 prompt generation / improvement 和版本回滚。Agent 可连接 Dify tools 与外部 API，并由模型决定何时使用。

对 MindOS 的启发：

- Assistant prompt 编辑需要版本意识，至少要能通过文件 diff / git 追踪。
- 输入变量、调用页面、输出位置应该由 Run input / Run 记录承载；`profile.json` 只保存跨场景稳定的 profile metadata。
- 工具使用应可解释：用户需要知道 Assistant 为什么能调用某个 Skill/MCP。

Source: [Dify Agent](https://docs.dify.ai/en/use-dify/build/agent)

### 15. LangGraph / LangSmith

LangGraph Platform / LangSmith 把 **Assistant** 定义为 Agent Server 中的配置对象：它把 prompt、LLM selection、tools 等配置从 graph core logic 中拆出来。同一个 graph 可以有多个 assistants，每个 assistant 有不同 config；assistant config 有版本历史，更新会产生新版本，也可以 promote / rollback。

这是对 MindOS 最关键的类比：Assistant 不是执行体，而是执行体之上的配置 profile。

对 MindOS 的启发：

- MindOS 的 Assistant 应该路由到 MindOS Agent / Codex / Claude Code 等执行 Agent。
- Assistant detail 页应展示“这个 profile 会优先交给哪个 runtime、默认使用哪些 Skills/MCP、写入边界是什么”；具体 context 由调用方注入。
- 未来可加 version history，但第一版用本地文件 + git diff 即可。

Source: [LangGraph Assistants](https://docs.langchain.com/langgraph-platform/assistants)

### 16. Lindy

Lindy 把 custom agent 组织成 workflow：trigger 负责启动，actions 负责执行，workflow editor 负责串联步骤和逻辑。Triggers 可以是 time-based、chat-based、event-based；actions 可以发邮件、更新表格、处理数据，并使用账号连接。

对 MindOS 的启发：

- Schedule 应定义为 `trigger + assistant/command + context resolver + output policy + run policy`。
- 不要让 Assistant profile 自己承担 scheduler / workflow graph 的职责。
- 当 MindOS 支持定时或事件触发时，运行记录必须是一等对象。

Sources: [Lindy create agent](https://docs.lindy.ai/fundamentals/lindy-101/create-agent), [Lindy actions](https://docs.lindy.ai/fundamentals/lindy-101/actions), [Lindy triggers](https://docs.lindy.ai/fundamentals/lindy-101/triggers)

## 横向模式

### 模式 A：File-native registry

代表产品：Claude Code、VS Code Copilot、OpenCode、Cursor、Windsurf / Devin。

共同点：

- 使用 repo / project / user 目录下的 Markdown 或 config 文件。
- 允许用户用 git diff 审计变更。
- 通常支持 frontmatter 或 metadata，把 description、tools、model、permission 等从 prompt 中拆出来。
- 支持 user / project / workspace 分层。

MindOS 适配：

- 当前 `.mindos/assistants/<assistant-id>/prompt.md + profile.json` 正好落在这一类。
- UI 应该是 local registry 的浏览器和编辑器，而不是前端 mock preset。
- 默认模板可以内置在产品里，但应非破坏性地落盘为本地文件；用户编辑后不覆盖。

### 模式 B：Workspace cloud agent library

代表产品：Dust、Glean、Rovo、Copilot Studio、Dify、Lindy。

共同点：

- Agent 是 workspace 对象，能被搜索、筛选、分享、管理。
- Knowledge、tools、integrations、credentials、approval level 都显式配置。
- 多数产品强调 agent 不会绕过用户已有权限。

MindOS 适配：

- MindOS 不是 SaaS workspace，但也需要同样的资源透明性。
- Assistant detail 页应明确列出：Prompt 路径、Profile 路径、preferred Agent、Skills、MCP、权限边界和 health；context / channel 由具体调用方展示。
- 对写操作和外部发送动作，必须有 approval policy。

### 模式 C：Instruction substrate

代表产品：Cursor、GitHub Copilot、Windsurf / Devin、VS Code。

共同点：

- `AGENTS.md`、rules、instructions 是背景约束。
- 它们会自动影响 AI 行为，但通常不是用户主动选择的“一个助理”。

MindOS 适配：

- `AGENTS.md` / `INSTRUCTION.md` / Space instructions 应作为调用时注入的运行 context，不直接写死在 Assistant profile 里。
- 不能把 instruction substrate 当成 Assistant registry，否则 UI 很难解释“我现在选的是谁”。

### 模式 D：Versioned runtime config

代表产品：LangGraph / LangSmith。

共同点：

- Assistant 是 graph / runtime 上的一组配置。
- 同一运行逻辑可以被多个 Assistant profile 复用。
- 更新配置形成版本历史。

MindOS 适配：

- 这是 MindOS Agent / Assistant 分离的最佳外部背书。
- Agent runtime 负责执行；Assistant profile 负责 instructions、资源、路由、约束。
- 第一版版本历史可以依赖本地文件 + git，后续再做 UI rollback。

### 模式 E：Local automation metadata + external runtime artifacts

代表样本：Codex automation `daily-research-radar`。

本机观察到的结构：

```text
~/.codex/automations/daily-research-radar/
  automation.toml
  memory.md

~/Downloads/research-radar/
  config.json
  seen.json
  reports/
    YYYY-MM-DD-papers.md
    YYYY-MM-DD-log.md
```

`automation.toml` 更像 Schedule，而不是 Assistant profile。它保存 `id`、`kind=cron`、`status`、`rrule`、`model`、`reasoning_effort`、`execution_environment`、`cwds` 和一段长 prompt。它没有把 workflow 的所有业务状态和输出塞回 automation 目录。

`~/Downloads/research-radar/config.json` / `seen.json` 是 domain runtime state：主题、数据源、时间窗口、输出目录、去重记忆都在这里。每日产物稳定写到 `reports/YYYY-MM-DD-papers.md` 和 `reports/YYYY-MM-DD-log.md`。`~/.codex/automations/daily-research-radar/memory.md` 则承担 run ledger summary：记录每次运行的数据源状态、promoted 数量、输出路径和 seen count。

MindOS 适配：

- Schedule 保存触发条件、运行目录、模型 / 执行环境偏好和 runTemplate。
- Assistant 保存可复用 profile，不保存每日输出位置和去重状态。
- Run 保存 canonical artifact 和输入快照；如果某个 workflow 还会把主产物写到领域目录，Run 记录对应路径。
- 长期 workflow state 可以归 Schedule/runtime config 或领域目录，而不是归 Assistant。

## 对 MindOS 的建议

### 推荐方案

继续采用 **本机 CLI / Web 共同读取 `.mindos/assistants` 的 file-backed Assistant registry**：

```text
.mindos/
  assistants/
    daily-signal/
      prompt.md
      profile.json
    wiki-librarian/
      prompt.md
      profile.json
```

Assistant 页做三件事：

1. **加载本地 Assistant**：从 `/api/assistants` 动态读 `.mindos/assistants/<id>/prompt.md` 和 `profile.json`。
2. **正确渲染详情**：列表、概览、Prompt、Profile、Resources 都来自真实文件。
3. **安全编辑保存**：Prompt 保存到 `prompt.md`，Profile 保存到 `profile.json`；不安全 id、缺失文件、JSON 错误、空目录都有明确状态。

### 概念边界

| MindOS 概念 | 应该是什么 | 不应该是什么 |
|---|---|---|
| Agent | 执行运行体：MindOS Agent、Codex、Claude Code、Gemini CLI、OpenCode 等 | 不要等同于一段 prompt |
| Assistant | 本地 profile：角色、职责、prompt、资源、路由策略 | 不要 mock 在前端常量里 |
| Skill & MCP | Assistant / Agent 可以调用的能力和工具连接 | 不要混成 Assistant 本身 |
| Channel | 结果交付或消息入口 | 不要混成 Assistant 或 Agent |
| Schedule | trigger + command/assistant + context + output policy + run policy | 不要让 Assistant 自己隐式承担调度 |
| Run | 一次执行记录和审计对象 | 不要只是 activity log 碎片 |

### `profile.json` 建议字段

第一版不需要过度复杂，只保留机器必须读、且跨场景稳定的字段：

```json
{
  "name": "Wiki Librarian",
  "description": "Reviews local knowledge structure and suggests cleanup.",
  "schemaVersion": 1,
  "preferredAgent": "mindos-agent",
  "skills": ["mindos"],
  "mcp": []
}
```

字段原则：

- `name / description` 面向用户，必须清楚。
- `schemaVersion` 用于后续迁移。
- `preferredAgent` 只表达路由偏好，不保证强制执行。
- `skills / mcp` 表示默认能力来源；具体 tool 由 runtime 展开。
- `prompt.md` 固定在同目录，由服务端推导路径，不在 `profile.json` 里配置 `promptPath`。
- `permissionMode` 不进入 `profile.json`；它属于 Runtime Context / Run input / Schedule runTemplate / Run snapshot，未指定时默认 `readonly`。
- `surface`、`outputPolicy`、具体 Space / Inbox / Channel、trigger / schedule 都属于 Runtime Context / Schedule / Run input / Run，不属于 Assistant 本体。

### UI 建议

Assistant 页不应该像 marketplace，也不应该像纯 JSON 编辑器。建议结构：

```text
Assistant
  Left rail:
    Search
    Assistant list
    health / preferred agent / permission mode / capability badges

  Detail:
    Header: name, description, health, preferred agent, permission mode
    Tabs:
      Overview    role, responsibilities, last run, entry points
      Prompt      prompt.md editor
      Profile     profile.json structured editor + raw JSON fallback
      Resources   paths / skills / MCP / permission mode / health
```

关键状态：

- empty：`.mindos/assistants` 下没有可加载 Assistant，告诉用户创建路径。
- missing prompt：有 `profile.json` 但没有 `prompt.md`，允许在 UI 写入并保存。
- invalid JSON：仍展示 prompt，但 Profile tab 显示错误和原始内容。
- unsafe id：服务端忽略，UI 不展示。
- large prompt：服务端可返回 preview + file path，避免 payload 太大。

### 安全策略

1. Assistant 不能扩大权限。它只能使用当前用户、当前 workspace 已允许的文件和工具能力。
2. `assistant-id` 必须只接受稳定 slug，例如 `^[a-z0-9][a-z0-9-]*$`。
3. 写入 `.mindos/assistants` 前要检查 symlink / path traversal，避免 hidden registry 指到 mind root 外。
4. 外部动作按风险分层：读本地文件低风险；写文件中风险；发消息 / 调 API / 删除数据高风险。
5. Built-in template 只能补齐缺失文件，不能覆盖用户已编辑 prompt。

## 结论

MindOS 应该坚持当前方向：**Assistant = 本地文件驱动的 profile，Agent = 执行运行体**。这个方案不是小众做法，反而同时被 Claude Code、VS Code Copilot、OpenCode、Cursor、Windsurf 的 file-native 模式，以及 LangGraph 的 Assistant config 模型支持。

下一步优先级：

1. 完成 `/api/assistants` 到 `.mindos/assistants` 的真实加载链路。
2. Assistant 页移除前端 mock preset，所有详情来自本地文件。
3. Detail UI 做到 Overview / Prompt / Profile / Resources 四块清晰分层。
4. Resources 明确展示 Tools / Skills / MCP / Context / Guardrails。
5. 后续再加 template gallery、Schedule、run ledger、version rollback；不要一开始做 marketplace 或 workflow builder。

## Sources

- Claude Code: [Subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
- Cursor: [Rules](https://cursor.com/docs/rules)
- VS Code / Copilot: [Custom agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents), [Prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files), [Custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- GitHub Copilot: [Repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions)
- Windsurf / Devin: [Memories](https://docs.windsurf.com/windsurf/cascade/memories), [Workflows](https://docs.windsurf.com/windsurf/cascade/workflows), [llms.txt](https://docs.windsurf.com/llms.txt)
- OpenCode: [Agents](https://opencode.ai/docs/agents/), [Config](https://opencode.ai/docs/config/)
- Dust: [Managing agents](https://docs.dust.tt/docs/managing-agents), [Data spaces](https://docs.dust.tt/docs/data), [Tools](https://docs.dust.tt/docs/tools-management), [Credentials](https://docs.dust.tt/docs/personal-vs-workspace-credentials-for-tools-mcp-servers)
- Glean: [How agents work](https://docs.glean.com/agents/how-agents-work)
- Atlassian Rovo: [Create and edit agents](https://support.atlassian.com/rovo/docs/create-and-edit-agents/)
- Microsoft Copilot Studio: [Overview](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio), [Knowledge](https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio)
- Anthropic: [Projects](https://support.anthropic.com/en/articles/9517075-what-are-projects)
- Google Gemini: [Gems](https://support.google.com/gemini/answer/15235603?hl=en)
- OpenAI: [GPTs in ChatGPT](https://help.openai.com/en/articles/8554407-gpts-in-chatgpt), [Creating and editing GPTs](https://help.openai.com/en/articles/8554397-creating-and-editing-gpts)
- Dify: [Agent](https://docs.dify.ai/en/use-dify/build/agent)
- LangGraph / LangSmith: [Assistants](https://docs.langchain.com/langgraph-platform/assistants)
- Lindy: [Create agent](https://docs.lindy.ai/fundamentals/lindy-101/create-agent), [Actions](https://docs.lindy.ai/fundamentals/lindy-101/actions), [Triggers](https://docs.lindy.ai/fundamentals/lindy-101/triggers)
