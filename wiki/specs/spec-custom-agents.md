# Spec: 用户自定义 Agent 注册

## 目标

让用户无需修改源码，即可注册自己的 Agent（如 QCLaw、WorkBuddy、企业内部工具等），使其与内置 Agent 享有完全一致的管理能力：存在检测、MCP 安装/卸载、配置 snippet 生成、Skill 目录扫描、运行时信号可视化。

## 现状分析

当前 Agent 注册表是硬编码的 `MCP_AGENTS: Record<string, AgentDef>`（`app/lib/mcp-agents.ts`，20 个内置 Agent）。每次新增 Agent 需要：
1. 在 `app/lib/mcp-agents.ts` 添加 AgentDef（App 端）
2. 在 `bin/lib/mcp-agents.js` 添加对应条目（CLI 端）
3. 在 `SKILL_AGENT_REGISTRY` 添加 Skill 安装模式
4. 发版

**问题**：
- Agent 生态扩张极快（每月 2-3 个新 Agent），MindOS 无法覆盖所有
- 用户可能有自建/企业内部 Agent，永远不会被内置
- 用户只能在"已支持的 Agent"里选，无法管理未知 Agent

## 数据流 / 状态流

```
用户在 UI 填表 / CLI 输入
        │
        ▼
POST /api/agents/custom   ──────────► config.json.customAgents[]
        │                                     │
        ▼                                     ▼
invalidate agent cache           App 重启 / CLI 读取
        │                                     │
        ▼                                     ▼
GET /api/mcp/agents        ◄──── getAllAgents()
   mergeCustomAgents()               │
        │                            │
        ▼                            ▼
AgentInfo[]                  bin/ 命令读取 config.json
   (含 custom)                 合并到 MCP_AGENTS
        │
        ▼
Agents Dashboard / Sidebar / MCP Install / Snippet / Skills
```

**读路径**：`getAllAgents()` = `{ ...MCP_AGENTS, ...customAgentsFromConfig() }` → 下游代码（`detectInstalled`、`detectAgentPresence`、`detectAgentRuntimeSignals`、`generateSnippet` 等）全部透明兼容，无需改动。

**写路径**：CRUD API `POST/PATCH/DELETE /api/agents/custom` → 读写 `config.json.customAgents` → 触发 agent list 刷新。

## 方案

### 方案对比

```
方案 A：In-App 表单 + config.json      方案 B：手动编辑 JSON 文件
┌──────────────────────────┐          ┌──────────────────────────┐
│  Agents Dashboard        │          │  ~/.mindos/              │
│  ┌────────────────────┐  │          │  custom-agents.json      │
│  │ + Add Custom Agent │  │          │                          │
│  └────────────────────┘  │          │  (用户用编辑器打开)       │
│                          │          │  (手写 JSON)             │
│  ┌────────────────────┐  │          │  (重启 App 生效)         │
│  │ Name: [QCLaw     ] │  │          │                          │
│  │ Dir:  [~/.qclaw/  ] │  │          └──────────────────────────┘
│  │ ── Auto-filled ──  │  │          UX: ⭐⭐ (手工、无引导)
│  │ MCP: ~/.qclaw/mcp  │  │
│  │ Key: mcpServers    │  │
│  │ Fmt: json          │  │          方案 C：仅 CLI 命令
│  │    [Advanced ▼]    │  │          ┌──────────────────────────┐
│  │ [   Add Agent   ]  │  │          │ $ mindos agent add       │
│  └────────────────────┘  │          │   --name QCLaw           │
│                          │          │   --dir ~/.qclaw/        │
│  即时生效，无需重启       │          │                          │
└──────────────────────────┘          │ 交互式补全其余字段        │
UX: ⭐⭐⭐⭐⭐ (引导、即时)            └──────────────────────────┘
                                      UX: ⭐⭐⭐ (Power user 友好)
```

| 维度 | 方案 A (In-App 表单) | 方案 B (手动 JSON) | 方案 C (CLI) |
|------|---------------------|-------------------|-------------|
| 用户体验 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| 实现复杂度 | 中 | 低 | 低 |
| 可维护性 | 高 | 中 | 高 |
| 风险 | 表单校验需完善 | 格式错误难排查 | GUI 用户无感知 |

**选择：方案 A 为主入口 + 方案 C 作补充**。方案 B 太原始，且用户手写 JSON 出错时排查困难。方案 A 有智能默认值和即时验证，UX 最优。CLI 作为 Power user 备选。

### 数据模型

```typescript
/** 用户自定义 Agent 定义。存储在 config.json.customAgents[] */
interface CustomAgentDef {
  /** 显示名称 (用户输入) */
  name: string;
  /** 唯一标识符 (从 name 自动生成 slug，如 "qc-law") */
  key: string;
  /** Agent 的根目录路径 (用户输入，如 "~/.qclaw/") */
  baseDir: string;
  /** 全局 MCP 配置文件路径 (默认: baseDir + "/mcp.json") */
  global: string;
  /** 项目级 MCP 配置文件路径 (可选，默认: null) */
  project?: string | null;
  /** 配置文件中 MCP servers 的键名 (默认: "mcpServers") */
  configKey: string;
  /** 配置文件格式 (默认: "json") */
  format: 'json' | 'toml';
  /** 推荐的传输协议 (默认: "stdio") */
  preferredTransport: 'stdio' | 'http';
  /** 存在检测目录列表 (默认: [baseDir]) */
  presenceDirs: string[];
  /** 存在检测 CLI 命令名 (可选) */
  presenceCli?: string;
  /** 嵌套键路径 (如 VS Code 的 "mcp.servers"，可选) */
  globalNestedKey?: string;
}
```

**与内置 `AgentDef` 的关系**：`CustomAgentDef` 是 `AgentDef` 的超集（多了 `baseDir` 字段用于 UI 展示和默认值推断）。运行时通过 `toAgentDef(custom)` 转换为标准 `AgentDef`，下游代码无感知。

### 智能默认值推断

用户只需提供 **name** 和 **baseDir**，其余全部自动推断：

```
输入: name = "QCLaw", baseDir = "~/.qclaw/"

推断:
  key             = "qclaw"                    (slugify name)
  global          = "~/.qclaw/mcp.json"        (baseDir + "/mcp.json")
  project         = null                       (大多数 Agent 无项目级配置)
  configKey       = "mcpServers"               (MCP 标准键名)
  format          = "json"                     (绝大多数用 JSON)
  preferredTransport = "stdio"                 (最常见)
  presenceDirs    = ["~/.qclaw/"]              (= baseDir)
  presenceCli     = undefined                  (不确定，不猜测)
  globalNestedKey = undefined                  (极少数 Agent 用)
```

**Key 生成规则（slugify）**：
1. 转小写
2. 非 ASCII 字符（含中文）→ 用拼音首字母或直接移除（不做音译，太复杂）
3. 空格、下划线 → 连字符 `-`
4. 连续连字符合并为一个
5. 移除首尾连字符
6. 若结果为空 → `custom-1`、`custom-2` 递增
7. 示例：`"QC Law Pro 3.0"` → `"qc-law-pro-3-0"`，`"工作助手"` → `"custom-1"`（不做拼音）
8. 前端 UI 实时预览生成的 key，用户可在 Advanced 中手动修改

**自动检测增强**（baseDir 存在时）：
- 扫描 baseDir 下的**顶层** `*.json` / `*.toml` 文件（不递归，最多读 20 个文件名），逐个尝试 `JSON.parse` 检查是否包含 `mcpServers` 或 `servers` 键 → 命中则自动填入 `global` 和 `configKey`
- 如果发现 `*.toml` 文件 → 读取前 50 行检查是否有 `[mcp_servers` 或 `[mcpServers` section header → 命中则切换 `format` 和 `configKey`
- 如果发现 `skills/` 子目录 → 标记 Skill 安装模式为 `additional`
- **安全限制**：detect API 只接受 `~/` 开头的路径（限制在 home directory 内），其他路径返回 400

### 存储方案

`~/.mindos/config.json` 新增 `customAgents` 字段：

```json
{
  "ai": { ... },
  "mindRoot": "/Users/me/MindOS",
  "customAgents": [
    {
      "name": "QCLaw",
      "key": "qclaw",
      "baseDir": "~/.qclaw/",
      "global": "~/.qclaw/mcp.json",
      "configKey": "mcpServers",
      "format": "json",
      "preferredTransport": "stdio",
      "presenceDirs": ["~/.qclaw/"]
    }
  ]
}
```

### SKILL_AGENT_REGISTRY 扩展

自定义 Agent 默认 `mode: 'additional'`，`skillAgentName` 为其 key。如果 baseDir 下无 `skills/` 目录且无 Skill install 目录 → `mode: 'unsupported'`。

### API 设计

所有 CRUD 路由放在 `app/app/api/agents/custom/route.ts` 单文件内，通过请求体中的 `key` 区分目标。避免 Next.js App Router 需要 `[key]` 动态目录的复杂性。

```
POST   /api/agents/custom          创建自定义 Agent（body 含完整 def）
PUT    /api/agents/custom          修改自定义 Agent（body 含 key + 更新字段）
DELETE /api/agents/custom          删除自定义 Agent（body 含 key）
POST   /api/agents/custom/detect   自动检测 baseDir，返回推断的默认值
```

> 为什么用 `PUT` 替代 `PATCH`？单一 route 文件 `route.ts` 支持同名导出 `POST`、`PUT`、`DELETE`。语义上 `PUT` 也表达"替换整个 custom agent 定义"。

**POST /api/agents/custom 请求体**：
```json
{
  "name": "QCLaw",
  "baseDir": "~/.qclaw/",
  "global": "~/.qclaw/mcp.json",
  "configKey": "mcpServers",
  "format": "json",
  "preferredTransport": "stdio"
}
```
所有字段除 `name` 和 `baseDir` 外均可选，有智能默认值。

**PUT /api/agents/custom 请求体**：
```json
{
  "key": "qclaw",
  "name": "QC Law",
  "global": "~/.qclaw/config.json"
}
```
`key` 必填用于定位；其余为要更新的字段。

**DELETE /api/agents/custom 请求体**：
```json
{ "key": "qclaw" }
```

**POST /api/agents/custom/detect 请求体**：
```json
{ "baseDir": "~/.qclaw/" }
```
**安全约束**：`baseDir` 必须以 `~/` 开头（即 home 目录内），否则返回 `400 Bad Request`。
**响应**：
```json
{
  "exists": true,
  "detectedConfig": "~/.qclaw/mcp.json",
  "detectedFormat": "json",
  "detectedConfigKey": "mcpServers",
  "hasSkillsDir": false,
  "suggestedName": "Qclaw"
}
```

### CLI 支持

```bash
# 交互式添加
mindos agent add
# → 提示输入 name, baseDir（其余自动推断）

# 非交互式
mindos agent add --name QCLaw --dir ~/.qclaw/

# 列出所有自定义 Agent
mindos agent list --custom

# 删除
mindos agent remove qclaw
```

## User Flow

```
用户目标：注册一个 MindOS 不认识的 Agent，让它出现在 Agents Dashboard 中

前置条件：用户已完成 MindOS Setup，有至少一个内置 Agent 在用

Step 1: 用户打开 Agents Dashboard（/agents）
  → 系统反馈：Agent 网格末尾有 dashed "+" 卡片，文案 "Add your own agent"
  → 状态变化：无

Step 2: 用户点击 "+" 卡片
  → 系统反馈：Modal 打开（modal-backdrop 重遮罩），Phase A — 只有两个输入框
  → 系统动效：animate-in fade-in zoom-in-95，≤0.22s
  → 状态变化：Modal 打开

Step 3: 用户输入 Agent Name（如 "QCLaw"）和 Config Directory（如 "~/.qclaw/"）
  → 系统反馈：
    - name 下方实时显示 slug 预览："Key: qclaw"（text-2xs text-muted-foreground）
    - baseDir 输入框下方有 hint："Common: ~/.xxx/ or ~/Library/Application Support/"
    - Continue 按钮从 disabled → enabled（两个字段都非空时）
  → 状态变化：表单本地状态更新

Step 4: 用户点击 "Continue →"
  → 系统反馈：
    a) 客户端校验 — name 冲突检查 → 失败则 input border-error + 错误文案，不进入 Phase B
    b) 校验通过 → 按钮变 Loading（Loader2 + "Detecting..."）
    c) POST /api/agents/custom/detect 发出
    d) 成功 → 进入 Phase B，Modal 内容平滑过渡到检测结果
       - baseDir 存在：✓ "Directory found"（text-success），检测结果卡片 border-success/20
       - baseDir 不存在：ℹ "Not found yet — agent will appear when installed"（text-info），默认值卡片 border-border
    e) 检测超时（3s）→ 显示默认值 + hint "Detection timed out, using defaults"
  → 状态变化：表单从 Phase A 切换到 Phase B

Step 5: 用户查看检测/默认结果（Phase B）
  → 系统反馈：
    - 结果卡片展示：MCP Config / Format / Transport / Skills 信息
    - 底部 "Customize these settings" 折叠链接 → 点击展开 SettingCard（CSS Grid 过渡）
    - 大多数用户无需展开，直接点 "Add Agent"
  → 状态变化：无（或展开 customize 区）

Step 6: 用户点击 "Add Agent"
  → 系统反馈：
    - 按钮变 Loading（Loader2 + "Adding..."，amber CTA disabled 态）
    - 成功 → Modal 关闭 + toast.success "QCLaw added" + Dashboard 列表刷新
    - 失败 → Modal 内 error banner（border-error/30 bg-error/5）+ 按钮变 "Retry"
  → 状态变化：
    - config.json.customAgents 新增条目
    - Agent list 缓存失效
    - MCP store 刷新

Step 7: 用户在 Agent 卡片上看到新 Agent
  → 系统反馈：
    - 自定义 Agent 卡片左侧有 2px amber 边线（微妙区分，不 stigmatize）
    - 无 [Custom] badge
    - hover 时右上角出现 ··· 菜单（Edit / Remove）
    - 状态：Detected → 可安装 MindOS MCP；Not Found → 灰色提示
  → 状态变化：无

成功结果：自定义 Agent 出现在 Dashboard 中，与内置 Agent 享有相同的管理能力

异常分支：
- 异常 A：名称与现有 Agent key 冲突
  → Phase A 点击 Continue 时拦截，name 输入框 border-error
  → 提示 "Conflicts with built-in agent 'Cursor'" 或 "An agent with this key already exists"
- 异常 B：baseDir 路径格式非法（非绝对路径）
  → Phase A 点击 Continue 时拦截
  → 提示 "Must be an absolute path (e.g. ~/.qclaw/)"
- 异常 C：config.json 写入失败（磁盘满/权限不足）
  → Phase B 点击 Add Agent 后 → error banner in Modal
  → Modal 保持打开，不丢失用户输入，按钮变 "Retry"
- 异常 D：自动检测超时（baseDir 在网络挂载目录上）
  → 3 秒超时后自动使用默认值，显示 hint "Detection timed out, using defaults"
  → 不阻塞用户添加

边界场景：
- 用户输入 baseDir 但目录尚不存在（合法 — Agent 可能还没安装）
- 用户输入的 baseDir 实际上是某个内置 Agent 的目录 → 提示 "This directory is used by built-in agent 'Cursor'"
- 自定义 Agent 与后续版本新增的内置 Agent key 冲突 → 升级时标记冲突，详情页提示
```

## UI 精细化设计

### 设计决策与理由

| 决策 | 理由 |
|------|------|
| **两阶段 Modal（Phase A → Phase B）** | 认知负荷从 7 个可见元素降到 2 个。90% 的用户只需 name + baseDir → 看结果 → 一键完成 |
| **Continue → Add Agent 两步按钮** | Phase A 的 "Continue" 触发 detect + 校验；Phase B 的 "Add Agent" 提交保存。避免用户在未检测时就提交 |
| **检测结果卡片** 而非 inline 只读文本 | 结果集中在一个视觉容器中（`border-success/20 bg-success/5`），比散列的 4 行只读文本更易扫描 |
| **左侧 amber 边线** 替代 `[Custom]` badge | 微妙区分不 stigmatize；与 Settings sidebar active tab 的左侧 amber bar 视觉语言一致 |
| **Dashed "+" 卡片** 替代实心卡片 | 与 `AddAvatarButton` 的 dashed border 约定一致，传达"这是一个添加入口" |
| **复用 ConfirmDialog** | 直接复用 `AgentsPrimitives` 的 `ConfirmDialog`，保持一致性 |
| **modal-backdrop**（重遮罩） | 这是核心表单 Modal，与 Settings/Search 同级 |

### 组件技术规格

| 组件 | 规格 |
|------|------|
| Modal 容器 | `fixed inset-0 z-50 modal-backdrop`, 内容 `max-w-md rounded-xl bg-card border border-border shadow-2xl` |
| 输入框 | 复用 `Primitives.tsx` 的 `Input`（`focus-visible:ring-1 focus-visible:ring-ring`） |
| Radio 组 | `sr-only` + label card 样式（与 `ExportModal` 一致），选中 `border-[var(--amber)]/40 bg-[var(--amber-dim)]` |
| 展开收起 | CSS Grid `grid-template-rows` 过渡（禁止 `maxHeight` hack） |
| 主按钮 | `bg-[var(--amber)] text-[var(--amber-foreground)] rounded-lg`，Loading = `Loader2 animate-spin` |
| 次按钮 | `border border-border hover:bg-muted rounded-lg` |
| 删除确认 | 复用 `ConfirmDialog`，Remove = `bg-destructive text-destructive-foreground` |
| Toast | `toast.success("QCLaw added")` / `toast.error("Failed to save: ...")` |
| ARIA | `role="dialog" aria-modal="true" aria-labelledby="modal-title"` |
| 键盘 | `Escape` 关闭 Modal; `Enter` 在 Phase A 等同 Continue, Phase B 等同 Add Agent; `Tab` 正常顺序 |

## UI 状态线框图

```
┌─ "+" 卡片（Agent 网格末尾）──────────────────────────────────┐
│                                                                │
│  ┌─ Agents ──────────────────────────────────────────────────┐ │
│  │ Overview  MCP  Skills  ...                                │ │
│  │                                                           │ │
│  │ ┌─ Workspace Pulse ─────────────────────────────────┐     │ │
│  │ │  5 Connected · 3 Detected · 12 Not Found          │     │ │
│  │ └───────────────────────────────────────────────────┘     │ │
│  │                                                           │ │
│  │ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │ │
│  │ │ Claude Code  │ │ Cursor       │ │ Windsurf     │       │ │
│  │ │ ● Connected  │ │ ● Connected  │ │ ○ Detected   │       │ │
│  │ └──────────────┘ └──────────────┘ └──────────────┘       │ │
│  │                                                           │ │
│  │ ┌──────────────┐ ┌──────────────┐ ┌ ─ ─ ─ ─ ─ ─ ─ ┐    │ │
│  │ │┊ QCLaw       │ │┊ WorkBuddy   │ │      ╭─╮        │    │ │
│  │ │┊ ○ Detected  │ │┊ ○ Not Found │ │      │+│        │    │ │
│  │ │┊             │ │┊             │ │      ╰─╯        │    │ │
│  │ │┊ MCP:2 Sk:3  │ │┊ MCP:0 Sk:0  │ │ Add your own   │    │ │
│  │ └──────────────┘ └──────────────┘ │    agent        │    │ │
│  │  (amber left bar)  (amber left)   └ ─ ─ ─ ─ ─ ─ ─ ┘    │ │
│  │                                    (dashed border,        │ │
│  │                                     muted foreground,     │ │
│  │                                     hover: amber/30)      │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  Custom Agent 卡片：与内置 Agent 完全相同的 rounded-xl 卡片，  │
│  唯一区别是左侧 2px border-l-2 border-[var(--amber)]/40。      │
│  hover 时右上角出现 ··· 菜单（Edit / Remove）。                 │
└────────────────────────────────────────────────────────────────┘


┌─ Phase A：输入 Name + Directory ─────────────────────────────┐
│                                                                │
│  ┌── Add Custom Agent ─────────────────────────── [✕] ──────┐ │
│  │                                                           │ │
│  │  Agent Name                                               │ │
│  │  ┌───────────────────────────────────────────────────┐   │ │
│  │  │ e.g. QCLaw, WorkBuddy                            │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  Key: qclaw                    (text-2xs muted, 实时)    │ │
│  │                                                           │ │
│  │  Config Directory                                         │ │
│  │  ┌───────────────────────────────────────────────────┐   │ │
│  │  │ ~/.qclaw/                                        │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  Common: ~/.xxx/ or ~/Library/Application Support/       │ │
│  │                              (text-2xs muted-foreground) │ │
│  │                                                           │ │
│  │                                                           │ │
│  │                                                           │ │
│  │                      [ Cancel ]  [ Continue → ]           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  modal-backdrop (blur 8px), max-w-md                           │
│  Continue = amber CTA, disabled when fields empty              │
│  Escape → close; Enter → Continue                              │
└────────────────────────────────────────────────────────────────┘


┌─ Phase A：名称冲突 ─────────────────────────────────────────┐
│  │                                                           │ │
│  │  Agent Name                                               │ │
│  │  ┌─ border-error ───────────────────────────────────┐   │ │
│  │  │ Cursor                                           │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  ✗ Conflicts with built-in agent "Cursor"                │ │
│  │    (text-error, aria-invalid="true")                      │ │
│  │                                                           │ │
│  │                      [ Cancel ]  [ Continue → ] (disabled)│ │
└────────────────────────────────────────────────────────────────┘


┌─ Phase B：检测成功 ─────────────────────────────────────────┐
│                                                                │
│  ┌── Add Custom Agent ─────────────────────────── [✕] ──────┐ │
│  │                                                           │ │
│  │  Agent Name                                               │ │
│  │  ┌───────────────────────────────────────────────────┐   │ │
│  │  │ QCLaw                                            │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  Key: qclaw                                              │ │
│  │                                                           │ │
│  │  Config Directory                                         │ │
│  │  ┌───────────────────────────────────────────────────┐   │ │
│  │  │ ~/.qclaw/                                        │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  ✓ Directory found                       (text-success)  │ │
│  │                                                           │ │
│  │  ┌─ Detected Configuration ──────────────────────────┐   │ │
│  │  │                                                    │   │ │
│  │  │  MCP Config     ~/.qclaw/mcp.json                 │   │ │
│  │  │  Format         JSON · mcpServers                 │   │ │
│  │  │  Transport      stdio                              │   │ │
│  │  │  Skills         3 found in ~/.qclaw/skills/       │   │ │
│  │  │                                                    │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  │  (rounded-lg border-success/20 bg-success/5 p-4)         │ │
│  │                                                           │ │
│  │  [▸ Customize these settings]   (text-xs muted, 可点击)  │ │
│  │                                                           │ │
│  │                      [ Cancel ]  [ Add Agent ]            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                │
│  Add Agent = amber CTA                                         │
└────────────────────────────────────────────────────────────────┘


┌─ Phase B：目录不存在 ───────────────────────────────────────┐
│  │                                                           │ │
│  │  Config Directory                                         │ │
│  │  ┌───────────────────────────────────────────────────┐   │ │
│  │  │ ~/.qclaw/                                        │   │ │
│  │  └───────────────────────────────────────────────────┘   │ │
│  │  ℹ Not found yet — agent will appear when installed      │ │
│  │                                          (text-info)      │ │
│  │                                                           │ │
│  │  ┌─ Default Configuration ────────────────────────────┐  │ │
│  │  │                                                     │  │ │
│  │  │  MCP Config     ~/.qclaw/mcp.json                  │  │ │
│  │  │  Format         JSON · mcpServers                  │  │ │
│  │  │  Transport      stdio                               │  │ │
│  │  │                                                     │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │  (rounded-lg border-border bg-muted/30 p-4)              │ │
│  │                                                           │ │
│  │  [▸ Customize these settings]                             │ │
│  │                                                           │ │
│  │                      [ Cancel ]  [ Add Agent ]            │ │
└────────────────────────────────────────────────────────────────┘


┌─ Phase B：Customize 展开 ──────────────────────────────────┐
│  │                                                           │ │
│  │  [▾ Customize these settings]                             │ │
│  │                                                           │ │
│  │  ┌─ SettingCard ─────────────────────────────────────┐   │ │
│  │  │  (rounded-xl border-border/50 bg-card/50 p-5)     │   │ │
│  │  │                                                    │   │ │
│  │  │  MCP Config File Path                              │   │ │
│  │  │  ┌────────────────────────────────────────────┐   │   │ │
│  │  │  │ ~/.qclaw/mcp.json                          │   │   │ │
│  │  │  └────────────────────────────────────────────┘   │   │ │
│  │  │                                                    │   │ │
│  │  │  Config Key                  Format                │   │ │
│  │  │  ┌──────────────────┐   (●) JSON  (○) TOML        │   │ │
│  │  │  │ mcpServers       │                              │   │ │
│  │  │  └──────────────────┘                              │   │ │
│  │  │                                                    │   │ │
│  │  │  Transport                                         │   │ │
│  │  │  (●) stdio  (○) http                               │   │ │
│  │  │                                                    │   │ │
│  │  │  Project Config (optional)                         │   │ │
│  │  │  ┌────────────────────────────────────────────┐   │   │ │
│  │  │  │                                            │   │   │ │
│  │  │  └────────────────────────────────────────────┘   │   │ │
│  │  │                                                    │   │ │
│  │  │  CLI Binary (optional, e.g. "qclaw")               │   │ │
│  │  │  ┌────────────────────────────────────────────┐   │   │ │
│  │  │  │                                            │   │   │ │
│  │  │  └────────────────────────────────────────────┘   │   │ │
│  │  │                                                    │   │ │
│  │  └────────────────────────────────────────────────────┘   │ │
│  │                                                           │ │
│  │  CSS Grid 展开过渡: grid-rows-[0fr] → grid-rows-[1fr]    │ │
│  │  duration-200 ease-out                                    │ │
│  │                                                           │ │
│  │                      [ Cancel ]  [ Add Agent ]            │ │
└────────────────────────────────────────────────────────────────┘


┌─ 保存中 ────────────────────────────────────────────────────┐
│  │                      [ Cancel ]  [ ◌ Adding... ] (disabled)│
│  │                                   (amber CTA + Loader2)   │
└────────────────────────────────────────────────────────────────┘


┌─ 保存失败 ──────────────────────────────────────────────────┐
│  │                                                           │
│  │  ┌─ rounded-lg border-error/30 bg-error/5 p-3 ───────┐  │
│  │  │  ✗ Failed to save: disk full           (text-error) │  │
│  │  └─────────────────────────────────────────────────────┘  │
│  │                                                           │
│  │                      [ Cancel ]  [ Retry ]                │
└────────────────────────────────────────────────────────────────┘


┌─ Custom Agent 卡片 + 菜单 ──────────────────────────────────┐
│                                                                │
│  ┌──────────────────────────────────────────────┐              │
│  │┊ QCLaw                               [···]  │              │
│  │┊ ○ Detected                            │     │              │
│  │┊                                 ┌─────┴──┐  │              │
│  │┊ MCP: 2  Skills: 3              │ Edit   │  │              │
│  │┊                                 │ Remove │  │              │
│  │┊ [ Install MindOS MCP ]          └────────┘  │              │
│  └──────────────────────────────────────────────┘              │
│                                                                │
│  ┊ = border-l-2 border-[var(--amber)]/40                       │
│  ··· = opacity-0 group-hover:opacity-100 transition-opacity    │
│  菜单: bg-card border-border shadow-lg rounded-lg (Popover)    │
│  Remove: text-destructive                                      │
└────────────────────────────────────────────────────────────────┘


┌─ 编辑 Modal ────────────────────────────────────────────────┐
│                                                                │
│  与 Add Modal 完全相同布局，差异：                              │
│  - 标题为 "Edit QCLaw"（含 agent 名）                          │
│  - key 行显示为 text-muted-foreground/50（不可编辑）            │
│  - baseDir 可编辑（变更后重新 detect）                          │
│  - Customize 默认展开（编辑场景用户更可能改细节）               │
│  - 底部 [ Cancel ] [ Save Changes ]                            │
│  - Save Changes = amber CTA                                    │
│                                                                │
└────────────────────────────────────────────────────────────────┘


┌─ 删除确认 ──────────────────────────────────────────────────┐
│                                                                │
│  复用 ConfirmDialog（AgentsPrimitives.tsx）：                   │
│  overlay-backdrop, animate-in fade-in zoom-in-95               │
│                                                                │
│  ┌──────────────────────────────────────────┐                  │
│  │  Remove "QCLaw"?                         │                  │
│  │                                          │                  │
│  │  This removes the agent from MindOS.     │                  │
│  │  No files will be deleted on disk.       │                  │
│  │                                          │                  │
│  │        [ Cancel ]  [ Remove ]            │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                │
│  Remove = bg-destructive text-destructive-foreground           │
│  Cancel = border border-border hover:bg-muted                  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 状态流转图

```
[Dashboard "+" card]
       │
       │ click
       ▼
[Modal Phase A] ◄──────────────── 校验失败（name 冲突/路径非法）
  (name + dir)                          │
       │                               回到 Phase A 修改
       │ Continue →
       ▼
  ┌────┴────┐
  │         │
存在     不存在
  │         │
detect   defaults
  │         │
  └────┬────┘
       │
       ▼
[Modal Phase B]
  (结果预览)
       │
       ├── 可选: [▸ Customize] → 展开 SettingCard → 修改 → 收起
       │
       │ Add Agent
       ▼
  ┌────┴────┐
  │         │
成功      失败
  │         │
close   [error banner in Modal]
toast     Retry → POST again
refresh
  │
  ▼
[Dashboard]
       │
       ├── custom card click ──→ [Agent Detail /agents/[key]]
       │                         (与内置 Agent 详情页完全一致)
       │
       ├── custom card ··· → Edit ──→ [Edit Modal]
       │                                  │
       │                           Save Changes → refresh
       │
       └── custom card ··· → Remove ──→ [ConfirmDialog]
                                            │
                                     ┌──────┴──────┐
                                     │             │
                                  Confirm       Cancel
                                     │             │
                               DELETE API       [close]
                                     │
                              [refresh + toast "Removed"]
```

## 影响范围

### 变更文件列表

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/settings.ts` | 修改 | `ServerSettings` 新增 `customAgents` 字段 |
| `app/lib/mcp-agents.ts` | 修改 | 新增 `getAllAgents()`、`toAgentDef()`、`inferDefaults()` |
| `app/app/api/agents/custom/route.ts` | 新增 | CRUD API (POST/PUT/DELETE) for custom agents |
| `app/app/api/agents/custom/detect/route.ts` | 新增 | 自动检测 API (POST) |
| `app/components/agents/CustomAgentModal.tsx` | 新增 | 两阶段 Add/Edit Modal（Phase A: input → Phase B: detect result + customize） |
| `app/components/agents/AgentsOverviewSection.tsx` | 修改 | 网格末尾添加 dashed "+" 卡片；AgentCard 增加 amber left border 判断 |
| `app/components/agents/AgentDetailContent.tsx` | 修改 | Custom Agent 的 ··· 菜单（Edit / Remove）；复用 ConfirmDialog |
| `app/app/api/mcp/agents/route.ts` | 修改 | 从 `getAllAgents()` 读取而非直接用 `MCP_AGENTS` |
| `bin/lib/mcp-agents.js` | 修改 | 新增 `loadCustomAgents()` 同步函数（`readFileSync`），`getAllAgents()` 合并内置 + custom |
| `bin/commands/agent.js` | 修改 | 新增 `add` / `remove` 子命令 |
| `app/lib/i18n/modules/panels.ts` | 修改 | 新增 custom agent 相关 i18n 键 |

### 受影响但不需改动的模块

- `app/lib/mcp-snippets.ts` — 接受 `AgentInfo`，custom agent 转换后类型一致
- `app/components/settings/McpTab.tsx` — 消费 `AgentInfo[]`，无感知差异
- `app/components/settings/McpAgentInstall.tsx` — 同上
- MCP Server (`mcp/src/index.ts`) — 不涉及 agent 注册

### 无破坏性变更

现有内置 Agent 行为完全不变。`customAgents` 为空数组时等同于当前行为。

## 边界 case 与风险

### 边界 case

1. **key 冲突（custom vs built-in）**
   - 处理：`POST /api/agents/custom` 校验 key 不在 `MCP_AGENTS` 中
   - 报错：`"Key 'cursor' conflicts with built-in agent 'Cursor'"`

2. **key 冲突（custom vs custom）**
   - 处理：校验 key 不在已有 `customAgents` 中
   - 报错：`"An agent with key 'xxx' already exists"`

3. **baseDir 含空格 / Unicode / 特殊字符**
   - 处理：`expandHome()` 已支持。路径校验只检查不含 `\0` 和不为空
   - 风险：Windows 下 `~` 展开需用 `USERPROFILE`（已有 `expandHome` 支持）

4. **baseDir 是相对路径**
   - 处理：校验 baseDir 必须以 `~/` 或 `/` 开头（或 Windows `C:\`）
   - 报错：`"Base directory must be an absolute path (e.g. ~/.qclaw/)"`

5. **config.json 中 customAgents 被手动损坏**
   - 处理：`readSettings()` 已有 try-catch，`customAgents` 解析失败 → 视为空数组，不阻塞启动
   - 日志：`console.warn('[custom-agents] Failed to parse, using empty list')`

6. **版本升级后内置 Agent 覆盖了用户的 custom key**
   - 处理：`getAllAgents()` 中内置优先。如果发现冲突，在 `/api/mcp/agents` 响应中标记 `customOverriddenBy: 'builtin'`
   - UI：Agent 详情页显示提示 "This custom agent has been superseded by a built-in agent. You can remove your custom definition."

7. **大量自定义 Agent（>50 个）**
   - 处理：config.json 大小增加可忽略（每个 ~200 bytes）。Agent 列表已有虚拟滚动
   - 风险低

8. **编辑 custom agent 的 `global` 路径后，原有 MCP 安装配置指向旧路径**
   - 处理：编辑保存后 UI 重新调用 `detectInstalled()`，基于新路径判断安装状态
   - 用户影响：旧路径下的 MindOS MCP 配置残留，但不影响功能。如果用户需要清理可手动删除旧配置
   - 不做自动迁移（风险高于收益）

9. **key 中含 URL 不安全字符**
   - 处理：slugify 限制 key 只含 `[a-z0-9-]`，不符合的字符一律移除
   - 保证 key 可安全用于 API 路径和 CSS class

### 已知风险与 mitigation

| 风险 | 概率 | 影响 | Mitigation |
|------|------|------|-----------|
| App 和 CLI 的 customAgents 不同步 | 中 | 配置 snippet 不一致 | 两端都从 config.json 读取，无缓存 |
| 用户在升级时丢失 customAgents | 低 | 数据丢失 | customAgents 在 config.json 中，update 不清除 config |
| 自动检测误判 config 格式 | 低 | 默认值错误 | 检测结果仅作建议，用户可在 Advanced 中覆盖 |
| Path traversal 攻击 | 低 | 读任意文件 | detect API 限制 baseDir 必须以 `~/` 开头；只读目录列表（最多 20 个文件名），不读文件内容（除 JSON 解析 mcpServers key 检查外）；CRUD API 只写 config.json |

## 验收标准

### 核心功能

- [ ] `config.json` 新增 `customAgents` 字段，可存储自定义 Agent 定义
- [ ] `POST /api/agents/custom` 可创建自定义 Agent，返回成功
- [ ] `PUT /api/agents/custom` 可修改自定义 Agent（body 含 key）
- [ ] `DELETE /api/agents/custom` 可删除自定义 Agent（body 含 key）
- [ ] `POST /api/agents/custom/detect` 对存在的目录返回正确的检测结果
- [ ] `GET /api/mcp/agents` 返回的列表包含 custom agents
- [ ] Custom agent 的 `detectInstalled`、`detectAgentPresence`、`detectAgentRuntimeSignals` 均正常工作

### UI

- [ ] Agent 网格末尾有 dashed "+" 卡片（`border-2 border-dashed`），文案 "Add your own agent"
- [ ] "+" 卡片 hover: `border-[var(--amber)]/30 bg-muted/20`
- [ ] 点击 "+" 后打开 Modal（`modal-backdrop` 重遮罩），Phase A 只显示 name + dir 两个输入框
- [ ] name 输入时实时显示 slug key 预览（`text-2xs text-muted-foreground`）
- [ ] Continue 按钮在两字段都非空时才 enabled（amber CTA）
- [ ] Phase A → Phase B 过渡平滑，检测期间 Continue 变 Loading
- [ ] baseDir 存在：✓ text-success + 检测结果卡片 `border-success/20 bg-success/5`
- [ ] baseDir 不存在：ℹ text-info + 默认值卡片 `border-border bg-muted/30`（非阻塞）
- [ ] "Customize these settings" 折叠链接，CSS Grid 过渡展开 SettingCard
- [ ] 名称冲突：Phase A 点击 Continue 时拦截，`border-error` + `aria-invalid`
- [ ] Custom Agent 卡片左侧 2px amber 边线（`border-l-2 border-[var(--amber)]/40`），无 [Custom] badge
- [ ] 卡片 hover 时右上角 ··· 菜单出现（`opacity-0 group-hover:opacity-100`）
- [ ] ··· 菜单含 Edit / Remove，Remove 为 `text-destructive`
- [ ] Edit Modal 与 Add 相同布局，Customize 默认展开，key 不可编辑
- [ ] Delete 复用 `ConfirmDialog`，Remove = `bg-destructive text-destructive-foreground`
- [ ] 所有操作有 Loading 态（Loader2 animate-spin）和 Toast 反馈
- [ ] 保存失败：Modal 内 error banner（`border-error/30 bg-error/5`），按钮变 Retry
- [ ] Modal 支持 Escape 关闭、Enter 提交
- [ ] `role="dialog" aria-modal="true"` 合规

### CLI

- [ ] `mindos agent add --name QCLaw --dir ~/.qclaw/` 可添加
- [ ] `mindos agent list --custom` 只列出自定义 Agent
- [ ] `mindos agent remove qclaw` 可删除
- [ ] CLI 添加的 Agent 立即出现在 Web UI 中

### 兼容性

- [ ] 无 customAgents 字段时（旧版本升级），行为与当前一致
- [ ] customAgents 字段损坏时不阻塞 App 启动
- [ ] 内置 Agent 优先于同名 custom Agent

### i18n

- [ ] 所有用户可见文案有 EN + ZH 版本
- [ ] 无硬编码英文字符串
