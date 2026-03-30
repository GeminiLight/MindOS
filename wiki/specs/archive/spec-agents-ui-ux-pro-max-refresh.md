# Spec: Agents 全页面 UI/UX Pro Max 刷新

## 目标
将 `/agents` 的 Overview / MCP / Skills / Agent Detail 四个核心内容页升级为“高信息密度但低认知负担”的控制台体验：首屏可快速判断健康度，操作路径短，状态反馈明确，视觉层级统一且可访问。

## 现状分析
当前 Agents 页面功能已较完整，但 UX 存在 4 个问题：

1. **信息入口分散**：用户进入任意 tab 后，很难在首屏把握全局状态（连接数、风险、配置覆盖）。
2. **视觉层级偏平**：大部分内容都在同一权重卡片内，缺少“概览层 → 操作层 → 明细层”结构。
3. **操作反馈弱聚合**：批量/筛选/重连/启停动作有结果文案，但缺少稳定、可扫的状态栏与摘要。
4. **详情页长度与密度失衡**：Agent Detail 可编辑能力强，但信息块串行堆叠，决策成本高。

## 数据流 / 状态流
```text
useMcpData()
  -> status / agents / skills / loading
  -> AgentsContentPage
       -> build header insight metrics (connected/detected/notFound/risk/skills)
       -> pass buckets + metrics into:
            AgentsOverviewSection
            AgentsMcpSection
            AgentsSkillsSection
  -> AgentDetailContent
       -> build detail health chips (connection/runtime/native scan)
       -> render operation sections (skills/mcp) with clearer hierarchy
```

## 方案
### UX/UI 设计约束（product-designer + ui-design-patterns + ui-ux-pro-max）
- **首屏可判定**：每个 tab 顶部必须有统一的“状态摘要带”，用户 3 秒内知道系统健康度与优先事项。
- **层级清晰**：信息布局遵循“摘要 → 可执行动作 → 数据表/明细”三层，不把所有内容塞进一个平面列表。
- **反馈持续可见**：批量动作、筛选结果、运行状态要在固定区域反馈，避免“点击后找不到结果”。
- **可扫可读**：关键统计使用小型指标卡；长列表使用截断 + 计数 + 空态；避免首屏被细节淹没。
- **可访问与一致性**：保留 `focus-visible:ring-ring`、token 色彩与现有字体体系，不引入新依赖和新主题体系。

### 实现设计
1. **Agents 全局头部升级（`AgentsContentPage`）**
   - 新增统一“Workspace Pulse”摘要栏：连接、待配置、未检测、风险数、已启用技能。
   - 该摘要在 overview/mcp/skills 三页均可见，消除“切 tab 丢全局态”。
2. **Overview 信息架构重排（`AgentsOverviewSection`）**
   - KPI 卡片保留，但补充“健康结论 + 风险分级标签 + 下一步提示”。
   - 把 Usage Pulse 调整为“运营摘要”，突出可执行含义。
3. **MCP 管理页强化（`AgentsMcpSection`）**
   - 新增筛选摘要条（当前筛选下 connected/detected/notFound 计数）。
   - 风险区增强层级（error/warn 视觉区分），bulk action 反馈固定显示在同一区块。
4. **Skills 管理页强化（`AgentsSkillsSection`）**
   - 新增技能状态摘要条（enabled/disabled/attention）。
   - 强化“当前筛选上下文”提示，降低矩阵与管理视图切换成本。
5. **Agent Detail 体验升级（`AgentDetailContent`）**
   - 新增顶部“Agent health strip”：连接、配置、运行信号、原生扫描概览。
   - 原生安装技能与 MCP servers 区块改为可扫列表样式（count + chips + more）。
   - 保留现有管理能力（启停、编辑、重连）不减功能。

### 架构评审（software-architecture）
- **Library-First**：不新增第三方依赖，复用现有 React + Tailwind + model 函数。
- **Clean Architecture**：状态推导留在内容页/model，UI 组件专注渲染与交互，不把业务计算塞进 JSX。
- **命名**：新增字段/文案采用 `workspacePulse`、`healthStrip`、`summary*` 等领域命名，避免 `utils/helpers/common/shared`。
- **复杂度预算**：
  - 复杂推导优先抽 `useMemo` 或 model 小函数，单函数控制在 50 行内。
  - 若组件超过 200 行且新增逻辑继续增长，优先拆子组件（例如 summary chip row）。
  - 条件嵌套不超过 3 层。

### 自我 Review
#### 轮 1：完整性
- 已覆盖四个核心页面，不只修一个细节组件。
- 明确了摘要层、操作层、明细层三层结构与反馈路径。
- 包含空态、筛选、批量反馈等关键 UX 触点。

#### 轮 2：可行性
- 所需数据都已存在于 `useMcpData`（无需后端新接口）。
- UI 增强对现有 API 与测试兼容，风险可控。
- 性能影响小：仅新增 `useMemo` 统计，不引入重型渲染。

## 影响范围
- `app/components/agents/AgentsContentPage.tsx`
- `app/components/agents/AgentsOverviewSection.tsx`
- `app/components/agents/AgentsMcpSection.tsx`
- `app/components/agents/AgentsSkillsSection.tsx`
- `app/components/agents/AgentDetailContent.tsx`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- `wiki/specs/spec-agents-ui-ux-pro-max-refresh.md`
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

破坏性变更：无（仅 UI/UX 与文案增强）。

## 边界 case 与风险
1. **空值边界**：`agents=[]` 或 `skills=[]` 时摘要栏、各区块需显示 0 与明确空态文案。
2. **字符串边界**：超长 agent 名称/路径在摘要和 chips 中需截断，不撑破布局。
3. **集合边界**：大量 skills/mcp servers 时使用分组/截断展示，避免首屏过长。
4. **时序边界**：批量动作进行中重复点击，按钮需禁用且反馈持续可见。
5. **状态边界**：tab 切换后摘要与筛选状态需保持一致，不出现错位统计。

已知风险与缓解：
- 风险：新增文案键导致 i18n 不一致。
  - 缓解：en/zh 同步补齐并跑全量测试。
- 风险：组件体积进一步变大。
  - 缓解：优先复用已有组件模式，必要时拆摘要子组件。

## 验收标准
- [ ] `/agents` 三个 tab 顶部均展示统一 Workspace Pulse 摘要栏。
- [ ] Overview 风险队列可区分风险等级并提升可读性。
- [ ] MCP 页在筛选后可显示结果摘要（connected/detected/notFound）。
- [ ] Skills 页可显示技能状态摘要（enabled/disabled/attention）。
- [ ] Agent Detail 顶部新增 health strip，并保留管理动作可用。
- [ ] 正常路径：有数据时各统计与列表显示正确。
- [ ] 边界路径：空数据/超长文本时布局不崩且文案明确。
- [ ] 错误路径：操作失败时反馈不消失、页面不崩溃。
- [ ] 测试先红后绿，且全量 `npx vitest run` 通过。
