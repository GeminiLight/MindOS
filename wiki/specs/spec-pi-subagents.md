# Spec: 内置 pi-subagents 扩展

## 目标

让 MindOS Agent 默认内置 `pi-subagents` 扩展，使 LLM 可以直接使用 subagent 工具进行任务委托、链式/并行执行。

## 现状分析

- MindOS 使用 `@mariozechner/pi-coding-agent` 的 `DefaultResourceLoader` 加载扩展
- 扩展通过 `additionalExtensionPaths` 数组注册（`ask/route.ts:645-651`）
- 当前已内置：`pi-mcp-adapter`、IM extension
- pi-subagents 不在 dependencies 中，Agent 无法使用 subagent 工具

## 数据流 / 状态流

```
POST /api/ask (mode=agent)
    │
    ▼
DefaultResourceLoader({
  additionalExtensionPaths: [
    ...scanExtensionPaths(),              // ~/.mindos/extensions/
    .../pi-mcp-adapter/index.ts,          // MCP 代理
    .../lib/im/index.ts,                  // IM 扩展
+   .../pi-subagents/index.ts             // ← 新增
  ]
})
    │
    ▼
loader.reload() → 解析扩展、注册工具
    │
    ▼
createAgentSession() → LLM 可用工具列表包含 subagent, subagent_status
    │
    ▼
session.prompt() → Agent 运行，可调用 subagent 工具
```

## 方案

1. **添加 dependency**：`app/package.json` 添加 `"pi-subagents": "^0.12.5"`
2. **注册扩展路径**：在 `ask/route.ts:645-651` 添加 `path.join(projectRoot, 'app', 'node_modules', 'pi-subagents', 'index.ts')`
3. **写测试**：确保扩展正确加载、工具注册成功

## 影响范围

### 变更文件列表

| 文件 | 变更 |
|------|------|
| `app/package.json` | 添加 dependency |
| `app/app/api/ask/route.ts` | 添加 extension path（1 行） |
| `app/__tests__/api/pi-subagents.test.ts` | 新增测试文件 |
| `app/package-lock.json` | 自动更新 |

### 受影响的其他模块

- **organize/chat 模式**：不受影响，扩展仅在 agent 模式生效
- **CLI installer**：不受影响，这是运行时 web 层改动
- **npm 发布**：需确保 pi-subagents 被正确打包

### 破坏性变更

无。纯增量改动，现有功能不受影响。

## 边界 case 与风险

| 边界 case | 处理方式 |
|-----------|---------|
| pi-subagents 入口文件不存在 | DefaultResourceLoader 对不存在的路径静默跳过 |
| 版本冲突 / peer dep 不满足 | npm install 报警告但可运行 |
| subagent 工具执行失败 | 返回错误给 LLM，不影响核心流程 |
| 用户 ~/.mindos/extensions/ 有同名扩展 | 用户扩展优先（scanExtensionPaths 在前） |

**风险**：

| 风险 | 缓解措施 |
|------|---------|
| 包体积增大 | pi-subagents 打包后约 ~50KB，可接受 |
| 与 pi-coding-agent 版本不兼容 | 两者同源，风险低；pin 到兼容版本 |

## 验收标准

- [ ] `npm install` 成功，pi-subagents 出现在 node_modules
- [ ] Agent 模式请求后，`loader.getExtensions().extensions` 包含 pi-subagents
- [ ] 工具列表包含 `subagent` 和 `subagent_status`
- [ ] 测试文件 `pi-subagents.test.ts` 通过（≥3 test cases）
- [ ] 现有测试全部通过（`npm test`）
