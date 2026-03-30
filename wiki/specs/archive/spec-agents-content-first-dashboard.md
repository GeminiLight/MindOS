# Spec: Agents Content-First Dashboard（Sidebar 导航，Content 展示）

## 目标

将 Agents 相关信息与操作从“侧边栏/右侧抽屉的局部视图”升级为“Content 主区的系统视图”，实现以下效果：

1. 点击 Sidebar 的 `Agents` 后，在 Content 内统一展示 `Overview / MCP / Skills / Agent Detail`。
2. 用户可在同一工作面完成“看状态 → 定位问题 → 执行动作”闭环。
3. 支持“每个用户 Agent 与 Skill 安装集合不同”的动态展示，不依赖固定清单。
4. 以“本地优先、透明可控”为原则，让用户能判断 Agent 是否按 Space 规则执行。

## 现状分析

当前 Agents 体验存在三个结构性问题：

- **展示分散**：Agents 信息在 Panel、Settings、右侧详情之间切换，路径长，认知成本高。
- **视图过窄**：右侧详情面板空间不足，难以同时展示连接状态、技能矩阵、近期活动等关键信息。
- **模型不统一**：UI 更像“列表 + 卡片”，缺少系统级对象关系（Agent、MCP、Skill、Space）。

对 MindOS 的直接影响：

- 用户难以判断“Agent 是否按 Space 的规则工作”。
- 用户看见异常后无法就地修复（常需跳转设置）。
- 多 Agent 并行用户无法快速建立全局态势感。

## 数据流 / 状态流

```text
Sidebar (Agents entry click)
  -> Router navigate /agents
  -> AgentsContentPage (top segment tabs)
       -> OverviewView
       -> McpView
       -> SkillsView
       -> AgentDetailView (/agents/[agentKey])

Data source: McpProvider / useMcpData (single source)
  reads:
    - mcp status
    - agents list
    - skills list
    - (optional) recent activity summary
  writes:
    - installAgent
    - reconnect/test connection
    - toggle skill
    - copy snippet

Cross-object relation (for visualization):
  Agent --(transport/auth)--> MCP Server
  Agent --(enabled)--> Skills
  Agent --(recent runs)--> Spaces
  Space --(rules)--> INSTRUCTION.md
```

状态原则：

- Content 页使用同一状态源，避免 Panel/Settings 双状态漂移。
- Segment 切换不重复拉取基础元数据（仅按需拉取重数据，如活动详情）。
- Agent Detail 在路由层独立，保证可分享、可刷新、可回退。

核心对象（建议统一类型）：

```ts
type AgentStatus = 'connected' | 'detected' | 'not_found' | 'degraded';
type HealthLevel = 'ok' | 'warn' | 'error';

interface AgentSummary {
  key: string;
  name: string;
  status: AgentStatus;
  transport?: 'stdio' | 'http';
  lastSeenAt?: string;
  health: HealthLevel;
}

interface SkillSummary {
  name: string;
  category: 'research' | 'coding' | 'docs' | 'ops' | 'memory';
  source: 'builtin' | 'user' | 'team' | 'imported';
  enabledAgents: string[];
}
```

## 方案

### 0) 功能优先级（MVP / Next / Later）

#### MVP（本轮必须）

- Content 路由：`/agents` + `/agents/[agentKey]`
- 顶部 segment：`Overview / MCP / Skills`
- Overview 三块：连接态势、风险动作、使用脉搏
- MCP 健康表 + 核心动作（Copy/Test/Reconnect）
- Skills 能力分组 + 来源标签 + 开关
- Agent Detail 六区块基础版

#### Next（下一阶段）

- Skill x Agent 兼容矩阵（含冲突提示）
- Connection Graph（Agent -> transport -> MCP）
- Agent Recent Activity 过滤与导出

#### Later（企业/高级）

- RBAC、审计日志、审批闸门
- 健康评分（Health Score）与自动修复建议
- 观测数据外接（OpenTelemetry / external dashboards）

#### Out of Scope（P1 明确不做）

- 不做复杂编排画布（流程拖拽式 Builder）。
- 不做企业级 RBAC/审批流完整体系。
- 不做跨团队共享运营大盘（先单用户/单工作区）。
- 不做重型时序可视化（先列表和轻量趋势图）。

### 1) 交互结构重排

1. Sidebar 中点击 `Agents` 只做导航：进入 `/agents`（不再依赖右侧详情抽屉）。
2. Content 顶部提供 segment：`Overview`、`MCP`、`Skills`。
3. 点击某 Agent 进入 `/agents/[agentKey]`，显示完整 Agent Detail 页。
4. 保留兼容期：`RightAgentDetailPanel` 可短期保留，只做跳转，不承载完整功能。

关键用户任务（JTBD）：

1. 我想知道“现在有哪些 Agent 可用，哪里有风险”。
2. 我想快速复制某个 Agent 的 MCP snippet，并立刻验证连接。
3. 我想按能力给不同 Agent 启停 Skill，并看到兼容性和冲突。
4. 我想深入看单个 Agent 最近做了什么，是否命中正确 Space。

页面级线框（低保真）：

```text
/agents (Overview)
┌──────────────────────────────────────────────┐
│ Agents                                      │
│ [Overview] [MCP] [Skills]                   │
├──────────────────────────────────────────────┤
│ Connectivity Snapshot  | Risk Action Queue  │
├──────────────────────────────────────────────┤
│ Usage Pulse (7d)                             │
└──────────────────────────────────────────────┘

/agents?tab=mcp
┌──────────────────────────────────────────────┐
│ Agents / MCP                                 │
│ [Overview] [MCP] [Skills]                    │
├──────────────────────────────────────────────┤
│ Connection Graph (light)                     │
├──────────────────────────────────────────────┤
│ Health Table [Copy] [Test] [Reconnect]       │
└──────────────────────────────────────────────┘

/agents?tab=skills
┌──────────────────────────────────────────────┐
│ Agents / Skills                              │
│ [Overview] [MCP] [Skills]                    │
├──────────────────────────────────────────────┤
│ Search | Filters                              │
├──────────────────────────────────────────────┤
│ Capability Groups + Toggles                   │
│ (Matrix on demand)                            │
└──────────────────────────────────────────────┘

/agents/[agentKey]
┌──────────────────────────────────────────────┐
│ Agent Detail                                 │
│ Identity | Connection | Capabilities         │
│ Skill Assignments | Recent Activity          │
│ Space Reach                                  │
└──────────────────────────────────────────────┘
```

### 2) Overview（可执行态势板）

Overview 采用“决策优先”结构，不做泛报表：

- **连接态势卡**：Connected/Detected/Not Found，MCP Running/Stopped。
- **风险动作队列**：例如“缺少 snippet”“连接失败”“Skill 冲突”，每条带 CTA。
- **使用脉搏**：最近 7 天调用成功率、Top Skills 命中、失败热点 Agent。

设计原则：

- 先列可执行问题，再给趋势信息。
- 每个告警都带下一步动作，不出现“看见问题但无入口”。

建议卡片字段（MVP）：

- 连接态势：`connectedCount` `degradedCount` `mcpStatus`
- 风险动作：`id` `severity` `title` `actionLabel` `actionRoute`
- 使用脉搏：`successRate7d` `topSkill3` `failedAgent3`

指标口径定义（首版固定）：

- `connectedCount`: `status=connected` 的 Agent 数。
- `degradedCount`: `status=degraded` 或最近 24h 存在连接错误的 Agent 数。
- `successRate7d`: 最近 7 天 `successRuns / totalRuns`（无数据返回 `N/A`）。
- `lastSeen`: 最近一次成功握手或工具调用时间（ISO 字符串）。
- `failedAgent3`: 最近 7 天失败次数最多的 3 个 Agent。

### 3) MCP（连接与健康）

MCP 页提供两层视图：

- **Connection Graph（轻量图）**：Agent -> transport -> MCP server，状态色表达健康。
- **Health Table（可操作表）**：Agent、Transport、Last Seen、Latency、Error、Actions。

Actions 最少包含：

- `Copy Snippet`
- `Test Connection`
- `Reconnect`
- `Open Advanced Config`

MCP Health Table 最小列集（MVP）：

- Agent
- Status
- Transport
- Last Seen
- Last Error
- Actions

连接测试交互约束：

- `Test Connection` 过程中按钮禁用并展示 loading。
- 失败时显示标准错误模板（可复制错误详情）。
- 成功后刷新该行 `Last Seen` 与 `health`。

空态与引导（MVP）：

- MCP 未启动：显示 `Start MCP` 主按钮 + `Open Docs` 次按钮。
- 无可检测 Agent：显示 `Install first agent` 引导，链接到安装文档。
- Agent 存在但无可用 snippet：显示 `Generate snippet` CTA。

### 4) Skills（能力与兼容）

Skills 页采用 capability-first 组织：

- 按能力分组（Research/Coding/Docs/Ops/Memory）。
- 每个 Skill 显示来源标签（Built-in/User/Team/Imported）。
- 提供 `Skill x Agent` 兼容矩阵：Enabled/Unsupported/Missing Dependency。
- 支持冲突提示：同能力多技能冲突、同触发词冲突。

MVP 先做：

- 分组列表 + 开关 + 来源标签 + 搜索。
- 矩阵改为“按需展开”二级面板，避免首屏过载。

关键规则：

- 禁止在 `Unsupported` 状态下开关 Skill。
- 检测到冲突时不阻塞切换，但给显式 warning 和“查看冲突详情”入口。

空态与引导（MVP）：

- 无 Skills：显示 `Create Skill` + `Import Skill`。
- 有 Skills 但全部 disabled：显示 `Enable recommended skills` 快捷动作。

### 5) Agent Detail（单 Agent 全景）

单 Agent 页固定 6 区块：

1. Identity（名称、版本、来源、最后活跃）
2. Connection（transport、auth、错误、测速、重连）
3. Capability Profile（支持能力和限制）
4. Skill Assignments（生效技能与解释）
5. Recent Activity（最近调用轨迹）
6. Space Reach（命中的 Space / INSTRUCTION 覆盖）

MVP 的 Recent Activity 不做重可视化，采用可筛选列表：

- 时间
- 任务摘要
- Space
- 结果（success/fail）
- 耗时

Space Reach 的 MVP 指标：

- 最近 7 天命中的 Space Top 5
- 命中率（有无读取对应 `INSTRUCTION.md`）
- 未命中但应命中的可疑项（规则引导）

空态与引导（MVP）：

- Agent 不存在/已卸载：toast + 自动跳回 `/agents`。
- 无活动记录：显示 `Run connection test` 与 `Open usage guide`。

### 6) 视觉与信息密度

- 保持 MindOS “Content is King”，默认表格/状态芯片，图形适度。
- 危险态统一语义色 + icon，不引入新颜色体系。
- Segment 与主信息区留足空间，避免“侧边栏式拥挤布局”。
- 高级信息默认折叠（progressive disclosure）。

## 影响范围

- **新增页面/路由**（建议）：
  - `app/app/agents/page.tsx`
  - `app/app/agents/[agentKey]/page.tsx`
- **新增/改造组件**（建议）：
  - `app/components/agents/AgentsContentPage.tsx`
  - `app/components/agents/AgentsOverviewView.tsx`
  - `app/components/agents/AgentsMcpView.tsx`
  - `app/components/agents/AgentsSkillsView.tsx`
  - `app/components/agents/AgentDetailView.tsx`
- **现有组件调整**：
  - `app/components/SidebarLayout.tsx`（Agents 点击导航行为）
  - `app/components/panels/AgentsPanel.tsx`（降级为轻量导航/入口，或并入 Content 导航）
  - `app/components/RightAgentDetailPanel.tsx`（退场或仅保留过渡用途）
- **状态层复用**：
  - `app/hooks/useMcpData.tsx` 作为主状态源

不涉及后端协议破坏；核心是前端 IA 与交互重排。

建议新增 i18n key（示例）：

- `agents.overview.riskQueue`
- `agents.mcp.testConnection`
- `agents.mcp.reconnect`
- `agents.skills.source.builtin`
- `agents.skills.conflictDetected`
- `agents.detail.spaceReach`

埋点与评估（建议新增）：

- `agents_overview_opened`
- `agents_risk_cta_clicked`
- `agents_mcp_test_clicked`
- `agents_mcp_test_succeeded`
- `agents_skill_toggled`
- `agents_detail_opened`
- `agents_detail_action_completed`

## 边界 case 与风险

### 边界 case

1. **无任何 Agent**：Overview 显示空态与引导动作，不出现空白页面。  
2. **仅有部分 Agent 支持某些 Skill**：矩阵显示 Unsupported，不允许误切换。  
3. **MCP Server 离线**：MCP 页给统一错误状态和一键恢复路径，Snippet 仍可读。  
4. **Agent 数据突变（安装/卸载）**：列表与 detail 路由需容错，detail 不存在时回退到 `/agents`。  
5. **低分辨率窗口**：Overview 卡片与表格应可纵向折叠，不丢关键 CTA。  
6. **大量 Skills（>200）**：默认只渲染可视区域并启用搜索/分组折叠。  
7. **高频状态刷新**：避免整页抖动，仅更新受影响行或卡片。  
8. **多语言切换中途发生数据更新**：界面文案稳定，数据刷新不重置 segment。

### 风险与 mitigation

- **风险 1：页面复杂度上涨**  
  - 缓解：Phase rollout；先做 Overview+Detail，再上矩阵与图。
- **风险 2：与现有 Panel 交互冲突**  
  - 缓解：保留兼容期，Panel 只做导航，功能逐步迁移。
- **风险 3：指标口径不一致**  
  - 缓解：定义统一指标字典（success/failure/latency/coverage）。
- **风险 4：信息过载导致可用性下降**  
  - 缓解：MVP 先列表后图形，复杂矩阵默认折叠并支持过滤。
- **风险 5：刷新策略引发性能问题**  
  - 缓解：增量刷新 + memo 分层 + table virtualization（Skills 大列表）。
- **风险 6：迁移期入口混乱**  
  - 缓解：所有旧入口统一跳转 `/agents`，并加一次性迁移提示。

## 验收标准

- [ ] 点击 Sidebar `Agents` 后，主区进入 `/agents`，不再依赖右侧详情抽屉完成核心任务。
- [ ] `/agents` 至少包含 `Overview`、`MCP`、`Skills` 三个 segment。
- [ ] `Overview` 提供“连接态势 + 风险动作 + 使用脉搏”三块，且每个风险有 CTA。
- [ ] `MCP` 提供连接健康表，支持 `Copy Snippet`、`Test Connection`、`Reconnect`。
- [ ] `Skills` 支持 capability 分组、来源标签、搜索和开关；矩阵可按需展开查看。
- [ ] 点击 Agent 行进入 `/agents/[agentKey]`，可见 6 区块详情。
- [ ] 在“无 Agent / MCP 离线 / 不支持 Skill”三种边界下，页面均有可理解反馈与下一步动作。
- [ ] 中英文文案完整，无新增硬编码文案与语义色违规。
- [ ] 大规模数据下（200 skills / 50 agents）页面可交互，无明显卡顿。
- [ ] 功能迁移期间，旧入口不会形成断链（都能回到 `/agents`）。

性能预算（P1）：

- [ ] `/agents` 首屏可交互时间（warm）< 1.5s。
- [ ] Skills 搜索输入后 200ms 内完成列表过滤反馈。
- [ ] 单行状态更新不触发整页重渲染（通过 profiler 验证）。
- [ ] 200 skills 场景滚动保持流畅（主观无明显卡顿）。

迁移时间线（兼容期）：

- [ ] Week 1: 新路由与新内容页上线，`RightAgentDetailPanel` 保留跳转。
- [ ] Week 2: 所有 Agent 详情动作迁移到 Content，右侧面板只提示“已迁移”。
- [ ] Week 3: 移除 `RightAgentDetailPanel` 主逻辑（可保留 feature flag 一周）。

测试矩阵（建议）：

| 维度 | 用例 | 通过标准 |
|------|------|----------|
| 路由 | Sidebar -> `/agents` | 进入 Overview，无右侧依赖 |
| 状态同步 | Skills 开关后 Overview/Detail 同步 | 2s 内一致 |
| 连接恢复 | MCP 离线 -> 测试 -> 恢复 | 状态与提示正确 |
| 边界空态 | 无 agent / 无 skills / 无活动 | 均有清晰 CTA |
| i18n | EN/ZH 切换 | 新增文案无缺失 |
| 性能 | 200 skills / 50 agents | 可交互与滚动达标 |
| 回归 | 旧入口跳转 | 无死链，无空白页 |

## 实施分期建议

### P1（1-2 周）

- 路由与基础页面骨架
- Overview / MCP / Skills 的 MVP 版本
- Agent Detail 六区块基础版

### P2（1 周）

- Skills 兼容矩阵 + 冲突提示
- MCP Connection Graph（轻量）
- Recent Activity 过滤增强

### P3（按需）

- 审计/权限/审批流
- 健康评分与自动修复建议
