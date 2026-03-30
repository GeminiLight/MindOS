# Spec: Agents Sidebar MCP/Skill 跳转 Content Panel + 多 Agent 管理优化

## 目标

当用户在 `Agents` Sidebar 点击 `MCP` 或 `技能` 时，直接进入主内容区的对应 Content Panel（`/agents?tab=mcp`、`/agents?tab=skills`），并补充高效管理多 Agent 的筛选与聚焦能力，减少在 Sidebar 与 Settings 间来回跳转。

## 现状分析

当前 `Agents` Sidebar 中：

- `MCP` 行点击会打开高级设置（Settings MCP Tab），不是 Content Panel。
- `技能` 行点击只在 Sidebar 内滚动，不会切换到 `/agents?tab=skills`。
- 多 Agent 管理主要依赖内容页表格浏览，缺少快速筛选（例如只看 Not found/Detected）。

这会导致用户在“发现问题 -> 进入处理页面”的路径上出现割裂：

- 看到 `MCP` 行后进入的是设置页，不是与当前上下文一致的内容页。
- “技能”入口与技能管理主界面不一致，增加学习成本。

## 数据流 / 状态流

```text
Agents Rail click
  -> left Agents panel open

AgentsPanelHubNav rows click
  Overview -> route /agents
  MCP      -> route /agents?tab=mcp
  Skills   -> route /agents?tab=skills

AgentsContentPage(tab)
  -> useMcpData() as single source
  -> AgentsMcpSection:
      - status filter (all/connected/detected/notFound)
      - search query (agent name)
      - filtered rows render
  -> AgentsSkillsSection:
      - existing search/source filter
      - matrix remains progressive disclosure
```

约束：

- 不新增后端 API。
- 不改变 `useMcpData` 返回结构。
- Sidebar 行为仅作为导航入口，核心操作在 Content 页完成。

## 方案

### UX / UI 设计约束（先行）

- **信息架构一致性**：Sidebar 的 `Overview/MCP/技能` 与 Content 页 tab 一一映射。
- **动作闭环**：在 Content 页内直接完成筛选、复制、测试、重连、开关技能。
- **渐进披露**：高级矩阵仍保持折叠，默认展示最常用管理信息。
- **反馈清晰**：筛选状态可见、无结果有明确空态文案与恢复动作提示。

### 具体实现

1. `AgentsPanelHubNav` 改为 `href` 导航：
   - Overview -> `/agents`
   - MCP -> `/agents?tab=mcp`
   - Skills -> `/agents?tab=skills`
2. `AgentsMcpSection` 增加管理效率能力：
   - Agent 搜索输入框（按名字过滤）
   - 状态筛选 chips（All / Connected / Detected / Not found）
   - 表格只渲染筛选结果并显示空态文案
3. i18n 新增对应文案（中英文）。
4. 测试覆盖：
   - Sidebar Hub 导航链接正确。
   - MCP tab 渲染筛选控件和空态文案入口。

### 架构评审（software-architecture）

- **Library-First**：复用现有 React state + `useMcpData` + Tailwind，不引入新库。
- **Clean Architecture**：过滤逻辑提取到 `agents-content-model.ts`（领域函数），UI 只消费结果。
- **命名**：新增函数使用领域命名（如 `filterAgentsByStatus`），不使用 `utils/helpers/common/shared`。
- **复杂度控制**：新增函数 < 50 行；组件文件维持 < 200 行，必要时拆分。

### 自我 Review（>= 2 轮）

#### 轮 1：完整性

- 覆盖入口（Sidebar）和主操作区（Content）。
- 覆盖正常、空结果、状态筛选等边界。
- 与现有 `/agents` 路由和 Rail 行为兼容，不破坏已有流程。

#### 轮 2：可行性

- 所需数据全部来自 `useMcpData.agents`。
- 现有 UI 组件可直接支持（按钮、输入框、table）。
- 性能风险低：纯前端过滤，数据量在当前场景可控。

## 影响范围

- `app/components/panels/AgentsPanelHubNav.tsx`
- `app/components/agents/AgentsMcpSection.tsx`
- `app/components/agents/agents-content-model.ts`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/panels/agents-panel-hub.test.tsx`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`

## 边界 case 与风险

1. **空搜索结果**：显示“无匹配 Agent”而不是空白表格。
2. **仅 Not found Agent**：筛选后仍可复制 snippet/查看动作入口。
3. **MCP status 缺失**：筛选和表格仍能渲染（使用默认值）。
4. **路由切换频繁**：Sidebar 点击不应造成 panel 状态错乱或闪动。

风险与缓解：

- 风险：Sidebar 与 Content 映射不一致导致混淆。  
  缓解：固定 URL 映射并在测试中断言 href。
- 风险：过滤逻辑散落组件导致维护成本上升。  
  缓解：统一放到 `agents-content-model.ts`。

## 验收标准

- [ ] 点击 Sidebar `MCP` 行会进入 `/agents?tab=mcp`。
- [ ] 点击 Sidebar `技能` 行会进入 `/agents?tab=skills`。
- [ ] MCP 内容页具备 `搜索 + 状态筛选`，可过滤 Agent 列表。
- [ ] MCP 筛选结果为空时显示明确空态提示文案。
- [ ] 现有 `Copy/Test/Reconnect` 动作仍可用。
- [ ] 中英文 i18n 新增文案完整，无硬编码新文案。
- [ ] 新增/更新测试先红后绿，相关测试通过。
