# Spec: Agents Content Dashboard UX/UI Polish（P1.5）

## 目标

在已上线的 `/agents` Content 化架构基础上，提升可读性、可操作性和一致性，使用户在 10 秒内完成“识别问题 → 找到入口 → 执行动作”。

本次重点：

1. 强化导航可用性（tab 语义、状态清晰、键盘友好）。
2. 强化 MCP 连接理解（轻量 Connection Graph + 健康表联动）。
3. 强化 Skills 可管理性（搜索、来源过滤、按需兼容矩阵）。
4. 强化 Agent Detail 信息层次（关键区块更易扫读，空态更明确）。

## 现状分析

当前 `/agents` 已具备 P1 功能，但仍有 UX 缺口：

- 分段导航视觉存在，但语义不完整（对辅助技术不够友好）。
- MCP 页偏“表单化/列表化”，用户较难快速形成连接心智模型。
- Skills 在数量增大时缺少检索和聚焦手段。
- Detail 页信息可用但偏“平铺文本”，扫描成本较高。

这些问题不会阻断功能，但会拉高学习成本，影响高频管理效率。

## 数据流 / 状态流

```
ActivityBar Agents click
  -> /agents?tab=overview|mcp|skills

AgentsContentPage
  -> useMcpData() [status, agents, skills, actions]
  -> derive model:
       - buckets(connected/detected/notFound)
       - riskQueue
       - capabilityGroups
       - filteredSkills(query, source)
       - compatibilityMatrix(skill x agent)

AgentDetailContent (/agents/[agentKey])
  -> useMcpData()
  -> resolve agent + status + effectiveSkills
  -> render modules (identity/connection/capabilities/activity/reach)
```

说明：

- 不新增后端 API，本次只在前端进行体验增强。
- 所有导出模型逻辑放在 `agents-content-model.ts`，UI 组件只消费结果。

## 方案

### 1) 导航语义和交互增强

- 将段落导航补齐 `tablist/tab/tabpanel` ARIA 语义。
- 明确 active tab 的视觉和可访问状态（`aria-selected`、`aria-controls`）。
- 保持路由兼容：`/agents` 与 `?tab=...`。

### 2) MCP 页面轻量可视化

- 新增 “Connection Graph（light）” 区块：
  - 左侧 Agent 节点（connected/detected/notFound）
  - 右侧 MCP server 节点
  - 用状态颜色和计数表达连通情况
- 下方保留健康表，形成“图（理解）+ 表（操作）”双层结构。

### 3) Skills 页面管理增强

- 增加 search 输入框（按名称/描述过滤）。
- 增加来源过滤（All / Built-in / Custom）。
- 增加按需展开兼容矩阵（accordion），避免首屏过载。
- 支持空结果态和清空过滤动作。

### 4) Agent Detail 信息层次优化

- 在 6 个模块中加入更清晰的标题层级和状态 badge。
- 保留“无活动/无触达”的友好空态与建议动作文案。
- 不引入复杂图表，保持内容密度与可维护性平衡。

### 5) 架构与代码约束（软件架构评审结论）

- **Library-First**：继续复用 `useMcpData`、`Toggle`、`copyToClipboard`、`generateSnippet`；不新增状态库。
- **Clean Architecture**：衍生逻辑只放 `agents-content-model.ts`，避免散落在 JSX。
- **命名**：新增文件采用领域命名（`AgentsSkillsFilters` 风格），禁止 `utils/helpers/common/shared`。
- **复杂度控制**：
  - 新增函数尽量 < 50 行；
  - 单文件目标 < 200 行（必要时拆分 sections）；
  - 嵌套不超过 3 层。

### 6) 自我 Review（两轮）

#### 轮 1：完整性

- 覆盖了导航、MCP、Skills、Detail 四大视图。
- 数据流与状态流明确，边界包含空态和大列表。
- 与现有 `/agents` 路由架构不冲突。

#### 轮 2：可行性

- 所需数据均来自 `useMcpData`，无需新增 API。
- 仅前端增强，版本兼容风险低。
- 复杂度可控，主要风险在 UI 文件膨胀，已通过组件拆分控制。

## 影响范围

- 代码：
  - `app/components/agents/AgentsContentPage.tsx`
  - `app/components/agents/AgentDetailContent.tsx`
  - `app/components/agents/agents-content-model.ts`
  - `app/lib/i18n-en.ts`
  - `app/lib/i18n-zh.ts`
  - `app/__tests__/agents/agents-content-dashboard.test.tsx`
- 文档：
  - 本 spec
  - `wiki/85-backlog.md`（完成项）
  - `wiki/80-known-pitfalls.md`（新坑）

不涉及后端协议和数据结构破坏。

## 边界 case 与风险

1. **空数据**：无 agents 或无 skills 时，展示可执行空态。  
2. **大数据**：skills > 200 时，过滤响应需要稳定。  
3. **状态抖动**：轮询刷新不应造成整页闪烁。  
4. **错误路径**：缺失 agentKey 时 detail 要回退提示。  
5. **语言切换**：过滤与展开状态不应被重置。  

风险与缓解：

- 风险：组件体积继续膨胀  
  - 缓解：按 section 拆分，模型逻辑抽离到 `agents-content-model.ts`。
- 风险：视觉强化影响一致性  
  - 缓解：继续使用现有 design token 与语义色，禁止硬编码色值。

## 验收标准

- [ ] `/agents` 导航具备 tab 语义（tablist/tab/tabpanel）。
- [ ] MCP 页显示 Connection Graph（light）与健康表。
- [ ] Skills 页支持搜索和来源过滤。
- [ ] Skills 页兼容矩阵默认折叠，可按需展开。
- [ ] Agent Detail 六区块保持可读层次，空态清晰。
- [ ] 新增测试覆盖正常路径 + 边界路径 + 错误路径。
- [ ] `npx vitest run` 全量通过。
- [ ] UI 截图更新到 `/tmp/`（overview/mcp/skills/detail）。
