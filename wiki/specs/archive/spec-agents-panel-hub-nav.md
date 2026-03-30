# Spec: Agents 面板 Hub 导航 + 可展开智能体详情

## 目标

将左侧 **Agents / 智能体** 面板顶部改为与 **Discover 探索** 面板一致的「大行导航 + 徽章」结构（Overview、MCP、Skills、Usage 等），支持「即将推出」占位；下方保留 MCP 状态与分组列表，且 **每个智能体可展开查看路径、传输方式与复制配置**，与产品「本地 MCP 中枢 + 多 Agent 连接」定位一致。

## 现状分析

- `DiscoverPanel` 已用 `NavEntry`（图标方格 + 标题 + 右侧徽标/Chevron + `Link` 或 `button`）建立可识别的「探索」视觉语言。
- `AgentsPanel` 当前直接进入 MCP 状态条与分组卡片，**缺少全局入口层级**；`AgentCard` 为扁平一行，**无法在侧边栏内查看 snippet/路径**（需去设置 → MCP & Skills）。
- `useMcpData` 已统一数据层；`generateSnippet` / `copyToClipboard` 已在 `McpTab` 验证可用，应在面板内复用而非重写。

## 数据流 / 状态流

```
SidebarLayout (McpProvider)
  └─ AgentsPanel
       ├─ useMcpData() → status, agents[], skills[], refresh, installAgent, toggleSkill
       ├─ 本地 UI state:
       │    ├─ openAgentKey: string | null（至多展开一个 Agent 详情，避免面板过长）
       │    ├─ showNotDetected, showBuiltinSkills（沿用）
       │    └─ refs → scrollIntoView（Overview / Skills 锚点）
       ├─ Hub 导航行:
       │    ├─ Overview → scroll 到 MCP 状态卡片
       │    ├─ MCP → dispatch mindos:open-settings { tab: 'mcp' }
       │    ├─ Skills → scroll 到面板内 Skills 区块
       │    ├─ Usage → <Link href="/help">
       │    └─ 一项「即将推出」（占位全局能力，无 API）
       └─ 列表行 AgentsPanelAgentListRow：点击进入详情
       └─ AgentsPanelAgentDetail：整页内容区（顶栏返回 + transport + snippet + copy）；Detected 含 Install
```

无新增 API；与设置页仍通过既有 `CustomEvent` 打开 MCP 标签。

## 方案

1. **抽取共享导航行组件**  
   新建 `app/components/panels/PanelNavRow.tsx`，导出 `PanelNavRow`（与原 `DiscoverPanel` 内 `NavEntry` 同款样式）与 `ComingSoonBadge`。`DiscoverPanel` 改为 import，消除重复，保证与探索面板风格一致。

2. **AgentsPanel 布局**  
   - `PanelHeader` 下、`overflow-y-auto` 内顶部：`py-2` 区块放置若干 `PanelNavRow`。  
   - Overview 徽章显示当前 **已连接** 数量。Hub 仅 **三行**：Overview、**MCP**（打开设置）、**Skills**（滚到面板内 Skills），不含「使用与帮助」与「智能体洞察」占位。  
   - 分隔线后接 MCP 状态卡片与列表。  
   - Skills 区块 `ref` 供 Skills 行滚动。  
   - 底部「高级配置」保留。

3. **Agent 详情为独立右侧内容页（不替换左侧列表）**  
   `AgentsPanelAgentListRow`：优化后的列表行；点击后在 **`RightAgentDetailPanel`**（桌面端固定右侧、与 Ask 面板可并排、`rightOffset` 叠放）展示 `AgentsPanelAgentDetail`（`headerVariant="dock"`：标题 + X 关闭）。左侧 Agents 面板始终保持 Hub + 列表；`SidebarLayout` 持有 `agentDetailKey` 与宽度持久化；离开 Agents 面板时 Dock 收起但可保留 key 以便返回。

4. **设计系统**  
   新增交互控件使用 `focus-visible:ring-2 focus-visible:ring-ring`；沿用面板既有色板（与现有 Agents 卡片一致），**不引入硬编码 hex**（保持与当前文件一致的语义类名）。

5. **Library-First**  
   复用 `generateSnippet`、`copyToClipboard`、`Toggle`（Skills）、`PanelHeader`；不引入新 UI 库。

6. **文件规模**  
   `AgentsPanel.tsx` 编排；Hub → `AgentsPanelHubNav.tsx`；分组列表 → `AgentsPanelAgentGroups.tsx`；列表行 → `AgentsPanelAgentListRow.tsx`；详情页 → `AgentsPanelAgentDetail.tsx`。

## 影响范围

- **变更文件**：`PanelNavRow.tsx`、`AgentsPanelHubNav.tsx`、`AgentsPanelAgentGroups.tsx`、`AgentsPanelAgentListRow.tsx`、`AgentsPanelAgentDetail.tsx`、`DiscoverPanel.tsx`、`AgentsPanel.tsx`、`i18n-en.ts`、`i18n-zh.ts`、相关测试、本 spec。
- **不受影响**：`McpTab`、API 路由、`ActivityBar` `PanelId`（仍为 `agents`）。
- **破坏性**：无；仅 UI 结构与文案扩展。

## 边界 case 与风险

| 边界 | 处理 |
|------|------|
| `agents.length === 0` 且仅有空状态 | Hub 导航仍展示；Overview 徽章为 0；列表区仍为空状态 |
| `mcp.loading` | 整页仍显示 Loader；Hub 不单独闪动 |
| 展开 Agent 时 `status === null` | `generateSnippet` 内 HTTP 使用库内默认 endpoint，与 McpTab 一致 |
| `notFound` 展开 | 不展示 snippet 控件，仅文案提示 |
| 快速连点 Install / Copy | 按钮 disabled + 现有 installing/copied 状态 |
| 键盘与无障碍 | 展开行为挂在 `button` + `aria-expanded` |

**风险**：面板纵向变长 → 依赖 `overflow-y-auto`；**缓解**：单开折叠 + 保持紧凑排版。

## 验收标准

- [ ] Hub 为三行：Overview、MCP、Skills（MCP 打开设置；Skills 滚到面板内 Skills 区）。
- [ ] Overview / Skills 滚动仍可用。
- [ ] 点击某 Agent 进入面板内详情页（非行内折叠）；返回回到列表。
- [ ] 详情页可复制配置；Detected 的 Install 仍在详情内可用。
- [ ] `DiscoverPanel` 视觉与改前一致（共享 `PanelNavRow`）。
- [ ] `npx vitest run` 全部通过；新增测试覆盖 i18n 键与静态渲染关键文案。

## 架构自检（Library-First / Clean Architecture / 命名 / 复杂度）

- **Library-First**：snippet 与剪贴板用现有模块；✓  
- **Clean Architecture**：无业务规则下沉到 UI 外新层；事件与滚动纯表现层；✓  
- **命名**：`PanelNavRow`、`AgentsPanelAgentListRow`、`AgentsPanelAgentDetail`，避免 `utils`；✓  
- **复杂度**：拆子组件后单文件 <200 行；✓  

## 自我 review

**轮 1（完整性）**：数据流已画；边界含空列表、loading、notFound、无 status；与 McpProvider 共存无冲突。  
**轮 2（可行性）**：`Tab` 含 `mcp`；`generateSnippet` 签名已存在；Vitest 可通过 mock `useMcpData` + `renderToStaticMarkup` 测静态结构；性能影响可忽略（多几个 DOM 节点）。
