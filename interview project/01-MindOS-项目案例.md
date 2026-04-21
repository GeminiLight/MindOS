# 面试项目案例：MindOS

## 0. 项目一句话

我独立完成过的代表性 vibe coding 项目是 **MindOS**：一个面向多 AI Agent 工作流的本地优先知识操作系统。它把用户在日常对话、编码、决策中的判断沉淀为可复用的知识与规则，让不同 Agent 共享同一套上下文，并在 GUI、CLI、MCP、Desktop 多端统一工作。

它不是一个“只会聊天”的 AI 应用，而是一个从产品定义、交互设计、协议接入、知识存储、Agent 管理到跨平台分发都完整闭环的产品型项目。

---

## 1. 为什么我选择这个项目作为 vibe coding 代表作

### 1.1 这不是一个单点 Demo，而是完整产品

围绕 MindOS，我独立推进了以下内容：

- 产品定义：问题识别、目标用户、路线图、竞争分析、商业化假设。
- 交互设计：信息架构、面板布局、状态切换、设计原则、视觉规范。
- 工程实现：Next.js Web 工作台、Node CLI、MCP Server、Agent 协议接入、桌面端分发。
- 文档体系：产品 proposal、startup 文档、wiki、架构设计、已知坑与经验沉淀。
- 质量控制：编码规范、测试约束、pitfalls 记录、发版流程、架构 review。

### 1.2 它非常适合体现“vibe coding”能力

我理解的 vibe coding，不是“让 AI 帮我写几段代码”，而是：

1. 人负责定义方向、边界和质量标准；
2. AI 负责提速探索、补全实现、协助重构和写文档；
3. 最终产物必须能落到真实用户场景、真实架构和真实交付。

MindOS 正好覆盖了这个闭环：从战略叙事到上线能力都完整存在，因此它比单纯的页面 Demo 更能证明我的独立交付能力。

---

## 2. 项目背景与问题定义

### 2.1 我观察到的真实问题

在 AI 工具高度普及后，独立开发者和创始人的工作流正在发生变化：

- 同时使用 3 个以上的 AI Agent 已经越来越常见；
- 大量时间花在“重复讲背景、重复纠正、重复搬运上下文”上；
- 高价值判断散落在不同对话窗口里，无法复用，更无法沉淀成长期资产。

这个问题并不只发生在“聊天”环节，而是贯穿以下动作：

- 写代码时要反复重申规范、架构和项目背景；
- 写文档或做调研时要重新喂给 AI 以前讲过的材料；
- 切换 Claude、Cursor、Codex、Gemini 等不同 Agent 时，上下文无法继承；
- 对 AI 的纠正只存在于当前对话，下一次又从零开始。

### 2.2 我对问题的拆解

基于 startup 文档中的主线，我把问题拆成三层：

| 层次 | 问题 | 具体表现 |
| --- | --- | --- |
| 表层 | 使用割裂 | 切换 Agent 必须重复交代背景 |
| 中层 | 经验蒸发 | 纠正和偏好无法转化为稳定规则 |
| 深层 | 成长不复合 | 用户在变强，但 AI 和系统没有随之进化 |

这意味着，真正缺少的不是“又一个更聪明的 Agent”，而是一个处在人与 Agent 之间的**判断沉淀层**。

---

## 3. 目标用户与用户场景分析

### 3.1 核心用户画像

MindOS 的核心用户不是泛大众，而是 **同时使用 3+ AI Agent 的独立开发者 / 创始人**。这类用户有几个非常明显的特征：

- 日常在 CLI、IDE、浏览器和多个 AI 对话窗口之间切换；
- 有较强的本地文件、Markdown、SOP、项目文档管理习惯；
- 对效率和掌控感要求很高，不愿把所有记忆交给云端黑箱；
- 希望 AI 不只是回答问题，而是能真正读懂自己的规则并参与交付。

### 3.2 代表性场景

#### 场景 A：开发者跨 Agent 编码

用户在 Claude Code 写后端、在 Cursor 调前端、在另一个 Agent 做 review。如果每次切换都要重新交代：项目背景、目录结构、命名规范、错误处理标准，效率会被严重吞噬。

**需求本质：** 写一次规则，所有 Agent 遵守。

#### 场景 B：创始人沉淀战略与决策

用户会在 AI 对话中不断做产品判断：怎么定位、优先做什么、哪些功能暂缓、怎样和竞品区分。但如果这些决策只留在聊天窗口里，后续无法追溯。

**需求本质：** 让决策成为知识资产，而不是一次性对话产物。

#### 场景 C：把工作流变成可执行 SOP

用户纠正 AI 的时候，实际是在暴露自己的方法论。比如“错误信息要对用户友好”“技术文档要先写背景再写方案”。这些如果能够沉淀成 Skill 或 Instruction，下次就无需重复纠正。

**需求本质：** 让纠正可以复用，且被不同 Agent 继承。

### 3.3 用户价值主张

我最终把产品价值收敛为三句话：

1. **写一次，全局复用**：项目背景和规则不再重复交代；
2. **人可治理，透明可控**：知识与规则都以本地纯文本保存，可审计、可修改；
3. **经验回流，持续演进**：对 AI 的纠正不浪费，而是逐步沉淀成自己的方法论。

---

## 4. 解决方案设计

### 4.1 产品定义

MindOS 不是传统笔记工具，也不是单一 Agent 的聊天记忆，而是一个本地优先的 **Human-Agent Shared Mind System**。

我把它设计成三层模型：

| 层级 | 核心概念 | 作用 |
| --- | --- | --- |
| 结构层 | Space | 按项目、主题、角色组织知识 |
| 控制层 | Instruction | 定义所有 Agent 共同遵守的规则 |
| 执行层 | Skill | 把经验与方法论沉淀成可复用执行手册 |

### 4.2 解决思路

围绕“判断沉淀层”这个定位，我设计了四个产品抓手：

1. **统一知识底座**：本地 Markdown/CSV/JSON 作为单一事实源；
2. **统一 Agent 接入**：通过 MCP、ACP、A2A 协议让不同 Agent 共享上下文；
3. **统一人机工作台**：用户通过 GUI、CLI、Desktop 操作同一套知识系统；
4. **统一沉淀机制**：让规则、操作日志、工作流和反思都能回流到知识库。

### 4.3 关键功能设计

#### 1）GUI 工作台

- 浏览和编辑知识库文件；
- 统一搜索与全局入口；
- 插件式渲染器支持 Todo、Timeline、Graph、Agent Inspector 等视图；
- 为 AI 相关动作提供更强的可见性，而不是隐藏在黑箱里。

#### 2）MCP Server

- 让外部 Agent 能读取、搜索、修改本地知识库；
- 支持 stdio 与 HTTP 两种接入模式；
- 配合 Bearer Token、路径沙箱、写保护和原子写入，保证安全边界。

#### 3）Agent 管理与协议协作

- 不只接一个 Agent，而是把多 Agent 当成一等公民；
- 提供 A2A / ACP 协议支持，向更深的协作模式演进；
- 在 UI 中统一展示 Agent 状态、技能、配置和活动日志。

#### 4）Echo 反思系统

- 不只是记知识，也记“人”；
- 通过 Daily、Growth、Past You 等模块承接复盘和认知沉淀；
- 为后续“认知镜像”能力做数据基础。

---

## 5. 系统架构与数据流

### 5.1 总体架构

```text
用户 / 外部 Agent
   ├─ Web GUI (Next.js)
   ├─ CLI (Node.js)
   ├─ Desktop (Electron)
   └─ MCP / ACP / A2A 客户端
            │
            ▼
      MindOS 服务层
   ├─ app/ API Routes
   ├─ mcp/ MCP Server
   ├─ bin/ CLI commands
   └─ Agent runtime / tools / session
            │
            ▼
    本地知识底座（Markdown / CSV / JSON）
            │
            ├─ Git 同步
            ├─ 搜索索引
            ├─ Activity / 审计日志
            └─ Skills / Instructions / Spaces
```

### 5.2 关键数据流

#### 数据流 1：用户编辑知识

```text
用户在 GUI / CLI 中发起操作
→ API Route / CLI Command
→ 文件系统写入本地知识库
→ 更新搜索索引 / 变更记录 / Git 历史
→ 新内容对所有 Agent 立即可读
```

#### 数据流 2：外部 Agent 访问知识库

```text
外部 Agent 通过 MCP 请求工具
→ MCP Server 做鉴权、路径校验、写保护校验
→ 读取或写入本地文件
→ 记录 Agent 操作日志
→ GUI 中可审计、可追溯
```

#### 数据流 3：经验回流成规则

```text
用户纠正 AI 输出
→ 经验被整理为 Instruction / Skill / Note
→ 保存回知识库
→ 下次其他 Agent 读取同一规则并执行
```

### 5.3 为什么这个架构成立

这个架构最重要的决策不是“用了什么框架”，而是 **把本地纯文本知识库定义为系统中心**。这样做的好处有四个：

- 数据可迁移，不会被产品私有格式锁死；
- 人和 Agent 共享同一份事实源，而不是两套系统；
- 文档、规则、SOP、日志可以天然共存；
- 上层可以同时承接 GUI、CLI、Desktop、Agent 协议，而不会碎片化。

---

## 6. 技术选型与理由

### 6.1 技术栈总览

| 层级 | 选型 | 选择理由 |
| --- | --- | --- |
| Web 前端 | Next.js 16 + React 19 + TypeScript | 适合做同时包含 UI、API Route、路由页面和本地工具整合的全栈工作台 |
| 样式系统 | Tailwind CSS 4 + 设计 token + 组件约束 | 适合快速迭代，同时能通过设计原则控制一致性 |
| 编辑能力 | TipTap + CodeMirror | 同时覆盖富文本感编辑与代码/Markdown 场景 |
| 客户端状态 | Zustand | 足够轻量，适合复杂面板状态和局部全局状态共享 |
| Agent Runtime | `pi-agent-core` / `pi-coding-agent` / `pi-ai` | 便于整合模型、session、tool 调用与自定义 system prompt |
| 协议层 | MCP + ACP + A2A | 保证外部 Agent 兼容性和后续多 Agent 扩展能力 |
| CLI | Node.js ESM | 与服务端逻辑复用便利，便于发布 npm 包 |
| Desktop | Electron | 以最小阻力覆盖 macOS / Windows / Linux |
| 存储 | 本地 Markdown / CSV / JSON + Git | 强调透明、可审计、可迁移和本地优先 |

### 6.2 技术选型背后的判断

#### 为什么选择本地纯文本，而不是云数据库

如果产品目标是“让用户掌控自己的判断资产”，那就不能把核心数据放在用户难以干预的黑箱里。

因此我选择：

- Markdown 承载正文知识；
- CSV 承载结构化轻量数据；
- JSON 承载配置和日志；
- Git 负责版本可追溯。

这让产品天然拥有透明、版本控制和多工具兼容的优势。

#### 为什么既做 GUI，又做 CLI，又做 Desktop

目标用户不是只在浏览器里工作的人，而是高度分散在本地开发环境和多 Agent 环境中的重度用户。

- **GUI** 解决可视化、审计和编辑体验；
- **CLI** 解决安装、自动化和开发者工作流整合；
- **Desktop** 解决分发与非终端用户的上手门槛；
- **MCP** 解决 Agent 接入问题。

这不是堆功能，而是围绕同一核心能力覆盖不同入口。

#### 为什么在早期就布局多 Agent 协议

因为我从一开始就把“多 Agent 共享上下文”定义为核心场景。如果产品只服务一个 Agent，那它本质上只是聊天记忆；只有把协议层做好，才能把产品从“工具”变成“基础设施”。

---

## 7. 我是如何用 vibe coding 方式推进这个项目的

### 7.1 我的工作方式不是“先写代码”，而是“先定义边界”

这个项目里，我先建设了大量规则和文档体系，例如：

- AGENTS 协作规则；
- spec 模板；
- 测试规范；
- 设计原则文档；
- known pitfalls / review / backlog / changelog。

这套系统的作用是：让 AI 可以提速，但不能把方向带偏。

### 7.2 我把 AI 当成高效率协作者，而不是替代者

在实际执行中，我会让 AI 参与：

- 技术方案发散；
- UI / UX 细节补完；
- 模块级代码实现与拆分；
- 测试与 review；
- 文档同步与总结。

但关键决策始终由我收口，例如：

- 目标用户是谁；
- 哪些能力必须本地优先；
- 什么是产品边界；
- 哪些设计和架构 trade-off 可以接受；
- 哪些质量门槛不能让步。

### 7.3 我特别重视“可持续的 AI 开发”

这个项目不是一次性的 prompt 产物，而是一个不断演化的系统。因此我特别强调：

- 经验沉淀：把坏 case、踩坑、规范写入 wiki；
- 架构治理：大文件拆分、职责下沉、统一状态管理；
- 文档同步：功能、路线图、架构文档持续更新；
- 发版纪律：CLI / Desktop / npm 发布有明确流程与冒烟验证。

我认为，这才是 vibe coding 进入真实产品阶段后最关键的能力：**让 AI 产出的代码和文档，能够长期被维护，而不是只在当下看起来“做出来了”。**

---

## 8. 原型截图与说明

### 8.1 产品总览图

![产品总览](assets/screenshots/00-product-loop.png)

这张图最能说明我希望产品建立的主循环：

- 用户把思考与经验写入系统；
- Agent 读取这些内容去执行任务；
- 执行结果与纠正再沉淀回来；
- 最终形成不断增强的人机协作闭环。

### 8.2 首页：知识工作台

![首页](assets/screenshots/01-home.png)

首页承担两个职责：

- 让用户快速进入当前知识空间；
- 让用户感受到这不是一个“聊天盒子”，而是一个完整的人机协作工作台。

### 8.3 AI 对话：基于知识库的 Agent 交互

![AI 对话](assets/screenshots/02-chat.png)

这一页体现的重点不是聊天 UI，而是：

- 对话带着知识上下文；
- Agent 可以结合文件、规则和工具执行；
- 输出可以继续沉淀为结构化内容。

### 8.4 Dashboard：Agent 管理与系统可见性

![Dashboard](assets/screenshots/03-dashboard.png)

这是我非常看重的一页，因为它体现了我对“多 Agent”这个问题的理解：

- 不同 Agent 必须被统一纳管；
- 连接状态、配置、能力和上下文来源要可见；
- 用户需要对 Agent 的行为有治理感，而不是只看到一个输入框。

### 8.5 Echo：反思与认知沉淀

![Echo](assets/screenshots/04-echo.png)

Echo 模块承接的是“人”的那一面：

- 不是只存资料，也存判断、复盘、成长轨迹；
- 为未来更强的认知镜像能力做基础；
- 让 MindOS 不是单纯提高效率，而是逐渐提高思考质量。

### 8.6 Agents 页面：多 Agent 协作的产品化表达

![Agents 页面](assets/screenshots/05-agents-page.png)

这一页是“协议能力产品化”的体现。技术上是接入 Agent，产品上则要把接入、配置、识别、能力边界都表达清楚。

---

## 9. 原型录屏说明

- 我额外整理了一份短版演示视频：`assets/video/mindos-walkthrough.mp4`
- 同时准备了 90 秒真人讲解脚本：`03-原型录屏脚本.md`

如果面试老师允许提交视频，我建议：

1. 先附 PDF 主文档；
2. 再附 60-90 秒产品 walkthrough；
3. 口头讲解时重点说“多 Agent 上下文共享 + 判断沉淀 + 本地治理”这三件事。

---

## 10. 项目亮点与成果

### 10.1 产品层面

- 围绕“跨 Agent 判断沉淀”提出了清晰的产品定位；
- 把本地知识管理、Agent 接入、规则治理、反思系统整合成统一产品；
- 明确区分了获客层（止痛）和留存层（认知复利）两个价值层级。

### 10.2 工程层面

- 形成了 Web + CLI + MCP + Desktop 的完整技术组合；
- 建立了本地优先、可审计、可迁移的数据底座；
- 通过协议化设计，为多 Agent 协作预留扩展空间；
- 在复杂产品里持续做架构重构，而不是一路堆叠。

### 10.3 过程层面

- 我不是先做代码，再补文档，而是同步建设文档和系统；
- 把 startup、wiki、known pitfalls、spec、review 都纳入开发主流程；
- 用规则、模板和经验沉淀约束 AI 协作质量。

---

## 11. 独立完成范围

围绕 MindOS，我独立承担的工作可以概括为下表：

| 维度 | 具体内容 |
| --- | --- |
| 产品 | 定位、用户场景、路线图、竞争分析、商业化假设 |
| 设计 | 信息架构、页面结构、设计原则、状态与交互约束 |
| 前端 | Next.js 工作台、面板布局、页面与组件组织、可视化表达 |
| Agent 能力 | MCP 接入、工具体系、系统提示词、Skill 体系、Agent 管理 |
| 工程化 | CLI、文件系统、配置、发版流程、文档同步、质量规范 |
| 平台化 | Desktop 分发、协议扩展、未来 API/Workflow 预留 |

这也是为什么我认为它很适合作为面试中的代表项目：它不是局部参与，而是完整 owner 过一个复杂系统。

---

## 12. 复盘与反思

### 12.1 我最重要的判断

如果只是做一个“AI + 笔记”的产品，它很容易沦为功能拼贴；真正的关键是明确：**产品中心必须是用户的判断资产，而不是模型本身。**

这个判断影响了后面几乎所有技术和产品决策：

- 为什么强调本地优先；
- 为什么强调透明和审计；
- 为什么把 Instruction / Skill / Space 作为核心概念；
- 为什么产品要服务多 Agent，而不是绑定某一个模型或某一个聊天入口。

### 12.2 如果我继续迭代，我会重点做什么

1. 进一步把“纠正 -> 规则 -> 复用”自动化；
2. 做更强的知识健康度和认知镜像能力；
3. 优化新用户在 5 分钟内建立 Aha Moment 的路径；
4. 增强多 Agent 的权限、冲突控制和任务编排能力。

### 12.3 这个项目最能体现我的地方

它最能体现我的，不是“我会不会用 AI 写代码”，而是：

- 我能不能把一个模糊问题抽象成产品机会；
- 我能不能搭出可长期演化的系统；
- 我能不能在 AI 提速的前提下，依然保持架构、质量和表达上的主导权。

这也是我希望通过这份作业向老师展示的核心能力。

---

## 13. 文档依据

这份案例主要基于以下材料整理：

- `README.md`
- `README_zh.md`
- `startup/README.md`
- `startup/1-strategy.md`
- `startup/2-product-design.md`
- `startup/3-technical-pillars.md`
- `startup/4-business-plan.md`
- `startup/5-competitive-analysis.md`
- `startup/6-user-interview-guide.md`
- `startup/7-functions-and-cases.md`
- `wiki/00-product-proposal.md`
- `wiki/01-project-roadmap.md`
- `wiki/02-business-model.md`
- `wiki/03-technical-pillars.md`
- `wiki/20-system-architecture.md`
- `wiki/21-design-principle.md`
- `wiki/22-page-design.md`
- `wiki/23-mind-spaces.md`
- `wiki/25-agent-architecture.md`
- `wiki/30-api-reference.md`
- `wiki/40-conventions.md`
- `wiki/41-dev-pitfall-patterns.md`
- `wiki/42-ai-feature-dev-lessons.md`
- `wiki/61-plugin-architecture.md`
- `wiki/64-stage-desktop.md`
- `wiki/65-stage-knowledge-api.md`
- `wiki/66-stage-cli.md`
- `wiki/80-known-pitfalls.md`
- `wiki/85-backlog.md`
- `wiki/90-changelog.md`
- `docs/zh/configuration.md`
- `docs/zh/cli-commands.md`
- `docs/zh/supported-agents.md`
- `docs/en/configuration.md`
- `docs/en/cli-commands.md`
- `docs/en/supported-agents.md`

更详细的研读与提炼见：`02-资料研读与提炼.md`
