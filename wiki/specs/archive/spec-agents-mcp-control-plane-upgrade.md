# Spec: Agents MCP Control Plane 升级（P1.8）

## 目标
在 `/agents?tab=mcp` 页面实现更高效的多 Agent MCP 统一管理：支持多维筛选、批量重连、风险队列与清晰反馈，帮助用户更快完成“发现问题 -> 执行动作 -> 验证恢复”闭环。

## 现状分析
当前 MCP 页面已具备基本能力（搜索、状态筛选、单行动作、图谱视图），但在多 Agent 场景仍有不足：

1. 缺少传输维度筛选（stdio/http），连接问题定位慢。
2. 只能单 Agent 重连，面对批量异常效率低。
3. 风险信息分散在表格阅读中，缺少“问题清单 + 下一步动作”。
4. 反馈粒度偏弱（用户不易判断批量动作进度和结果）。

对比 Chops/OpenWebUI/LibreChat/Langfuse/Portkey 等工具的共同特征，MCP 控制平面应同时具备：
- 操作入口集中；
- 过滤维度清晰；
- 批量动作可见且可恢复；
- 图与表分工明确。

## 数据流 / 状态流
```text
/agents?tab=mcp
  -> AgentsContentPage(tab=mcp)
    -> useMcpData()  // status, agents, installAgent, refresh
    -> model layer:
       - filterAgentsForMcpWorkspace(query, status, transport)
       - buildMcpRiskQueue(mcpRunning, buckets)
       - summarizeMcpReconnect(results)
    -> AgentsMcpSection:
       - Manage view:
         * query + status + transport filters
         * risk queue + filtered result count
         * bulk reconnect on filtered agents
         * table row actions
       - Topology view:
         * connection graph and counts
```

约束：
- 不新增后端 API，仅复用 `refresh/installAgent`。
- 不改 `AgentInfo` 基础结构。
- 批量重连基于现有 `installAgent` 串行执行。

## 方案
### UX/UI 设计约束（product-designer + ui-design-patterns）
- **Hierarchy**：先展示风险队列和筛选动作，再展示明细表。
- **Consistency**：延续 `管理/图谱` 二段结构，不引入新导航范式。
- **Feedback**：批量重连必须有 loading + 成功/失败统计 + 可重试语义。
- **Accessibility**：按钮与筛选项保持 `focus-visible`，不依赖颜色单一表达状态。
- **Progressive Disclosure**：图谱保留为二级视图，管理页优先承载操作。

### 功能实现
1. **管理视图新增传输筛选**
   - `All / stdio / http`
   - 与现有搜索和状态筛选组合生效。

2. **管理视图新增风险队列**
   - `MCP stopped`
   - `Detected agents pending configuration`
   - `Not found agents`
   - 每条风险给可执行 CTA（刷新/筛选）。

3. **管理视图新增批量重连**
   - 对当前筛选结果执行批量 `installAgent(...transport/scope)`。
   - 显示执行中与结果摘要（成功数/失败数）。

4. **结果计数和空态增强**
   - 过滤后实时显示结果数量。
   - 空态文案保持明确，可恢复。

### 架构评审（software-architecture）
- **Library-First**：不引入新依赖，复用 React + `useMcpData` + 现有按钮样式。
- **Clean Architecture**：过滤/风险/批量摘要等逻辑放入 `agents-content-model.ts`，组件仅渲染。
- **命名**：新增函数采用领域命名：
  - `filterAgentsForMcpWorkspace`
  - `buildMcpRiskQueue`
  - `summarizeMcpBulkReconnectResults`
- **复杂度控制**：
  - 单函数尽量 < 50 行；
  - 组件超过 200 行时优先拆分内部渲染块；
  - 条件分支嵌套 <= 3 层。

### 自我 Review
#### 轮 1：完整性
- 数据流已覆盖筛选、风险、批量动作、图谱与表格。
- 边界态（空结果、无 Agent、MCP 停止）均定义了行为。
- 与现有 `/agents` 路由和 IA 一致，无冲突。

#### 轮 2：可行性
- 所有功能可基于现有 API 完成，无需后端改造。
- 性能成本可控（前端过滤 + 串行批量动作）。
- 风险主要是组件复杂度增长，已通过模型抽离降低耦合。

## 影响范围
- `app/components/agents/AgentsMcpSection.tsx`
- `app/components/agents/agents-content-model.ts`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/agents/agents-content-model.test.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- `wiki/specs/spec-agents-mcp-control-plane-upgrade.md`
- `wiki/refs/multi-agent-mcp-management-tools-survey.md`
- `wiki/80-known-pitfalls.md`
- `wiki/85-backlog.md`

是否破坏性变更：否（UI 增强，API 与路由不变）。

## 边界 case 与风险
1. **空值边界**：`agents=[]` 时，批量重连按钮禁用并展示空态说明。
2. **类型边界**：未知 transport 值归入 `other`，不影响筛选稳定性。
3. **集合边界**：筛选结果 0 条时，批量动作不触发。
4. **时序边界**：批量重连执行中重复点击应被防重入。
5. **环境边界**：MCP 离线时仍可进入页面并看到风险队列，不崩溃。

已知风险：
- 串行批量重连在大量 Agent 时耗时较长。
- 风险队列仅基于当前静态状态，无法替代完整可观测链路。

Mitigation：
- 批量动作展示进度和结果摘要。
- 后续版本若引入批量 API 再替换执行层，保持 UI 语义不变。

## 验收标准
- [ ] MCP 管理页新增传输筛选（All/stdio/http）且与现有筛选组合生效。
- [ ] MCP 管理页显示风险队列，至少覆盖 MCP stopped / detected pending / not found 三类。
- [ ] 支持对筛选结果执行批量重连并显示结果摘要（成功/失败）。
- [ ] 正常路径：筛选、单条动作、批量重连可用。
- [ ] 边界路径：空数据、空筛选结果、重复点击批量动作被正确处理。
- [ ] 错误路径：批量中部分失败时有明确失败反馈，不影响成功项。
- [ ] 新增测试先红后绿，并且 `npx vitest run` 全量通过。
