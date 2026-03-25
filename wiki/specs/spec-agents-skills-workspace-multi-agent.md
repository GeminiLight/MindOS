# Spec: Agents Skills Workspace 多 Agent 管理升级

## 目标
将现有偏“单技能开关”的 Skills 页面升级为可管理多 Agent、多技能集合的工作台，用户可在 30 秒内完成以下任务：

1. 快速定位问题技能（未启用、来源、能力组、风险项）。
2. 以过滤结果为单位执行批量操作（批量启用/批量停用）。
3. 在矩阵中按 Agent 维度查看技能覆盖与可用性，减少来回切换。
4. 保持与 MCP 页面一致的信息架构（页内分段、状态反馈、可恢复）。

## 现状分析
当前 Skills 管理存在三个核心不足：

1. **只支持逐条操作**：每次只能切一个 skill，面对几十个 skills 成本高。
2. **缺少工作视图**：没有“启用中/已禁用/需关注”等运营视角，问题定位慢。
3. **多 Agent 语境弱**：虽然有矩阵，但无法从 Agent 角度快速聚焦。

对比同类产品（例如 Chops）的启发：其核心价值在“跨工具统一视图 + 可检索 + 可批量组织”。MindOS 当前数据模型暂不支持真正的 per-agent skill assignment，但可先构建“多维筛选 + 批量动作 + Agent 聚焦矩阵”的工作台作为 P1.7。调研记录见 `wiki/refs/chops-skills-management-research.md`。

## 数据流 / 状态流
```text
Sidebar -> /agents?tab=skills
  -> AgentsContentPage(tab=skills)
    -> useMcpData()  // skills, agents, toggleSkill
    -> derive workspace model (pure functions):
       - skill status buckets (enabled/disabled/attention)
       - filtered skills by query/source/status/capability/agentFocus
       - matrix columns by agent focus
       - bulk candidates and execution plan
    -> AgentsSkillsSection renders:
       - Manage view (filters + list + bulk actions)
       - Matrix view (agent-focused matrix + summary)
    -> user action:
       - single toggle -> mcp.toggleSkill(name, enabled)
       - bulk toggle -> sequential toggleSkill plan + progress feedback
```

关键约束：

- 不改后端 API，不改 `SkillInfo` 数据结构。
- 批量操作通过现有 `toggleSkill` 逐条调用实现。
- 业务推导逻辑集中到 `agents-content-model.ts`，UI 只消费结果。

## 方案
### UX/UI 设计约束（product-designer + ui-design-patterns）
- **Discoverability**：在 Skills 页首屏可见“筛选 + 批量动作”，不隐藏在二级菜单。
- **Progressive Disclosure**：默认进入 `管理` 视图，`矩阵` 用分段切换展示。
- **Feedback completeness**：批量操作必须有 loading/success/error 三态反馈。
- **Empty/Error friendliness**：过滤无结果与批量失败都要可恢复（清空筛选/重试）。
- **Consistency**：交互样式复用当前 token（`--amber`、`focus-visible:ring-ring`），不新增视觉体系。

### 功能设计（P1.7）
1. **Skills 管理视图升级**
   - 新增过滤维度：`状态(All/Enabled/Disabled/Needs Attention)`。
   - 保留现有维度：搜索、来源、能力分组。
   - 新增批量操作：`启用筛选结果`、`停用筛选结果`。
   - 顶部显示结果计数与批量执行进度。

2. **Skills 矩阵视图升级**
   - 新增 Agent 聚焦：`All Agents` + 单 Agent 快速选择。
   - 矩阵顶部显示列数与技能覆盖摘要。
   - 当无 Agent 或过滤后空列时给出清晰空态。

3. **MCP 页同构化增强（小步）**
   - 保持已实现的 `管理/图谱` 分段。
   - 在管理视图中补充“筛选结果计数”，与 Skills 页口径一致。

### Library-First + Clean Architecture 评审结论
- **Library-First**：继续使用现有 React + `useMcpData` + `Toggle`；不引入新状态库。
- **Clean Architecture**：新增推导函数放到 `agents-content-model.ts`，避免 JSX 中硬编码规则。
- **命名治理**：使用领域命名（`filterSkillsForWorkspace`、`buildSkillAttentionSet`），避免 `utils/helpers/common/shared`。
- **复杂度预算**：
  - 函数 < 50 行；
  - 文件 < 200 行优先；若超出则拆组件；
  - 条件嵌套 <= 3 层，优先早返回。

### 自我 review（两轮）
#### 轮 1：完整性
- 已覆盖用户三大任务：定位、批量动作、Agent 视角校验。
- 已覆盖空状态、执行反馈、失败恢复。
- 与现有 `/agents` 信息架构一致，不引入新导航路径。

#### 轮 2：可行性
- 所有数据可从 `useMcpData` 获取；无需后端改动。
- 批量操作使用现有 API 串行执行可落地。
- 性能风险可控（过滤在前端，列表规模 < 500 时无阻塞；必要时后续再虚拟滚动）。

## 影响范围
- `app/components/agents/agents-content-model.ts`
- `app/components/agents/AgentsSkillsSection.tsx`
- `app/components/agents/AgentsMcpSection.tsx`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- `app/__tests__/agents/agents-content-model.test.ts`（新增）
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

破坏性说明：
- 无 API 破坏。
- 无路由破坏。
- 仅 UI 行为增强，老入口兼容。

## 边界 case 与风险
1. **空值边界**：`skills=[]`、`agents=[]` 时，管理与矩阵均展示可操作空态。
2. **字符串边界**：搜索关键字超长（>1000）或包含特殊字符，过滤不抛错。
3. **集合边界**：筛选后 0 项时，批量按钮应禁用且给出提示。
4. **时序边界**：批量执行中用户再次点击批量按钮，必须防重入。
5. **状态边界**：切换视图（管理/矩阵）不应丢失当前筛选状态。

已知风险与缓解：
- 风险：批量请求逐条调用可能耗时长。
  - 缓解：显示进度与可见反馈；后续可考虑后端批量端点。
- 风险：SkillsSection 组件复杂度上升。
  - 缓解：先提取模型函数与小组件，必要时二次拆分。
- 风险：当前模型不支持真正 per-agent skill 开关，用户误解“矩阵可编辑”。
  - 缓解：矩阵只做可视化与聚焦，不提供单元格编辑，文案明确“兼容视图”。

## 验收标准
- [ ] Skills 管理视图新增状态过滤（All/Enabled/Disabled/Needs Attention）。
- [ ] Skills 管理视图支持批量启用/停用筛选结果，含 loading 与结果反馈。
- [ ] Skills 矩阵支持 Agent 聚焦（All + 单 Agent）。
- [ ] Skills 与 MCP 的页内分段结构一致（管理优先，二级视图可切换）。
- [ ] 正常路径：筛选、单条开关、批量开关可用。
- [ ] 边界路径：空数据、空结果、重复点击批量按钮被正确处理。
- [ ] 错误路径：批量中某些 skill toggle 失败时，界面显示失败计数并可重试。
- [ ] 新增/更新测试先红后绿，并且 `npx vitest run` 全量通过。
