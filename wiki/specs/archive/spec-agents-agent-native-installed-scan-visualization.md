# Spec: Agents 原生已安装 Skill/MCP 扫描与可视化

## 目标
在 `/agents` 与 `/agents/[agentKey]` 中展示“每个 Agent 本机真实已配置内容”，明确回答用户最关心的两件事：该 Agent 当前到底配置了哪些 MCP server、安装了哪些 skills，并支持基于这些真实扫描结果进行管理动作。

## 现状分析
当前实现存在“可管理但不够真实”的问题：

1. Agent 详情页 skill 列表来自 `/api/skills`（MindOS 全局视角），不是 agent 目录视角。
2. `/api/mcp/agents` 只检测 `mindos` 条目是否安装，没有暴露该 agent 配置中的全部 MCP server。
3. 用户无法快速判断“这个 Agent 真实配置了什么”，导致“信息量几乎为零”的体感。

## 数据流 / 状态流
```text
GET /api/mcp/agents
  -> app/lib/mcp-agents.ts
     - detectInstalled(agentKey)                    // mindos 安装状态（已有）
     - detectAgentPresence(agentKey)                // agent 存在性（已有）
     - resolveSkillWorkspaceProfile(agentKey)       // skill 模式/工作目录（已有）
     - detectAgentRuntimeSignals(agentKey)          // runtime 信号（已有）
     - detectAgentConfiguredMcpServers(agentKey)    // 解析 global/project 全部 MCP server（新增）
     - detectAgentInstalledSkills(agentKey)         // 扫描 agent skill 目录（新增）
  -> AgentInfo[] enriched with native scan fields

McpProvider(useMcpData)
  -> agents[] in shared context

UI
  -> /agents/[agentKey] 展示:
     - configuredMcpServers
     - installedSkillNames
     - source path / scope summary
```

## 方案
### UX/UI 设计约束（product-designer + ui-design-patterns）
- **真实性优先**：展示“扫描结果”，并标注来源目录/配置路径，避免与“可启用项”混淆。
- **可扫性**：列表优先显示 count + top items，支持展开查看全量，避免一屏过载。
- **状态反馈完整**：空目录/未配置/读取失败分别有文案，不使用笼统 “N/A”。
- **一致交互**：沿用现有 card 与 `focus-visible:ring-ring`，保持信息架构一致。

### 实现设计
1. **数据模型扩展（AgentInfo）**
   - 新增字段：
     - `configuredMcpServers: string[]`
     - `configuredMcpServerCount: number`
     - `configuredMcpSources: string[]`（如 `global:~/.claude.json`）
     - `installedSkillNames: string[]`
     - `installedSkillCount: number`
     - `installedSkillSourcePath?: string`
2. **领域层新增函数（mcp-agents.ts）**
   - `detectAgentConfiguredMcpServers(agentKey)`：
     - 解析 global/project 配置中的全部 server key（json/jsonc/toml）。
     - 去重后返回列表与来源 scope/path。
   - `detectAgentInstalledSkills(agentKey)`：
     - 基于 `resolveSkillWorkspaceProfile` 的 workspace 扫描技能目录。
     - 识别目录名并返回已安装 skill 列表（按字母排序）。
     - 读取失败容错返回空列表，不抛 500。
3. **API 层统一（/api/mcp/agents）**
   - 将新增扫描字段合并到 `AgentInfo` 返回。
4. **UI 可视化落点（AgentDetailContent）**
   - Skills 区增加“Agent native installed skills”摘要与列表。
   - MCP 管理区增加“Configured MCP servers”摘要与列表。
   - 列表支持截断显示 + “+N more”。

### 架构评审（software-architecture）
- **Library-First**：不引入新依赖，复用已有 `fs/path` + parser 逻辑。
- **Clean Architecture**：扫描与解析放 `app/lib/mcp-agents.ts`，组件只消费字段。
- **命名**：使用 `detectAgentConfiguredMcpServers`、`detectAgentInstalledSkills` 等领域命名，禁止泛化目录名。
- **复杂度预算**：
  - 每个新函数控制在约 50 行，超出则拆 helper；
  - `AgentDetailContent` 若超过 200 行继续拆子组件；
  - 分支嵌套不超过 3 层。

### 自我 Review
#### 轮 1：完整性
- 覆盖了“扫描什么、返回什么、展示什么、失败怎么反馈”。
- 数据流明确从 agent 本地配置/目录到 API 再到 UI。
- 与现有 `P2.0/P2.1` 架构兼容，不引入新路由。

#### 轮 2：可行性
- 所需 API 与路径信息已具备（`MCP_AGENTS`、`resolveSkillWorkspaceProfile`）。
- json/toml 解析能力已有，可复用并扩展。
- 文件系统扫描受限于目录规模，加入排序/截断与容错后性能可控。

## 影响范围
- `app/components/settings/types.ts`
- `app/lib/mcp-agents.ts`
- `app/app/api/mcp/agents/route.ts`
- `app/components/agents/AgentDetailContent.tsx`
- `app/lib/i18n-en.ts`
- `app/lib/i18n-zh.ts`
- `app/__tests__/api/mcp-install.test.ts`
- `app/__tests__/agents/agents-content-dashboard.test.tsx`
- `wiki/specs/spec-agents-agent-native-installed-scan-visualization.md`
- `wiki/85-backlog.md`
- `wiki/80-known-pitfalls.md`

是否有破坏性变更：无（字段新增 + UI增强）。

## 边界 case 与风险
1. **空值边界**：agent 工作目录不存在，`installedSkillNames` 必须为空数组。
2. **字符串边界**：skill/mcp 名称含特殊字符，展示层不应截断成非法字符序列。
3. **集合边界**：MCP server 数量很多时，UI 仅首屏展示前 N 条并可提示剩余数量。
4. **环境边界**：目录权限不足或配置损坏时，接口仍返回 200 且字段可回退。
5. **状态边界**：已检测到 agent 但配置为空，应显示“未配置任何 server/skill”而非“错误”。

已知风险与缓解：
- 风险：不同 agent 的 TOML/JSON 结构差异导致漏检。
  - 缓解：复用现有 parser 并对 `Record<string, unknown>` 做宽松提取。
- 风险：扫描结果与用户预期的“可启用 skill 列表”混淆。
  - 缓解：文案明确标注 “installed in agent workspace” 与 “global skill catalog”。

## 验收标准
- [ ] `GET /api/mcp/agents` 返回每个 agent 的 `configuredMcpServers` 与 `installedSkillNames`。
- [ ] 配置存在多 MCP server 时，返回列表包含全部 server key（非仅 `mindos`）。
- [ ] 目录存在多个已安装 skill 时，返回列表包含全部技能目录名。
- [ ] Agent Detail 页面可视化展示上述两类扫描结果（含 count + 空态）。
- [ ] 正常路径：有配置有目录时正确显示列表。
- [ ] 边界路径：空配置/空目录时显示空态，不崩溃。
- [ ] 错误路径：读取异常时接口不 500，UI可恢复展示。
- [ ] 测试先红后绿，且全量 `npx vitest run` 通过。
