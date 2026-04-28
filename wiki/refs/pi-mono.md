# Pi Mono

> 终端 AI 编程 Agent 全家桶，极度可扩展，反 Claude Code 哲学。

## 基本信息

| 字段 | 值 |
|------|---|
| Repo | [badlogic/pi-mono](https://github.com/badlogic/pi-mono) |
| 作者 | Mario Zechner ([@badlogic](https://github.com/badlogic)) — libGDX 作者 |
| License | MIT |
| Stars | 2300+ issues，活跃度极高 |
| 语言 | TypeScript (Node.js ≥ 20) |
| 安装 | `npm install -g @mariozechner/pi-coding-agent` |
| 最新版 | v0.59.0 (2026-03) |
| 网站 | [shittycodingagent.ai](https://shittycodingagent.ai) / [pi.dev](https://pi.dev) |
| Discord | [社区](https://discord.com/invite/3cU7Bz4UPx) |

## 定位

**终端交互式 AI 编程 Agent**，类似 Claude Code / Cursor，但核心极简、通过扩展系统实现一切：

- 不内置 sub-agents → 用 Extension 或 tmux 自己搭
- 不内置 plan mode → 用 Extension 实现
- 不内置 MCP → 用 Extension 实现
- 不内置权限弹窗 → 用 Extension 实现自定义确认流
- 不内置 TODO 管理 → 用文件或 Extension

口号："Adapt pi to your workflows, not the other way around"

## Monorepo 结构（7 个包）

| 包名 | npm | 说明 |
|------|-----|------|
| `@mariozechner/pi-ai` | packages/ai | 统一多 Provider LLM API（OpenAI / Anthropic / Google / Bedrock / Mistral / Groq / xAI 等 18+ providers） |
| `@mariozechner/pi-agent-core` | packages/agent | Agent 运行时：工具调用 + 状态管理 |
| `@mariozechner/pi-coding-agent` | packages/coding-agent | **核心产品**：交互式终端编程 Agent CLI |
| `@mariozechner/pi-tui` | packages/tui | 终端 UI 库（差量渲染） |
| `@mariozechner/pi-web-ui` | packages/web-ui | Web 组件（AI Chat 界面），参见 [openclaw](https://github.com/openclaw/openclaw) |
| `@mariozechner/pi-mom` | packages/mom | Slack bot → 委托给 Pi Agent 处理 |
| `@mariozechner/pi-pods` | packages/pods | GPU Pod 上管理 vLLM 部署的 CLI |

## 核心特性

### 4 个内置工具
- `read` / `write` / `edit` / `bash`
- 可通过 Extension 替换或扩展（另有 `grep` / `find` / `ls` 可选启用）

### 4 种运行模式
1. **Interactive** — 终端 TUI，完整编辑器 + 消息队列
2. **Print** (`-p`) — 单次输出后退出
3. **JSON** (`--mode json`) — JSONL 事件流
4. **RPC** (`--mode rpc`) — stdin/stdout JSONL 协议，供外部进程集成

### Session 系统
- JSONL 树形存储（带 id + parentId，支持原地分支）
- `/tree` 可视化浏览任意历史节点并从该点继续
- `/fork` 从当前分支创建新 session
- `/compact` 手动/自动 context 压缩（支持自定义策略）

### 扩展体系（4 层）

| 层 | 说明 | 位置 |
|----|------|------|
| **Prompt Templates** | Markdown 模板，`/name` 展开，支持 `{{变量}}` | `~/.pi/agent/prompts/` |
| **Skills** | 遵循 [Agent Skills](https://agentskills.io) 标准的能力包 | `~/.pi/agent/skills/` |
| **Extensions** | TypeScript 模块：自定义工具/命令/快捷键/事件/UI | `~/.pi/agent/extensions/` |
| **Themes** | JSON 主题，热重载 | `~/.pi/agent/themes/` |

### Pi Packages
- 通过 npm 或 git 分发：`pi install npm:@foo/pi-tools`
- `pi install / remove / update / list / config`
- 安全警告：Package 拥有完整系统访问权限

### Provider 支持（18+ providers）
- **订阅制**：Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、Gemini CLI、Google Antigravity
- **API Key**：Anthropic / OpenAI / Azure / Google / Vertex / Bedrock / Mistral / Groq / Cerebras / xAI / OpenRouter / Vercel / ZAI / OpenCode / HuggingFace / Kimi / MiniMax
- **自定义**：`~/.pi/agent/models.json` 或 Extension

## 架构亮点

### Extension API
```typescript
export default function (pi: ExtensionAPI) {
  pi.registerTool({ name: "deploy", ... });
  pi.registerCommand("stats", { ... });
  pi.on("tool_call", async (event, ctx) => { ... });
}
```

能做的事：
- 替换内置工具、添加自定义工具
- Sub-agent / Plan mode
- 自定义 compaction
- 权限门控 / 路径保护
- 自定义编辑器和 UI 组件
- Status line / Header / Footer / Overlay
- Git checkpoint / SSH 沙箱执行
- MCP server 集成
- 甚至跑 Doom（真的有人做了）

### AGENTS.md 规范
- 项目级 `AGENTS.md`（或 `CLAUDE.md`）自动加载
- 全局 `~/.pi/agent/AGENTS.md`
- 父目录向上遍历，全部拼接
- 支持自定义 system prompt：`.pi/SYSTEM.md`

### 开发规范（从 AGENTS.md 看）
- 严格 TypeScript：禁止 `any`、禁止 inline import
- Biome 格式化 + TypeScript 类型检查
- Lockstep 版本：所有包统一版本号
- 并行 Agent 安全的 git 规则（禁止 `git add .`）

## 与 Claude Code 对比

| 维度 | Pi | Claude Code |
|------|-----|-------------|
| 部署 | 开源 CLI，自托管 | Anthropic 商业产品 |
| 核心工具 | 4 个（read/write/edit/bash） | ~15 个（含 Agent/Search/Todo 等） |
| 扩展 | Extension API（TypeScript 全能） | Hooks（bash pre/post）+ Custom Slash Commands |
| Sub-agent | Extension 实现 | 内置 Agent tool |
| Plan mode | Extension 实现 | 内置 |
| MCP | Extension 实现 | 内置 |
| Provider | 18+ providers，灵活切换 | 仅 Anthropic |
| Session | JSONL 树形，原地分支 | 线性，resume |
| UI | 自定义 TUI + Web Components | 固定 TUI |
| 哲学 | 极简核心 + 无限扩展 | 功能完备 + 开箱即用 |

## 值得借鉴

1. **Extension API 设计**：比 Claude Code 的 hooks 强大一个数量级，允许替换任何内置行为
2. **Session 树形结构**：JSONL + parentId 实现原地分支，比线性 session 灵活很多
3. **Pi Packages 分发**：npm/git 安装第三方扩展的包管理体系
4. **Skills 标准**：遵循 [agentskills.io](https://agentskills.io) 开放标准
5. **Provider 抽象**：`pi-ai` 包统一 18+ provider，model registry 设计值得参考
6. **Message Queue**：steering message（打断当前 tool）vs follow-up message（等 agent 完成）的消息队列设计
7. **AGENTS.md 规范**：非常详尽的 Agent 协作规范，包括 LLM provider 添加流程、git 并行安全规则

## 社区活跃度

- Issue 2312+，高频更新（每天多个 commit）
- 活跃的 Discord 社区
- 贡献者门槛：先开 Issue 获批准，再提 PR
- 近期热门 issue：tmux 兼容性、Gemini API turn 交替、OpenRouter reasoning payload

## 标签

`coding-agent`, `terminal`, `tui`, `extensible`, `multi-provider`, `open-source`, `typescript`
