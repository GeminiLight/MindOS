# Spec: Agent Panel 统一体验重构

## 目标

将 Agent/MCP/Skills 相关操作从"3 处分散"收敛为"侧边栏操作中心 + 设置系统管理"双层结构，让 80% 的高频操作（查状态、复制 config snippet、toggle Skill）在侧边栏内闭环完成，无需跳转到设置页。

## 现状分析

Agent 相关功能散落在 3 个位置，各自独立 fetch 数据、互不同步：

| 位置 | 做了什么 | 问题 |
|------|---------|------|
| **侧边栏 AgentsPanel** | MCP Server 状态卡片 + Agent 三组列表（Connected/Detected/Not Found） + Detected 一键安装 | Connected Agent 点了没反应；安装后要去设置拿 snippet |
| **设置 → MCP & Skills** | Server 状态（重复）+ Config Snippet 生成器 + Batch Agent Install + Skills 全量 CRUD | Snippet 生成器藏在设置深处，最高频操作在最远的地方 |
| **设置 → Agents tab** | Agent 行为参数（maxSteps、thinking 等） | 和前两者功能无关，但名字容易混淆 |

**核心痛点**：用户在侧边栏看到 Detected Agent，想拿配置 snippet 去 IDE 粘贴——必须去设置 → MCP & Skills → 选 Agent → 选 transport → 展开 JSON → Copy。完成"连接新 Agent"需要 6 次导航，跨越 2 个界面。

**数据割裂**：侧边栏和设置各自调 `GET /api/mcp/status` + `GET /api/mcp/agents`，toggle Skill 在设置里操作后侧边栏不知道，反之亦然。

## 数据流 / 状态流

### 当前：两条独立数据管道

```
SidebarLayout
├── AgentsPanel
│   └── useEffect → fetch /api/mcp/status + /api/mcp/agents  ←── 管道 A（30s 轮询）
│       └── local state: agents[], mcpStatus
│
└── SettingsModal → McpTab
    ├── McpTab useEffect → fetch /api/mcp/status + /api/mcp/agents  ←── 管道 B（打开时 fetch）
    │   └── local state: agents[], mcpStatus（与 A 不同步）
    └── SkillsSection
        └── useEffect → fetch /api/skills  ←── 管道 C
```

问题：
- A toggle Skill → C 不知道 → 设置里显示旧状态
- B install Agent → A 不知道 → 侧边栏需要等 30s 轮询才更新
- snippet 生成逻辑在 `McpServerStatus.tsx` 里，侧边栏无法复用

### 目标：共享数据层 + 单一状态源

```
SidebarLayout
└── McpProvider                             ←── 单一数据源
    ├── state: { status, agents, skills }
    ├── refresh()                           ←── 统一刷新
    ├── toggleSkill(name, enabled)          ←── 操作即时同步
    └── installAgent(key, opts)
        │
        ├── AgentsPanel（消费 context）
        │   ├── MCP 状态一行
        │   ├── Agent 列表 + 展开 snippet
        │   └── Skills toggle 区
        │
        └── SettingsModal → McpTab（消费同一 context）
            ├── Batch Install
            ├── Skills CRUD
            └── Server 配置
```

关键组件的读写关系：

```
                    ┌──────────────┐
                    │  McpProvider  │
                    │  (Context)   │
                    └──────┬───────┘
                           │ provides: status, agents, skills, refresh
                    ┌──────┴───────┐
                    │              │
            ┌───────▼──────┐ ┌────▼────────────┐
            │ AgentsPanel  │ │ McpTab (设置)    │
            │              │ │                  │
            │ READS:       │ │ READS:           │
            │  status      │ │  status, agents  │
            │  agents      │ │  skills          │
            │  skills      │ │                  │
            │              │ │ WRITES:          │
            │ WRITES:      │ │  batch install   │
            │  toggleSkill │ │  skills CRUD     │
            │  installAgent│ │  server config   │
            │              │ │  toggleSkill     │
            └──────────────┘ └─────────────────┘
```

Snippet 生成：

```
Agent 数据 (AgentInfo)
   + MCP 状态 (McpStatus: endpoint, token)
   + Transport 选择 (stdio | http)
   ↓
generateSnippet(agent, status, transport)   ←── 抽为 shared util
   ↓
{ snippet: string, displaySnippet: string, path: string }
   ↓
AgentCard 展开区 / McpServerStatus         ←── 两处复用同一函数
```

## 方案

### Phase 1：抽取 shared util + 共享数据层

**1.1 抽取 snippet 生成逻辑**

新建 `app/lib/mcp-snippets.ts`，从 `McpServerStatus.tsx` 移出：
- `generateStdioSnippet(agent: AgentInfo): ConfigSnippet`
- `generateHttpSnippet(agent: AgentInfo, endpoint: string, token?: string, maskedToken?: string): ConfigSnippet`
- `interface ConfigSnippet { snippet: string; displaySnippet: string; path: string }`

`McpServerStatus.tsx` 改为 import from `@/lib/mcp-snippets`。

**1.2 创建 McpProvider**

新建 `app/hooks/useMcpData.tsx`：

```typescript
interface McpContextValue {
  status: McpStatus | null;
  agents: AgentInfo[];
  skills: SkillInfo[];
  loading: boolean;
  refresh: () => Promise<void>;
  toggleSkill: (name: string, enabled: boolean) => Promise<void>;
  installAgent: (key: string, opts?: { scope?: string; transport?: string }) => Promise<boolean>;
}
```

- 30s 自动轮询 agents/status（仅当 document visible）
- Skills 只在首次 + 手动 refresh 时 fetch
- `toggleSkill` 乐观更新本地 state + 异步 PATCH
- `installAgent` 调 POST `/api/mcp/install` + 自动 refresh

挂载位置：`SidebarLayout` 里，`WalkthroughProvider` 同级。

### Phase 2：AgentsPanel 重构

**2.1 Agent 展开区加 config snippet**

`AgentCard` 改为：所有状态（connected/detected/notFound）点击都可展开，展开区显示：
- Transport 切换（Local / Remote，和设置里的 toggle 一样）
- Config snippet 代码块（用 `generateStdioSnippet` 或 `generateHttpSnippet`）
- Copy 按钮 + 目标配置文件路径
- Detected 状态额外显示 `[Connect]` 安装按钮

**2.2 新增 Skills toggle 区**

AgentsPanel 底部新增 Skills 区：
- Custom Skills 默认展开：每行 = name + toggle
- Built-in Skills 折叠
- `[+ New]` 按钮 → 打开设置 MCP tab 并定位到 Add Skill
- Toggle 调 `McpProvider.toggleSkill()`

**2.3 底部 "Advanced Config" 链接**

点击 → `window.dispatchEvent(new CustomEvent('mindos:open-settings', { detail: { tab: 'mcp' } }))`

### Phase 3：设置 McpTab 瘦身

- **移除** `McpServerStatus.tsx` 中的 Server 状态展示（侧边栏已覆盖）
- **移除** Config Snippet 生成器 UI（侧边栏已覆盖）
- **保留** Batch Agent Install（低频高级操作）
- **保留** Skills 完整 CRUD（搜索/编辑/删除/创建/语言切换）
- **保留** Server 端口/Token 配置入口
- **改造** McpTab 消费 `useMcpData()` context 而非自己 fetch

Tab 名改为 **"MCP Server"**（设置 tabs 配置更新）。

### Phase 4：清理

- 删除 `AgentsPanel` 和 `McpTab` 中各自的 fetch 逻辑
- 删除 `McpServerStatus.tsx` 中不再使用的 UI 部分
- i18n 清理无用 key + 新增 key

## 影响范围

### 新建文件

| 文件 | 说明 |
|------|------|
| `app/lib/mcp-snippets.ts` | Snippet 生成纯函数（从 McpServerStatus 抽出） |
| `app/hooks/useMcpData.tsx` | McpProvider context + shared hook |

### 修改文件

| 文件 | 改动 |
|------|------|
| `app/components/panels/AgentsPanel.tsx` | 大改：消费 McpProvider、AgentCard 展开显示 snippet、新增 Skills toggle 区、底部加 Advanced Config 链接 |
| `app/components/settings/McpServerStatus.tsx` | snippet 生成逻辑移到 `mcp-snippets.ts`；移除 Server 状态 UI；保留为设置内部使用的 snippet 显示组件 |
| `app/components/settings/McpTab.tsx` | 消费 McpProvider 而非自己 fetch；移除重复的 Server 状态区 |
| `app/components/settings/McpSkillsSection.tsx` | 消费 McpProvider.skills 而非自己 fetch；toggleSkill 调 context |
| `app/components/settings/McpAgentInstall.tsx` | 接收 agents from context prop |
| `app/components/SidebarLayout.tsx` | 挂载 `<McpProvider>` |
| `app/lib/i18n-en.ts` | 新增 panels.agents.snippet/copy/transport 等 key；设置 tab 名 mcp → mcpServer |
| `app/lib/i18n-zh.ts` | 对应中文 |

### 不受影响的模块

| 模块 | 原因 |
|------|------|
| `settings/AgentsTab` | 管理 Agent 行为参数（maxSteps 等），和 MCP 连接无关 |
| `ActivityBar` | Agents 按钮不变，还是 toggle Agents panel |
| `HomeContent` | 无 Agent 相关内容 |
| API 路由 (`/api/mcp/*`, `/api/skills`) | 接口不变，只是前端调用方式改变 |

### 无破坏性变更

所有 API 接口、localStorage key、后端配置格式保持不变。变更仅限前端组件层。

## 边界 Case 与风险

### 边界 Case

| # | 场景 | 处理 |
|---|------|------|
| 1 | **MCP Server 未启动** | McpProvider.status = null；AgentsPanel 显示 `MCP ○ Stopped`；snippet 区域仍可显示（stdio 模式不依赖 server） |
| 2 | **零个 Agent** | agents=[] 时显示 empty state "No agents detected — install an AI coding tool to get started" |
| 3 | **Snippet 生成时无 authToken** | http snippet 不含 Authorization header；显示 amber 警告 "No auth token — set in Advanced Config" |
| 4 | **用户在设置里 toggle Skill，同时侧边栏打开** | McpProvider 是单一状态源，两边消费同一 state，即时同步 |
| 5 | **30s 轮询期间 installAgent 被调用** | installAgent 完成后立即 refresh()，不等轮询；轮询用 `AbortController` 避免竞态 |
| 6 | **侧边栏 Agents panel 未 active 时** | McpProvider 仍维护 state（因为设置可能在用），但停止 30s 轮询 |
| 7 | **移动端（<768px）** | AgentsPanel 在 mobile drawer 内不可见；Skills toggle 通过设置操作 |
| 8 | **TOML 格式 Agent（如 Zed）** | snippet 生成函数已支持 TOML，从 McpServerStatus 原样迁移 |

### 风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| McpProvider 挂载层级高，所有子组件 re-render | 性能影响 | context value 用 `useMemo` 包裹；status/agents/skills 分离为 3 个 sub-context 或用 `useContextSelector` |
| 从设置移除 Server 状态后用户找不到 | 用户困惑 | 侧边栏底部 "Advanced Config →" 链接明确指向设置；设置 MCP tab 保留 endpoint + copy 功能 |
| AgentCard 展开 snippet 导致面板过长 | 侧边栏拥挤 | 同一时间只展开一个 Agent（accordion 行为）；snippet 区最大高度 200px + scroll |

## 验收标准

### 功能

- [ ] 侧边栏 AgentsPanel Connected Agent 点击展开，显示 config snippet + Copy 按钮
- [ ] Copy 按钮复制 snippet 到剪贴板，toast 提示 "Copied"
- [ ] Detected Agent 展开显示 Connect 按钮 + 安装后自动显示 snippet
- [ ] Not Found Agent 展开显示 snippet + 手动安装说明
- [ ] Transport Local/Remote 切换后 snippet 实时更新
- [ ] Skills 区显示所有 Skills，toggle 可用，状态与设置页同步
- [ ] "Advanced Config →" 点击打开设置 MCP tab
- [ ] 设置 McpTab 不再重复显示 Server 状态卡片和 snippet 生成器

### 数据一致性

- [ ] 侧边栏 toggle Skill → 打开设置 MCP tab → Skill 状态已更新
- [ ] 设置里 batch install Agent → 侧边栏 Agent 列表即时刷新（≤2s）
- [ ] installAgent 后无重复 fetch（只触发一次 refresh）

### 质量

- [ ] `npx tsc --noEmit` 无新增 TS 错误
- [ ] `npx vitest run` 全部通过
- [ ] 中英文切换后所有新增文案正确显示
- [ ] 侧边栏同一时间只展开一个 AgentCard（accordion）
- [ ] snippet 代码块最大高度 200px，超出 scroll
