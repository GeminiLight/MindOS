# Spec: Agent Panel UX Optimization

## 目标

在保留完整的多 Agent 管理能力（跨 Agent MCP 配置、跨 Agent 技能矩阵、config 探测、runtime 信号、批量操作）的前提下，优化 Agent Panel 的信息层级、视觉密度和交互效率，使其从"堆砌信息的 admin 面板"变为"高效的多 Agent 控制中心"。

## 现状分析

Agent Panel 是 MindOS 的**多 Agent 统一管理中心**，管理用户工作区中所有 AI Agent（Cursor、Claude Code、Windsurf、Codex 等）的：
- MCP 连接状态与配置
- Skill 安装、启用、编辑
- Runtime 信号探测
- 跨 Agent 的 MCP Server / Skill 共享关系

当前问题（仅限 UX 层，不涉及功能裁剪）：

1. **信息冗余**：Workspace Pulse 在所有 tab 重复出现，Overview 的 stat cards 与 Pulse 重叠
2. **Agent Detail 页**：Recent Activity 和 Space Reach 始终空白（无数据源），占据显眼位置
3. **Agent Detail 页**：Identity / Connection / Capabilities 分成 3 个独立 card，垂直滚动过长
4. **视觉层级不清**：所有信息同等权重铺开，无主次区分

## 数据流 / 状态流

```
useMcpData (McpProvider)
  ├── agents: AgentInfo[]        → 所有 Agent 的状态、config、skill mode、runtime 信号
  ├── skills: SkillInfo[]        → MindOS 管理的 skill 列表
  ├── status: McpStatus          → MindOS MCP Server 运行状态
  ├── refresh()                  → 重新拉取所有数据
  ├── toggleSkill(name, enabled) → 启用/禁用 skill
  └── installAgent(key, opts?)   → 安装 MCP 配置到指定 Agent

AgentsContentPage (路由: /agents)
  ├── tab=overview → AgentsOverviewSection  ← Pulse + Risk + Quick Info
  ├── tab=mcp      → AgentsMcpSection       ← Search + Filter + Cross-Agent Servers + Table + Bulk Reconnect
  └── tab=skills   → AgentsSkillsSection    ← Search + Filter + Cross-Agent Skills + Registry + Matrix + Groups

AgentDetailContent (路由: /agents/[agentKey])
  ├── Health Strip
  ├── Identity (merged: identity + connection + capabilities)
  ├── Skill Assignments (native installed + search/filter/toggle/edit)
  ├── Runtime & Config Signals
  └── MCP Management (snapshot + actions)
```

## 方案

### 原则

- **不裁剪功能**：所有跨 Agent 管理能力完整保留
- **信息分层**：Primary → Summary/Action → Detail 三层渐进展示
- **减少冗余**：同一指标不在多处重复
- **隐藏空态**：无数据源的功能暂时隐藏而非空白占位

### 具体改动

#### 1. AgentsContentPage — Workspace Pulse 仅在 Overview 展示

- **Before**: Pulse 在 overview/mcp/skills 三个 tab 都出现
- **After**: Pulse 数据传入 AgentsOverviewSection，仅在 overview tab 渲染
- 理由：MCP tab 和 Skills tab 有各自的 summary 区域，全局 Pulse 是冗余的

#### 2. AgentsOverviewSection — 整合 Pulse + MCP 状态

- **Before**: 3 个独立 stat cards (Connected/Detected/NotFound) + Risk Queue + Usage Pulse
- **After**: 紧凑 6 格 Pulse（Connected/Detected/NotFound/Skills/MCP/Tools）+ 条件 Risk Queue + Quick Info
- 去除 "Success Rate 7d: N/A"（无数据源）

#### 3. AgentsMcpSection — 保留全部功能，优化布局

完整保留：
- ✅ Search + Status filter + Transport filter
- ✅ Filtered summary (connected/detected/notFound counts)
- ✅ Cross-agent MCP servers (显示哪些 MCP server 被多个 Agent 共用)
- ✅ Config visibility (hidden root detection + runtime signal detection)
- ✅ Risk queue (MCP-specific: stopped/detected/notFound)
- ✅ Agent table with all actions (copy snippet / test connection / reconnect)
- ✅ Bulk reconnect
- ✅ Manage / Topology toggle

优化：
- Table action buttons 使用 group-hover 显隐，减少静态噪声
- Status 列加上 dot 指示器，提高扫描效率

#### 4. AgentsSkillsSection — 保留全部功能，优化布局

完整保留：
- ✅ Search + Source filter (All/Builtin/User)
- ✅ Status filter (All/Enabled/Disabled/Attention)
- ✅ Capability filter (Research/Coding/Docs/Ops/Memory)
- ✅ Summary (enabled/disabled/attention counts)
- ✅ Cross-agent skills (显示哪些 skill 被多个 Agent 共用)
- ✅ Registry summary (Universal/Additional/Unsupported/HiddenRoots)
- ✅ Manage view (grouped by capability + toggles)
- ✅ Matrix view (skill × agent coverage table)
- ✅ Bulk enable/disable on filtered set

优化：
- Empty groups 不渲染（减少 "No skills" 空白块）

#### 5. AgentDetailContent — 合并卡片 + 隐藏空态

- Identity + Connection + Capabilities 合并为 1 个 section（was 3）
- 移除空 Recent Activity 和 Space Reach（无数据源时不占位）
- 其他所有功能完整保留（Health Strip, Skills, Runtime Signals, MCP Management）

#### 6. AgentsPanel sidebar — 微调

- MCP status chip 抽取为局部变量消除重复 JSX
- Skills 计数使用 `active/total` 格式

## 影响范围

### 变更文件列表
- `app/components/agents/AgentsContentPage.tsx` — Pulse 只传给 Overview
- `app/components/agents/AgentsOverviewSection.tsx` — 整合 Pulse，去除冗余 stat cards
- `app/components/agents/AgentsMcpSection.tsx` — UX 微调（group-hover, status dots）
- `app/components/agents/AgentsSkillsSection.tsx` — UX 微调（empty group 不渲染）
- `app/components/agents/AgentDetailContent.tsx` — 合并 3 section 为 1，移除空态 section
- `app/components/panels/AgentsPanel.tsx` — MCP chip DRY, skills 计数格式
- `app/__tests__/agents/agents-content-dashboard.test.tsx` — 适配新 DOM 结构

### 受影响但不改的模块
- `agents-content-model.ts` — 无变化，所有 model 函数保留
- `AgentsPanelAgentGroups.tsx` / `AgentsPanelAgentListRow.tsx` — 无变化
- `RightAgentDetailPanel.tsx` — 无变化
- i18n (`i18n-en.ts`, `i18n-zh.ts`) — 无新增 key，现有 key 全部保留
- API routes — 无变化

### 破坏性变更
- 无。纯前端布局优化。

## 边界 case 与风险

1. **所有 Agent 都 connected**：Risk Queue 不渲染 → Pulse badge 显示 "Healthy" ✅
2. **MCP Server 未运行**：Pulse 中 MCP 格显示 "—"，Risk Queue 出现 error 级风险 ✅
3. **所有 skills 禁用**：Risk Queue 出现 warn 级风险，Skills tab summary 计数正常 ✅
4. **Agent Detail 无 runtime signal**：Runtime Signals section 正常显示 "No" ✅
5. **已知风险**：Overview Pulse 仅在 overview tab 出现，切换到 mcp/skills 无全局状态 → 可接受，各 tab 有自己的 summary

## 验收标准

- [ ] Overview tab 显示 Pulse strip（6 格）+ 条件 Risk Queue + Quick Info
- [ ] MCP tab 完整保留：search + status/transport filter + filtered summary + cross-agent servers + config visibility + risk queue + agent table (copy/test/reconnect) + bulk reconnect + manage/topology toggle
- [ ] Skills tab 完整保留：search + source/status/capability filter + summary + cross-agent skills + registry summary + manage view (grouped + toggles) + matrix view + bulk enable/disable
- [ ] Agent Detail：Identity/Connection/Capabilities 合并为 1 section
- [ ] Agent Detail：不显示 Recent Activity 和 Space Reach
- [ ] Agent Detail：Health Strip + Skills + Runtime Signals + MCP Management 完整保留
- [ ] 所有 22 个 agent 相关 tests 通过
- [ ] 全量 758+ tests 通过
- [ ] 无新增 TypeScript 编译错误
