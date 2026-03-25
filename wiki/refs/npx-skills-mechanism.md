# `npx skills` 工具链机制参考

## 概述

`npx skills add` (v1.4.5) 是通用的 AI Agent Skill 分发工具，将 Skill 文件安装到 40 个 Agent 的约定目录中。

## Agent 分类

### Universal Agents（8 个）

直接从 `.agents/skills/<name>/` 读取（项目级）或 `~/.agents/skills/<name>/`（全局 `-g`），**不需要额外 symlink**。

| `-a` 值 | Agent | 说明 |
|---------|-------|------|
| `cline` | Cline | VS Code 扩展 |
| `codex` | Codex | OpenAI CLI |
| `cursor` | Cursor | IDE |
| `gemini-cli` | Gemini CLI | Google CLI |
| `github-copilot` | GitHub Copilot | |
| `kimi-cli` | Kimi Code CLI | 月之暗面 CLI |
| `opencode` | OpenCode | |
| `warp` | Warp | 终端 |

> `replit` 和 `universal` 也使用 `.agents/skills/` 但设置了 `showInUniversalList: false`，不在通用列表中显示。

### Additional Agents（32 个）

通过 **symlink** 链接：`~/.<agent>/skills/<name>` → `../../.agents/skills/<name>`

| `-a` 值 | Agent | Skills 目录 |
|---------|-------|------------|
| `augment` | Augment | `.augment/skills` |
| `claude-code` | Claude Code | `.claude/skills` |
| `openclaw` | OpenClaw | `skills` |
| `codebuddy` | CodeBuddy | `.codebuddy/skills` |
| `command-code` | Command Code | `.commandcode/skills` |
| `continue` | Continue | `.continue/skills` |
| `cortex` | Cortex Code | `.cortex/skills` |
| `crush` | Crush | `.crush/skills` |
| `droid` | Droid | `.factory/skills` |
| `goose` | Goose | `.goose/skills` |
| `junie` | Junie | `.junie/skills` |
| `iflow-cli` | iFlow CLI | `.iflow/skills` |
| `kilo` | Kilo Code | `.kilocode/skills` |
| `kiro-cli` | Kiro CLI | `.kiro/skills` |
| `kode` | Kode | `.kode/skills` |
| `mcpjam` | MCPJam | `.mcpjam/skills` |
| `mistral-vibe` | Mistral Vibe | `.vibe/skills` |
| `mux` | Mux | `.mux/skills` |
| `openhands` | OpenHands | `.openhands/skills` |
| `pi` | Pi | `.pi/skills` |
| `qoder` | Qoder | `.qoder/skills` |
| `qwen-code` | Qwen Code | `.qwen/skills` |
| `roo` | Roo Code | `.roo/skills` |
| `trae` | Trae | `.trae/skills` |
| `trae-cn` | Trae CN | `.trae/skills` |
| `windsurf` | Windsurf | `.windsurf/skills` |
| `zencoder` | Zencoder | `.zencoder/skills` |
| `neovate` | Neovate | `.neovate/skills` |
| `pochi` | Pochi | `.pochi/skills` |
| `adal` | AdaL | `.adal/skills` |
| `replit` | Replit | `.agents/skills`（隐藏） |
| `universal` | Universal | `.agents/skills`（隐藏，fallback） |

### 关键区别

| | Universal | Additional |
|---|----------|-----------|
| 安装方式 | 复制到 `.agents/skills/` | symlink 到 `.agents/skills/` |
| 无 `-g` 时路径 | `<project>/.agents/skills/<name>/` | `<project>/.<agent>/skills/<name>/` → symlink |
| `-g` 时路径 | `~/.agents/skills/<name>/` | `~/.<agent>/skills/<name>/` → symlink |
| agent 未安装 | 无影响（目录已存在） | 创建空目录 + dangling symlink（无害） |

## 命令参数

```bash
npx skills add <source> [options]
```

| 参数 | 说明 |
|------|------|
| `<source>` | Skill 来源：GitHub repo / local path / npm package |
| `-s <name>` | 指定安装哪个 Skill（source 中可能有多个） |
| `-a <agent1>,<agent2>` | 指定安装到哪些 agent（逗号分隔） |
| `--all` | 安装到所有 40 个 agent |
| `-g` | 全局安装（`~/.agents/skills/` 而非项目级） |
| `-y` | 跳过交互确认 |

## 安装流程

1. 从 source 读取 Skill 文件
2. 复制到 `.agents/skills/<name>/`（或 `~/.agents/skills/<name>/`，取决于 `-g`）
3. 对 Additional agents：在 `~/.<agent>/skills/<name>/` 创建 symlink
4. 写入 `skills-lock.json` 记录来源和 hash

## 重要行为

### `--all` 行为

- 为所有 40 个 agent 创建目录/symlink，**不论该 agent 是否已安装**
- 对未安装的 agent：只是创建了空目录和 dangling symlink，无副作用
- 好处：用户未来安装新 agent 时 Skill 自动可用

### `npx skills remove` ⚠️

- `npx skills remove --all` 会**删除 `skills/` 下的源文件**！
- 单个 remove 也会删除 `.agents/skills/<name>/` 下的副本
- **MindOS 代码中绝不调用 remove**

### `-s` + `--all` 的组合

经测试，`-s <name> --all` 在某些情况下可能安装 source 中**所有** Skill 而非仅指定的。需要验证具体版本行为。

## MindOS 使用策略

### 推荐方案：一条命令，按需添加 Additional agents

**关键发现**：任何 `-a <agent>` 命令都会先复制文件到 `~/.agents/skills/<name>/`，Universal agents 自动可读。所以不需要单独跑 `-a universal`。

```bash
# 情况 1: 用户选了 non-universal agent
npx skills add <source> -s <skill> -a claude-code,windsurf -g -y
# → ~/.agents/skills/<name>/ (Universal 自动覆盖)
# → ~/.claude-code/skills/<name> → symlink
# → ~/.windsurf/skills/<name> → symlink

# 情况 2: 用户只选了 universal agent（或无 agent）
npx skills add <source> -s <skill> -a universal -g -y
# → 仅 ~/.agents/skills/<name>/（fallback）
```

**为什么不用 `--all`**：
- `--all` 会为 ~32 个 additional agent 创建目录/symlink，多数用户只用 2-3 个 agent
- 虽然无害，但 HOME 目录下多出大量 `~/.<agent>/` 空目录不够整洁
- Universal 已覆盖 8 个主流 agent（Cursor, Cline, Gemini CLI 等），够用

**什么时候需要 `-a`**：
用户选了 MindOS 支持的 agent 中不在 Universal 列表里的：

| MCP Agent Key | 是否 Universal | 需要 `-a` |
|---------------|---------------|----------|
| `claude-code` | ❌ Additional | ✅ `-a claude-code` |
| `cursor` | ✅ Universal | ❌ |
| `windsurf` | ❌ Additional | ✅ `-a windsurf` |
| `cline` | ✅ Universal | ❌ |
| `trae` | ❌ Additional | ✅ `-a trae` |
| `gemini-cli` | ✅ Universal | ❌ |
| `openclaw` | ❌ Additional | ✅ `-a openclaw` |
| `codebuddy` | ❌ Additional | ✅ `-a codebuddy` |
| `iflow-cli` | ❌ Additional | ✅ `-a iflow-cli` |
| `kimi-cli` | ✅ Universal | ❌ |
| `opencode` | ✅ Universal | ❌ |
| `pi` | ❌ Additional | ✅ `-a pi` |
| `qoder` | ❌ Additional | ✅ `-a qoder` |
| `augment` | ❌ Additional | ✅ `-a augment` |
| `qwen-code` | ❌ Additional | ✅ `-a qwen-code` |
| `trae-cn` | ❌ Additional | ✅ `-a trae-cn` |
| `roo` | ❌ Additional | ✅ `-a roo` |

### Agent 映射表

| MCP Agent Key | Skills Agent Name | Universal | 支持 Skill |
|---------------|-------------------|-----------|-----------|
| `claude-code` | `claude-code` | ❌ | ✅ |
| `cursor` | `cursor` | ✅ | ✅ |
| `windsurf` | `windsurf` | ❌ | ✅ |
| `cline` | `cline` | ✅ | ✅ |
| `trae` | `trae` | ❌ | ✅ |
| `gemini-cli` | `gemini-cli` | ✅ | ✅ |
| `openclaw` | `openclaw` | ❌ | ✅ |
| `codebuddy` | `codebuddy` | ❌ | ✅ |
| `iflow-cli` | `iflow-cli` | ❌ | ✅ |
| `kimi-cli` | `kimi-cli` | ✅ | ✅ |
| `opencode` | `opencode` | ✅ | ✅ |
| `pi` | `pi` | ❌ | ✅ |
| `qoder` | `qoder` | ❌ | ✅ |
| `augment` | `augment` | ❌ | ✅ |
| `qwen-code` | `qwen-code` | ❌ | ✅ |
| `trae-cn` | `trae-cn` | ❌ | ✅ |
| `roo` | `roo` | ❌ | ✅ |

> 全局维护规则见：`wiki/refs/agent-config-registry.md`
