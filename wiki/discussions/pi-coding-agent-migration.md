# Discussion: 是否迁移到 pi-coding-agent

> 日期：2026-03-21 | 状态：**决定不迁移** | 关联：AIP-001/002/003

## 背景

MindOS Agent 当前基于 `pi-agent-core`(0.61.0) + `pi-ai`(0.61.0) 构建。`pi-coding-agent` 是同一 monorepo (`badlogic/pi-mono`) 的上层包，提供 Skill、MCP client、Extension 等能力。评估是否应迁移以获取这些能力。

## 架构层级

```
pi-coding-agent   ← 终端编码 Agent（Skill/MCP/Extension/TUI）
       ↑ 基于
pi-agent-core     ← Agent 循环引擎（tool loop、event stream、context）  ← MindOS 当前用
       ↑ 基于
pi-ai             ← LLM 统一接口（multi-provider streaming）           ← MindOS 当前用
```

## 迁移能获得什么

| 能力 | pi-agent-core | pi-coding-agent | MindOS 当前 |
|------|:---:|:---:|:---:|
| Tool loop + streaming | ✅ | ✅ | 已有 |
| Skill YAML 发现 + 按需加载 | ❌ | ✅ | 全文注入 system prompt |
| MCP client（消费外部 MCP server） | ❌ | ✅ | 仅作为 MCP server |
| Extension 注册系统 | ❌ | ✅ | 不需要 |
| TUI 终端界面 | ❌ | ✅ | 不需要（Web UI） |
| Session 树状历史 | ❌ | ✅ | 自己实现的 ask-sessions |

真正有价值的是 **Skill YAML 按需加载** 和 **MCP client** 两项。

## 弊端分析

### 🔴 硬伤

#### 1. 包体膨胀

| 包 | 大小 |
|----|------|
| `pi-agent-core` | 240 KB |
| `pi-ai` | 3.7 MB |
| **pi-coding-agent** | **9.7 MB** |

`pi-coding-agent` 拉入大量 MindOS 不需要的依赖：
- `@mariozechner/pi-tui` — 终端 UI 框架
- `@silvia-odwyer/photon-node` — 图像处理（native binding，跨平台编译风险）
- `cli-highlight` — 终端语法高亮
- `extract-zip`、`chalk`、`strip-ansi` — 终端工具链

MindOS npm 包从 1.4MB 膨胀到 10MB+，用户首次 `npm install` 时间翻倍。

#### 2. Turbopack 兼容性雪崩

已知问题：`pi-ai` 的一个 Bedrock 动态 `import()` 导致 Turbopack 报 `Cannot find module as expression is too dynamic`。`pi-coding-agent` 有更多动态 import（extension 加载、skill 文件发现、MCP subprocess spawn），Turbopack 编译后大概率批量失败。

已踩过的坑：
- `getModel()` 返回 `undefined` 而非 throw → model 对象残缺 → 流式请求静默失败
- `openai-completions` provider 的 `detectCompat()` 对 undefined 字段报错被静默吞掉

扩大依赖面只会增加此类问题的密度。

#### 3. 控制权丧失

`createAgentSession()` 接管 system prompt 构造、tool 注册、context 管理。MindOS 当前精确控制这些：

- **System prompt**：SKILL.md + skill-rules.md + INSTRUCTION.md + README.md + CONFIG.json + target dir context，按请求动态组装
- **Tools**：20 个知识库工具，有写保护拦截 (`beforeToolCall`)、日志 (`afterToolCall`)、metrics 插桩
- **Context**：自定义 compaction 策略（`estimateTokens` + `truncateToolOutputs` + `hardPrune`）

`pi-coding-agent` 的 `DefaultResourceLoader` 假设 `AGENTS.md` + `.pi/agent/` 目录结构，不是 MindOS 的 `INSTRUCTION.md` + `CONFIG.json` 模型。适配成本高，且未来 pi 的目录约定变化会直接 break。

### 🟡 摩擦

#### 4. API 不稳定（pre-1.0）

pi-mono 当前 0.61.0。0.60 → 0.61 就有 breaking change（`getModel` 行为变化）。绑得越深，升级维护成本越高。

#### 5. 编码 Agent 的安全假设不适合知识库 Agent

`pi-coding-agent` 内置 `bashTool`、`editTool`、`writeTool`，假设 Agent 可执行任意文件系统操作。MindOS Agent 被限制在 `MIND_ROOT` 内，通过 `resolveSafe()` + `assertNotProtected()` 做沙盒。两者的安全模型根本不同。

## 替代方案（推荐）

自己实现两个缺失能力，成本更低：

### Skill YAML 按需加载（~100 行）

MindOS 的 skill 体系比 pi 简单（单个 SKILL.md + skill-rules.md）。只需：
1. 解析 SKILL.md 的 YAML frontmatter（名称、描述、触发条件）
2. Agent system prompt 只注入 frontmatter 摘要
3. Agent 调用 `load_skill` 工具时才读取完整内容

### MCP client tool adapter（~200 行）

`@modelcontextprotocol/sdk` 已在 `mcp/` 目录。只需：
1. 从 config 读外部 MCP server 列表
2. 用 SDK 的 `Client` 连接 + `tools/list`
3. 把 MCP tool 转为 `AgentTool` 格式注入 Agent

## 决定

**不迁移到 pi-coding-agent。** 继续基于 `pi-agent-core` + `pi-ai`，自己实现 Skill loader 和 MCP client adapter。

- 包体不膨胀
- 不引入 Turbopack 兼容性风险
- 保留对 system prompt / tools / context 的完全控制
- 自己实现的两个模块更贴合 MindOS 的知识库场景

后续如果 pi-mono 发布 1.0 且 headless SDK 成熟（剥离 TUI 依赖），可重新评估。

## 后续 AIP

- **AIP-010: Skill YAML 按需加载** — progressive disclosure，减少 context 占用
- **AIP-011: MCP client adapter** — 消费外部 MCP server 工具，扩展 Agent 能力
