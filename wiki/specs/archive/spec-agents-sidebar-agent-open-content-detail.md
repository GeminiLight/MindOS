# Spec: Agents Sidebar 点击 Agent 直达 Content 详情（P1.9）

## 目标
将 `Agents Sidebar` 中每个 Agent 的点击行为统一为“进入 Content 详情页（`/agents/[agentKey]`）”，不再打开右侧详情栏，确保用户在主内容区完整查看该 Agent 的 `skill / mcp / usage / space reach` 信息。

## 现状分析
当前行为存在路径分裂：
- 点击 Sidebar 的 `Overview/MCP/Skills` 已是 content 路由；
- 但点击 Agent 行仍走右侧 dock（`RightAgentDetailPanel`），形成“双详情入口”。

问题：
1. 心智不一致：同一 Sidebar 内部既有“内容路由”又有“右侧抽屉”。
2. 信息割裂：右侧抽屉展示偏 snippet/连接动作，不是完整 Agent 全景。
3. 复盘与分享弱：抽屉状态不可分享，刷新/回退语义弱于 URL 路由。

## 数据流 / 状态流
```text
AgentsPanelAgentListRow click
  -> Next Link href=/agents/[agentKey]
  -> app/app/agents/[agentKey]/page.tsx
  -> AgentDetailContent(agentKey)
     reads useMcpData():
       - agents (身份、状态、transport、能力)
       - status (MCP endpoint/port/auth)
       - skills (enabled skill 列表)
     renders:
       - Identity
       - Connection (MCP)
       - Capabilities
       - Skill Assignments
       - Recent Activity
       - Space Reach
```

## 方案
### UX/UI 约束（product-designer）
- **一致性**：Sidebar 的导航语义保持单一（点击=路由跳转）。
- **可理解反馈**：当前 Agent 行高亮与当前路由对齐（选中态清晰）。
- **渐进披露**：轻操作留在列表，完整信息去 Content 页，不在列表内堆叠。
- **可访问性**：行项使用可聚焦链接语义，`focus-visible` 保持设计系统一致。

### 实现设计
1. `AgentsPanelAgentListRow` 主点击控件从 button 改为 `Link`，目标为 `/agents/[agentKey]`。
2. `AgentsPanelAgentGroups` 传递详情链接，而非回调开抽屉。
3. `AgentsPanel` 选中态改为路由驱动（从 pathname 解析当前 agentKey），不依赖右侧 dock 状态。
4. 兼容期：保留 `RightAgentDetailPanel` 组件代码，但不再由 Agent 行点击触发。

### 架构评审（software-architecture）
- **Library-First**：使用 Next `Link`，不自建导航机制。
- **Clean Architecture**：列表组件只负责导航触发，详情内容继续由 `AgentDetailContent` 负责。
- **命名**：使用领域命名 `detailHref` / `activeAgentKey`，不引入泛化模块。
- **复杂度控制**：仅改动现有 panel 组件与测试；避免新增大型组件。

### Spec 自我 Review
#### 轮 1（完整性）
- 已覆盖正常流程（点击 -> 路由 -> 详情）、边界（notFound agent）、错误路径（非法 key）。
- 已给出数据流与信息落点，不与现有 content-first IA 冲突。

#### 轮 2（可行性）
- 目标路由已存在（`/agents/[agentKey]`），无需新增 API。
- 性能影响极小（从 local state 切换为路由跳转）。
- 风险主要在测试与旧抽屉兼容，已通过“保留组件但断开触发”控制。

## 影响范围
- `app/components/panels/AgentsPanelAgentListRow.tsx`
- `app/components/panels/AgentsPanelAgentGroups.tsx`
- `app/components/panels/AgentsPanel.tsx`
- `app/__tests__/panels/agents-panel-hub.test.tsx`
- `wiki/specs/spec-agents-sidebar-agent-open-content-detail.md`
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

是否破坏性变更：否（导航语义统一；右侧抽屉行为退场）。

## 边界 case 与风险
1. **空值**：`agentKey` 为空时不生成非法链接（由列表数据约束，key 必填）。
2. **字符串边界**：agent key 含特殊字符时必须 URL encode。
3. **集合边界**：notFound 分组中的 agent 仍可打开详情并显示状态信息。
4. **状态边界**：从 `/agents/[agentKey]` 返回 `/agents` 后，列表选中态应重置。
5. **时序边界**：点击 detected 行中的安装按钮不应触发导航。

已知风险：
- 旧测试若依赖 button 结构会失败。
- 若仍有其他入口打开右侧抽屉，可能形成“隐藏分叉”。

Mitigation：
- 补面板测试覆盖 `href="/agents/[agentKey]"`。
- 全局搜索 `setAgentDetailKey` 调用方，确认仅遗留兼容代码。

## 验收标准
- [ ] 点击 Agents Sidebar 任意 Agent 行，进入 `/agents/[agentKey]`。
- [ ] 点击 detected 行“安装”按钮时不会触发导航。
- [ ] 详情页可查看该 Agent 的 skill/mcp/usage/space reach 信息区块。
- [ ] Agents Sidebar 的当前行高亮与路由中的 `agentKey` 一致。
- [ ] 回归通过：`Overview/MCP/Skills` 深链导航不受影响。
- [ ] 新增/调整测试先失败后通过。
