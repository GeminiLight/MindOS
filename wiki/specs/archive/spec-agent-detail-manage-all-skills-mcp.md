# Spec: Agent Detail 全量 Skills/MCP 管理与编辑工作台

## 目标
将 `/agents/[agentKey]` 从“状态展示页”升级为“可管理、可编辑”的内容工作台：用户可直接查看该 Agent 的全部 Skill/MCP 配置，并完成常见管理动作（启停、编辑、自愈重连、复制配置）而无需跳转 Settings。

## 现状分析
当前 Agent Detail 存在明显信息与操作缺口：

1. Skills 仅展示“已启用列表”，看不到已禁用项与来源，无法就地启停或编辑。
2. MCP 仅展示 endpoint/port/auth 等运行态字段，缺少该 Agent 的配置路径、scope、安装状态与修改入口。
3. Recent Activity 仍为占位文案，整体“可操作性”弱，用户需要来回跳转到 `MCP`、`Skills` 页面或 Settings。

这与用户期望的“统一管理多个 Agent 配置信息和可视化信息”不一致，导致学习成本与操作路径过长。

## 数据流 / 状态流
```text
/agents/[agentKey]
  -> AgentDetailContent
    -> useMcpData() // agents, skills, toggleSkill, installAgent, refresh, status
    -> detail model derivation:
       - allSkills (enabled + disabled)
       - skill groups (builtin/user + enabled/disabled)
       - mcp config snapshot (installed/scope/transport/configPath)
       - runtime signals (hidden root, session/usage signal)
    -> user actions:
       - toggle skill (single)
       - edit user skill (read -> update via /api/skills)
       - reconnect/reconfigure MCP (installAgent with scope/transport)
       - copy snippet and refresh
```

## 方案
### UX/UI 设计约束（product-designer + ui-design-patterns）
- **信息优先**：首屏显示该 Agent 的“配置 + 可操作项”，而不是重复展示全局概览。
- **可扫可改**：Skills 使用“搜索 + 分组 + 就地动作”模式；MCP 使用“配置快照 + 操作按钮”模式。
- **即时反馈**：所有按钮必须有 loading/success/error 反馈，避免“点击没反应”。
- **一致性**：沿用当前 card、`focus-visible:ring-ring`、状态色 token，不引入新视觉体系。
- **渐进披露**：默认展示常用动作（toggle/reconnect/copy）；编辑器仅在展开编辑时出现。

### 实现设计
1. **Agent Detail: Skills 管理区**
   - 展示该 Agent 视角下“全部 skills”（enabled + disabled）。
   - 支持 search、source 分组（builtin/user）、状态标记。
   - 支持单项启停（`mcp.toggleSkill`）。
   - 对 user skill 提供“读/编辑/保存”（复用 `/api/skills` `read` + `update`）。
2. **Agent Detail: MCP 管理区**
   - 展示该 Agent 的配置快照：`installed/scope/transport/configPath/format`。
   - 支持按钮：`复制 snippet`、`刷新`、`重连 stdio`、`重连 http`、`按项目/全局重配（按能力门控）`。
   - 所有动作复用 `installAgent`/`refresh`，避免新增后端接口。
3. **细节模型抽离**
   - 将 detail 推导函数放入 `agents-content-model.ts`（或 detail 专用模型文件）：
     - `filterSkillsForAgentDetail`
     - `groupSkillsForAgentDetail`
     - `resolveAgentMcpSnapshot`

### 架构评审（software-architecture）
- **Library-First**：不新增第三方依赖；复用已有 API 与 `useMcpData`。
- **Clean Architecture**：技能筛选与分组逻辑放模型层；组件只消费结果与触发动作。
- **命名**：采用领域命名（`AgentMcpSnapshot`、`AgentSkillListState`），避免 `utils/helpers/common/shared`。
- **复杂度预算**：
  - 单函数尽量 < 50 行；
  - `AgentDetailContent` 超过 200 行时拆为子组件；
  - 分支嵌套不超过 3 层。

### 自我 Review
#### 轮 1：完整性
- 覆盖了用户诉求：展示全部 skill/mcp + 管理/编辑 + UX 反馈。
- 明确了数据流、动作流、错误反馈路径（read/update/toggle/reconnect）。
- 与 content-first 路由一致，不引入新导航分叉。

#### 轮 2：可行性
- 所有动作可由现有 API 支撑：`/api/skills` + `/api/mcp/install` + `/api/mcp/agents`。
- 需要新增的主要是前端编排与状态管理，可在当前架构内实现。
- 性能风险可控：skills 量级 < 500，前端筛选即可；后续再考虑虚拟列表。

## 影响范围
- `app/components/agents/AgentDetailContent.tsx`
- `app/components/agents/agents-content-model.ts`（或 detail 模型新文件）
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- （如拆分）`app/components/agents/AgentDetail*.tsx`
- `wiki/specs/spec-agent-detail-manage-all-skills-mcp.md`
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

破坏性变更：无（UI 增强，API 不变）。

## 边界 case 与风险
1. **空值边界**：`skills=[]` 时要显示空态与引导文案，不崩溃。
2. **类型边界**：`configPath` 缺失或 `transport` 为未知值时，回退到 `preferredTransport`/`N/A`。
3. **字符串边界**：搜索包含特殊字符、超长文本时过滤逻辑稳定。
4. **时序边界**：用户连续点击 toggle/reconnect，需防重入和正确反馈。
5. **环境边界**：`/api/skills read/update` 失败时保留编辑内容并显示错误。

已知风险与缓解：
- 风险：Detail 页状态变多，组件复杂度上升。
  - 缓解：先拆子组件，再加功能；模型逻辑独立。
- 风险：用户误解技能编辑可影响 builtin skill。
  - 缓解：builtin 仅支持启停，不显示编辑按钮；文案明确。

## 验收标准
- [ ] Agent Detail 显示该 Agent 视角下全部 skills（非仅 enabled）。
- [ ] Agent Detail 支持单 skill 启停，且反馈明确。
- [ ] Agent Detail 对 user skill 支持 read + edit + save。
- [ ] Agent Detail 显示该 Agent MCP 配置快照（installed/scope/transport/configPath）。
- [ ] Agent Detail 支持 MCP 管理动作（复制 snippet / 重连 / 刷新）。
- [ ] 正常路径：skills+mcp 数据完整展示，操作成功可见。
- [ ] 边界路径：空数据/无权限/未知 transport 时页面可恢复。
- [ ] 错误路径：skill 保存失败、mcp 重连失败有错误反馈且不崩溃。
- [ ] 测试遵循先红后绿，相关测试通过并全量 `npx vitest run` 通过。
