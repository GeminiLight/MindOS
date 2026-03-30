# Spec: Decouple Pi Naming — Simplify Sessions, Skills & MCP Paths

## 目标

移除 MindOS Agent 模块中所有 pi 命名依赖，统一为 MindOS 自有路径约定：
1. `~/.mindos/pi-sessions/` → `~/.mindos/sessions/`
2. Skill 扫描保留 `{mindRoot}/.skills/`（知识库用户自定义）+ `~/.mindos/skills`（全局用户自定义），移除 `.pi/skills/` 和 `~/.pi/agent/skills/`
3. MCP 工具发现不再依赖 mcporter CLI，相关工具保留 stub（list_mcp_tools / call_mcp_tool 返回"not configured"）

## 现状分析

- `session-store.ts`：硬编码 `~/.mindos/pi-sessions`。
- `skills.ts`：扫描 5 个目录（app-builtin, project-builtin, mindos-user, pi-project, pi-global）。MindOS Skill 已内置于 prompt，`app/data/skills/` 和 `skills/` 两个 builtin 目录实际为 MindOS 自身内容，保留；用户扩展仅 `{mindRoot}/.skills/`。
- `mcporter.ts`：通过 `execFile('mcporter')` 外部 CLI 发现 MCP tools 并注入 agent。MindOS 自己的 MCP 已通过 `mcp/` 内置，无需 mcporter 发现。
- `prompt.ts`：引用 "Pi Ecosystem" 和 mcporter。
- `tools.ts`：导入 skills 和 mcporter 两个模块。

## 数据流 / 状态流

```
Before:
  session-store → ~/.mindos/pi-sessions/
  skills.ts → 5 dirs (app-builtin, project-builtin, mindos-user, pi-project, pi-global)
  mcporter.ts → execFile('mcporter') → external CLI → MCP tools

After:
  session-store → ~/.mindos/sessions/
  skills.ts → 4 dirs (app-builtin, project-builtin, mindos-user, mindos-global)
  mcporter.ts → stub (list/call return "not configured")
```

## 方案

### 1. session-store.ts
- `getSessionsRoot()` 改为 `~/.mindos/sessions`

### 2. skills.ts
- `getPiSkillSearchDirs()` 移除 `pi-project` 和 `pi-global`，新增 `mindos-global`（`~/.mindos/skills`）
- `PiSkillInfo.origin` 类型：移除 `'pi-project' | 'pi-global'`，新增 `'mindos-global'`

### 3. mcporter.ts / tools.ts
- mcporter 的 `listMcporterServers`、`listMcporterTools`、`callMcporterTool`、`createMcporterAgentTools` 保留导出（避免破坏编译），但 `runMcporter` 改为直接 throw "mcporter not available"
- `tools.ts` 中 `list_mcp_tools` / `call_mcp_tool` description 改为引导用户使用 MindOS MCP
- agent prompt 中 "Pi Ecosystem" 段落移除

### 4. prompt.ts
- 移除 "Pi Ecosystem" 行

## 影响范围

| 文件 | 变更 |
|---|---|
| `app/lib/pi-integration/session-store.ts` | 路径改名 |
| `app/lib/pi-integration/skills.ts` | 移除 2 个扫描目录、类型收窄 |
| `app/lib/pi-integration/mcporter.ts` | `runMcporter` stub |
| `app/lib/agent/prompt.ts` | 移除 Pi Ecosystem 引用 |
| `app/lib/agent/tools.ts` | 更新 description |
| `app/__tests__/lib/session-store.test.ts` | 断言路径改名 |
| `app/__tests__/lib/pi-skills.test.ts` | 移除 pi-project/pi-global 测试 |
| `app/__tests__/lib/mcporter.test.ts` | 无变更（纯单元测试，不调 runMcporter） |
| `app/__tests__/core/request-scoped-tools.test.ts` | 无变更（mock 层不受影响） |

不受影响：`mcp-agents.ts`（agent registry 保留 pi agent 条目，因为用户仍然可以在 pi 中使用 MindOS MCP）。

## 边界 case 与风险

1. **已有 `~/.mindos/pi-sessions/` 数据**：用户可能有持久化会话。不做自动迁移——旧目录自然不会被读取，新会话写入新目录。风险低（会话数据非关键）。
2. **用户在 `.pi/skills/` 放了自定义 skill**：移除扫描后不可见。但 MindOS 已有 `{mindRoot}/.skills/` 专用目录，用户迁移成本低。
3. **mcporter CLI 被其他代码调用**：已确认仅 `mcporter.ts` 一处，stub 后无连锁影响。

## 验收标准

- [ ] `getSessionDir('x')` 返回路径包含 `sessions` 而非 `pi-sessions`
- [ ] `scanSkillDirs()` 仅扫描 3 个目录，不包含 pi-project / pi-global
- [ ] `PiSkillInfo.origin` 类型不包含 `'pi-project' | 'pi-global'`
- [ ] Agent prompt 不含 "Pi Ecosystem" 或 "mcporter"
- [ ] `list_mcp_tools` tool description 不提及 mcporter
- [ ] 全量测试通过（853+ tests）
