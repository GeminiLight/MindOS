# Spec: Agents 多 Agent 配置与可视化统一工作台

## 目标
让用户在 `/agents` 内统一查看并管理多 Agent 的 MCP 配置状态、Skill 安装模式与本地隐藏目录运行信号（如 `~/.claude`），减少在多个页面和本地目录之间来回切换。

## 现状分析
当前页面已具备 MCP/Skills 的基础管理能力，但“统一管理”仍有缺口：

1. MCP 视图主要看连接状态，缺少“配置落点 + 隐藏目录信号”的并排信息。
2. Skills 视图聚焦技能本身，缺少“每个 Agent 的 skill 模式（universal/additional）”可视化入口。
3. Agent 详情页的 Recent Activity 仍是占位，未消费 `~/.claude` 等隐藏目录信号。

因此用户虽然能“操作”，但很难快速判断“哪个 Agent 的配置是完整的、哪个 Agent 有真实运行迹象、问题应先在 MCP 还是 Skill 侧处理”。

## 数据流 / 状态流
```text
GET /api/mcp/agents
  -> app/lib/mcp-agents.ts
     - detectInstalled()                // MCP 已配置状态
     - detectAgentPresence()            // agent 可执行/目录存在
     - detectAgentRuntimeSignals()      // 隐藏目录会话/usage信号（新）
     - resolveSkillWorkspaceProfile()   // skill 模式与路径（新）
  -> returns AgentInfo[] with unified fields

McpProvider(useMcpData)
  -> fetch /api/mcp/agents
  -> agents[] in shared context

UI consumption
  -> /agents?tab=mcp: risk + config/runtime summary
  -> /agents?tab=skills: skill registry summary by agent mode
  -> /agents/[agentKey]: detail "runtime/config signals" cards
```

## 方案
### UX/UI 设计约束
- 统一语义：MCP/Skills/Detail 都基于同一份 `agents[]` 信号，不做各自定义义。
- 首屏可扫：管理页新增聚合摘要（计数）而不是堆大量细节表格。
- 可恢复反馈：当隐藏目录不存在或无信号时，明确显示“无信号”，不显示空白。
- 一致交互：继续沿用现有 card + token + `focus-visible:ring-ring`。

### 实现设计
1. **数据层统一**
   - 扩展 `AgentInfo`，新增：
     - `skillMode` / `skillAgentName` / `skillWorkspacePath`
     - `hiddenRootPath` / `hiddenRootPresent`
     - `runtimeConversationSignal` / `runtimeUsageSignal`
     - `runtimeLastActivityAt`
   - 在 `app/lib/mcp-agents.ts` 增加两个领域函数：
     - `resolveSkillWorkspaceProfile(agentKey)`
     - `detectAgentRuntimeSignals(agentKey)`
2. **API 层统一**
   - `GET /api/mcp/agents` 返回上述统一字段，前端不再自行拼装。
3. **可视化落点**
   - MCP 管理页：新增“配置可见性摘要”。
   - Skills 管理页：新增“Agent Skill Registry 摘要”。
   - Agent 详情页：新增“Runtime & Config Signals”区块，替换空占位观感。

### 架构评审
- **Library-First**：不引入新依赖；目录扫描使用 Node 内置 `fs/path`。
- **Clean Architecture**：隐藏目录识别和 skill 模式推导放 `mcp-agents.ts`，组件只展示结果。
- **命名**：使用 `resolveSkillWorkspaceProfile`、`detectAgentRuntimeSignals` 等领域命名，避免 `utils/helpers/common/shared`。
- **复杂度预算**：
  - 新增函数控制在 50 行附近，超出则拆小函数；
  - UI 文件尽量不新增深嵌套分支；
  - 条件分支保持 <= 3 层。

## 影响范围
- `app/lib/mcp-agents.ts`
- `app/app/api/mcp/agents/route.ts`
- `app/components/settings/types.ts`
- `app/components/agents/AgentsMcpSection.tsx`
- `app/components/agents/AgentsSkillsSection.tsx`
- `app/components/agents/AgentDetailContent.tsx`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/api/mcp-install.test.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

是否有破坏性变更：无（字段追加、UI 增强）。

## 边界 case 与风险
1. **空值边界**：`presenceDirs` 为空时，隐藏目录信号必须安全降级为 `false/null`。
2. **字符串边界**：路径包含空格或中文，展示层不得截断成非法路径。
3. **集合边界**：扫描目录中文件过多时需限制遍历深度/数量，防止阻塞请求。
4. **环境边界**：目录无权限读取时，捕获异常并返回“无信号”而不是 500。
5. **状态边界**：Agent 已 present 但 runtime 信号为空，视为“已安装但未观测到活动”。

已知风险与缓解：
- 风险：不同 Agent 的隐藏目录结构不一致导致漏检。
  - 缓解：采用关键词信号扫描（session/history/usage/token）+ 容错，不写死单文件。
- 风险：字段增多导致测试 mock 失配。
  - 缓解：先改测试红灯，再补全 mock 和断言。

## 验收标准
- [ ] `GET /api/mcp/agents` 返回 skill 模式与隐藏目录 runtime 信号字段。
- [ ] MCP 页面能看到多 Agent 的配置可见性摘要（非空占位）。
- [ ] Skills 页面能看到多 Agent 的 skill 模式摘要（universal/additional）。
- [ ] Agent 详情页展示 runtime/config signals（隐藏目录、信号、最后活动时间）。
- [ ] 正常路径：存在隐藏目录信号时正确显示。
- [ ] 边界路径：无目录/无权限/空目录不崩溃，显示“无信号”。
- [ ] 错误路径：目录扫描异常不影响 `GET /api/mcp/agents` 主请求成功。
- [ ] 测试遵循先红后绿，相关测试通过。
