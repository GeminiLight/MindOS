# Agent 配置注册表（全局维护）

## 目标

统一维护 MindOS 支持的各类 Agent 配置元数据（MCP + Skill 安装），避免 App、CLI、Setup、文档之间出现路径/键名漂移。

## 单一事实来源（Source of Truth）

- `app/lib/mcp-agents.ts`
- `bin/lib/mcp-agents.js`

这两个文件中的 `MCP_AGENTS` 与 `SKILL_AGENT_REGISTRY` 是运行时事实来源。本文档是“人类可读索引 + 维护流程”。

## 全量 Agent 配置表

| MCP Agent Key | 显示名 | MCP 键名 | Global 路径 | Project 路径 | 默认传输 | Skill 模式 | npx `-a` |
|---|---|---|---|---|---|---|---|
| `claude-code` | Claude Code | `mcpServers` | `~/.claude.json` | `.mcp.json` | `stdio` | additional | `claude-code` |
| `cursor` | Cursor | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | `stdio` | universal | - |
| `windsurf` | Windsurf | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | - | `stdio` | additional | `windsurf` |
| `cline` | Cline | `mcpServers` | macOS/Linux `globalStorage/.../cline_mcp_settings.json` | - | `stdio` | universal | - |
| `trae` | Trae | `mcpServers` | `~/.trae/mcp.json` | `.trae/mcp.json` | `stdio` | additional | `trae` |
| `gemini-cli` | Gemini CLI | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | `stdio` | universal | - |
| `openclaw` | OpenClaw | `mcpServers` | `~/.openclaw/mcp.json` | - | `stdio` | additional | `openclaw` |
| `codebuddy` | CodeBuddy | `mcpServers` | `~/.codebuddy/mcp.json` | - | `stdio` | additional | `codebuddy` |
| `iflow-cli` | iFlow CLI | `mcpServers` | `~/.iflow/settings.json` | `.iflow/settings.json` | `stdio` | additional | `iflow-cli` |
| `kimi-cli` | Kimi Code | `mcpServers` | `~/.kimi/mcp.json` | `.kimi/mcp.json` | `stdio` | universal | - |
| `opencode` | OpenCode | `mcpServers` | `~/.config/opencode/config.json` | - | `stdio` | universal | - |
| `pi` | Pi | `mcpServers` | `~/.pi/agent/mcp.json` | `.pi/settings.json` | `stdio` | additional | `pi` |
| `augment` | Augment | `mcpServers` | `~/.augment/settings.json` | `.augment/settings.json` | `stdio` | additional | `augment` |
| `qwen-code` | Qwen Code | `mcpServers` | `~/.qwen/settings.json` | `.qwen/settings.json` | `stdio` | additional | `qwen-code` |
| `qoder` | Qoder | `mcpServers` | `~/.qoder.json` | - | `stdio` | additional | `qoder` |
| `trae-cn` | Trae CN | `mcpServers` | macOS/Linux `Trae CN/User/mcp.json` | `.trae/mcp.json` | `stdio` | additional | `trae-cn` |
| `roo` | Roo Code | `mcpServers` | macOS/Linux `globalStorage/.../roo-cline/.../mcp_settings.json` | `.roo/mcp.json` | `stdio` | additional | `roo` |
| `vscode` | VS Code | `servers` (`mcp.servers`) | macOS/Linux `Code/User/settings.json` | `.vscode/mcp.json` | `stdio` | universal | - |
| `codex` | Codex | `mcp_servers` (TOML) | `~/.codex/config.toml` | - | `stdio` | universal | - |

## 变更时必须同步的文件

1. `app/lib/mcp-agents.ts`（Web / App API）
2. `bin/lib/mcp-agents.js`（CLI / setup）
3. `app/app/api/mcp/install-skill/route.ts`（skills 安装逻辑）
4. `scripts/setup.js`（onboard skills 安装逻辑）
5. `docs/zh/supported-agents.md`
6. `docs/en/supported-agents.md`
7. `wiki/refs/npx-skills-mechanism.md`（映射说明）
8. 相关测试（`app/__tests__/api/*`、`app/__tests__/core/*`）

## 变更流程（推荐）

1. 先改 `app/lib/mcp-agents.ts`，再镜像到 `bin/lib/mcp-agents.js`。
2. 同步 `SKILL_AGENT_REGISTRY`（避免 `install-skill` 与 `setup` 漂移）。
3. 同步中英文支持文档与 refs 文档。
4. 新增/更新测试断言（至少覆盖：agent 列表、presence 探测、skills 映射）。
5. 跑定向测试后再跑全量测试。

## 最低验证命令

```bash
cd app && npx vitest run \
  __tests__/api/mcp-install.test.ts \
  __tests__/api/install-skill.test.ts \
  __tests__/core/detect-agents.test.ts \
  __tests__/core/skill-install-logic.test.ts
```

## 常见漂移风险

- App 与 CLI 使用不同配置路径（导致 UI “已安装”与 CLI 实际不一致）
- 文档标注 MCP 支持，但 `MCP_AGENTS` 未注册
- Skill 模式（universal/additional）只改一处，`install-skill` 或 `setup` 未同步
- 仅改文档未补测试，后续回归难以及时发现

