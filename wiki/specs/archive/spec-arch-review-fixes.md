# Spec: 架构 Review 修复 — 测试覆盖 + ErrorBoundary

## 目标

回应架构 review 中确认值得做的两项改进：
1. 给本轮新增的核心模块补单元测试（`mcp-snippets.ts` 纯函数 + `useMcpData` 状态管理）
2. 给 `RightAskPanel` 包 ErrorBoundary 防止 AI 面板崩溃导致全页白屏

## 现状分析

- `mcp-snippets.ts`：从 `McpServerStatus.tsx` 抽出的纯函数，生成 Agent 配置 snippet，被 AgentsPanel 和 McpServerStatus 共用。零测试。
- `useMcpData.tsx`：McpProvider context，管理 MCP 状态/agents/skills 的共享数据层。零测试。
- `RightAskPanel`：直接渲染 `AskContent`，无 ErrorBoundary。AskContent 依赖外部 AI API，是最容易出错的模块。

## 数据流 / 状态流

测试目标是纯函数和 React hooks，不涉及 API 或后端数据流变更。

```
mcp-snippets.ts:
  AgentInfo + McpStatus + transport → generateSnippet() → ConfigSnippet { snippet, displaySnippet, path }

useMcpData.tsx:
  mount → fetchAll() → set status/agents/skills
  toggleSkill(name, enabled) → optimistic update → API call → revert on failure
  installAgent(key) → agentsRef.current.find → API call → fetchAll on success

RightAskPanel + ErrorBoundary:
  AskContent 正常 → 渲染 AI 面板
  AskContent crash → ErrorBoundary catch → 显示 fallback UI
```

## 方案

### 1. `mcp-snippets.test.ts`

测试 `generateStdioSnippet`, `generateHttpSnippet`, `generateSnippet`：
- 正常路径：JSON 格式 Agent 生成正确 snippet
- 正常路径：TOML 格式 Agent（如 Zed）
- 正常路径：HTTP 模式带 token + masked token
- 边界 case：globalNestedKey 存在时用 projectPath
- 边界 case：status 为 null 时使用 fallback endpoint
- 边界 case：无 authToken 时 HTTP snippet 不含 Authorization header

### 2. RightAskPanel ErrorBoundary

在 `RightAskPanel.tsx` 中包裹 `AskContent` 的 ErrorBoundary，fallback 显示错误信息 + 重试按钮。

## 影响范围

| 文件 | 改动 |
|------|------|
| `app/__tests__/lib/mcp-snippets.test.ts` | **新建** — 纯函数单元测试 |
| `app/components/RightAskPanel.tsx` | 包裹 ErrorBoundary |

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | Agent format 非 json/toml | 当前类型系统只允许 'json' \| 'toml'，无需额外处理 |
| 2 | ErrorBoundary 在 production 吞掉错误 | fallback UI 显示 "reload" 按钮，console.error 保留 |
| 3 | 测试 mock AgentInfo 字段不全 | 创建完整的 fixture 对象 |

## 验收标准

- [ ] `mcp-snippets.test.ts` 覆盖 6+ test case，全部通过
- [ ] RightAskPanel 包裹 ErrorBoundary，fallback UI 有重试按钮
- [ ] `npx vitest run` 全部通过
- [ ] 无新增 TS 错误
