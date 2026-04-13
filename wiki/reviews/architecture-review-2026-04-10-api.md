# MindOS API 路由层详细分析

> **日期**: 2026-04-10  
> **关联**: [主报告](./architecture-review-2026-04-10.md)  
> **范围**: app/app/api/ 全部 57 个路由

---

## 1. 路由总览

### 按功能分类

| 分类 | 路由数 | 总行数 | 代表文件 |
|------|--------|--------|---------|
| 知识库操作 | 12 | ~1,200 | file, files, search, backlinks, changes |
| LLM/Ask | 3 | ~1,700 | ask, ask-sessions, agent-activity |
| Agent 管理 | 9 | ~1,100 | a2a/*, acp/*, agents/* |
| MCP 协议 | 6 | ~1,000 | mcp/agents, install, restart, status, uninstall |
| 设置/配置 | 10 | ~800 | settings/*, skills |
| 系统运维 | 14 | ~1,000 | auth, health, monitoring, bootstrap, sync |
| 导入导出 | 3 | ~500 | export, import, extract-pdf |

### 按复杂度分布

```
0-100 行:   22 个路由 (39%) —— 简单、聚焦
100-250 行: 29 个路由 (51%) —— 中等复杂度
250-500 行:  4 个路由 ( 7%) —— 需要关注
500+ 行:     2 个路由 ( 3%) —— 必须重构
```

---

## 2. 关键路由深度分析

### 2.1 ask/route.ts（1,524 行）—— 最需要重构

#### 代码结构拆解

```
行号范围      职责                         建议归属
──────────   ────────────────────────     ─────────────────
1-40         导入                         保留
41-101       文件附件加载工具               → lib/agent/file-context.ts
103-161      SSE 事件类型定义               → lib/sse/types.ts
163-217      AgentEvent 类型守卫 (7个)      → lib/sse/event-guards.ts
219-271      工具输出清理、文件读取         → lib/agent/tools-helpers.ts
273-402      Skill 文件解析 (多位置回退)     → lib/agent/skill-resolver.ts
404-446      工具定义转换 + 权限检查         → lib/agent/tool-adapter.ts
448-587      非流式回退 (SSE 重组装)         → lib/agent/non-streaming.ts
589-734      非流式 Agent 循环              → lib/agent/non-streaming.ts
736-1524     主 POST handler               → 保留 (缩减到 200 行)
  ├ 740-850  请求解析 + 配置加载
  ├ 850-950  系统提示词组装 (3 模式)        → lib/agent/prompt-builder.ts
  ├ 950-1200 流式 Agent 循环               → lib/agent/executor.ts
  ├ 1200-1400 SSE 事件分发                  → lib/sse/dispatcher.ts
  └ 1400-1524 错误处理 + 清理
```

#### 内部函数清单（15 个应提取的函数）

| 文件 | 行数 | 职责 | 建议归属 |
|------|------|------|---------|
| `loadAttachedFileContext()` | 35 | 加载附件文件 | lib/agent/file-context.ts |
| `expandAttachedFiles()` | 15 | 展开目录为文件列表 | lib/agent/file-context.ts |
| `safeParseJson()` | 3 | 安全 JSON 解析 | 通用工具 |
| `isTextDeltaEvent()` + 6 other type guards | 18 | SSE 类型守卫 | lib/sse/event-guards.ts |
| `sanitizeToolArgs()` | 20 | 清理工具参数 | lib/agent/tools-helpers.ts |
| `readKnowledgeFile()` | 20 | 读取知识文件 | lib/agent/file-context.ts |
| `resolveSkillFile()` | 25 | 多位置 Skill 解析 | lib/agent/skill-resolver.ts |
| `readAbsoluteFile()` | 28 | 带缓存的文件读取 | lib/agent/skill-resolver.ts |
| `reassembleSSE()` | 60 | SSE 流重组装 | lib/agent/non-streaming.ts |
| `piMessagesToOpenAI()` | 65 | 消息格式转换 | lib/agent/non-streaming.ts |
| `runNonStreamingFallback()` | 140 | 非流式回退循环 | lib/agent/non-streaming.ts |
| `toPiCustomToolDefinitions()` | 40 | 工具定义适配 | lib/agent/tool-adapter.ts |
| **总计** | **25+ 个函数** | 应提取以改善结构 | - |

### 2.2 file/route.ts（446 行）—— Switch 语句反模式

#### 当前结构

```ts
// POST handler 内部：
switch (op) {
  case 'save_file':           // 15 行业务逻辑
  case 'append_to_file':      // 10 行
  case 'insert_lines':        // 8 行
  case 'update_lines':        // 8 行
  case 'insert_after_heading': // 10 行
  case 'update_section':      // 10 行
  case 'delete_file':         // 10 行
  case 'rename_file':         // 10 行
  case 'create_file':         // 12 行
  case 'move_file':           // 12 行
  case 'create_space':        // 20 行
  case 'rename_space':        // 8 行
  case 'append_csv':          // 10 行
  default: return err('unknown op');
}
```

**实际：13 个 case（非 20 个如报告所称）**

#### 建议：分发表模式

```ts
// lib/file-operations.ts
const FILE_OPERATIONS: Record<string, FileOpHandler> = {
  save: handleSave,
  create: handleCreate,
  delete: handleDelete,
  // ...
};

// file/route.ts (重构后 ~80 行)
const handler = FILE_OPERATIONS[op];
if (!handler) return err('unknown op');
return handler(body, mindRoot);
```

### 2.3 sync/route.ts（297 行）—— 安全风险

#### 问题

1. **使用 `execSync` 执行 Git 命令** —— 如果 `cwd` 可被用户控制，存在命令注入风险
2. **定义了 `isPathWithinMindRoot()` 但并非所有调用者都使用**
3. **静默 catch**：部分错误被静默吞掉

```ts
// 潜在风险：
execSync('git remote get-url origin', { cwd, stdio: 'pipe' });
// 如果 cwd 来自用户输入且未经验证...
```

#### 建议

- 确保所有 `cwd` 参数都经过 `resolveSafe()` 验证
- 将 Git 操作抽取到 `lib/git-sync.ts` 并添加输入净化
- 替换静默 catch 为结构化日志

---

## 3. 错误处理模式对比

### 已有的优秀基础设施（lib/errors.ts）

```ts
// MindOSError 类 —— 包含 code, message, context, userMessage
// ErrorCodes 枚举 —— 12 个业务错误码
// apiError() —— 自动映射 HTTP 状态码
// handleRouteError() —— 一行 catch 处理
```

### 实际使用情况

| 路由 | 使用 handleRouteError | 使用 apiError | 使用局部 err() | 裸 catch |
|------|:--------------------:|:------------:|:-------------:|:--------:|
| ask/route | - | 部分 | - | 是 |
| file/route | - | - | 是 | - |
| sync/route | - | - | - | 是 |
| settings/route | - | - | - | 是 |
| mcp/agents | - | - | - | 是 |
| setup/route | - | 是 | - | - |
| skills/route | - | - | - | 是 |

**结论**: 57 个路由中，使用标准错误处理的不到 10%。

### 统一方案

1. 所有路由的 catch 块统一使用 `handleRouteError(err)`
2. 业务逻辑层抛 `MindOSError`
3. 前端根据 `error.code` 字段做差异化处理

---

## 4. 输入验证现状

### 验证模式分布

| 模式 | 路由数 | 安全性 |
|------|--------|--------|
| Zod/TypeBox Schema 验证 | 0 | - |
| 手动类型检查 + 早返回 | ~15 | 中 |
| 只检查必填字段 | ~25 | 低 |
| 无验证 | ~17 | 危险 |

### 建议

项目已经依赖了 `zod` 和 `@sinclair/typebox`，应该利用它们：

```ts
// 示例：file/route.ts
const SaveFileSchema = z.object({
  op: z.literal('save'),
  path: z.string().min(1),
  content: z.string(),
  source: z.enum(['user', 'agent']).optional(),
});

// 在中间件中自动验证
export const POST = withErrorBoundary(
  withJsonBody(FileOpSchema, async (req, body) => {
    // body 已经类型安全
  })
);
```

---

## 5. 响应格式标准化建议

### 当前混乱的 5 种格式 → 统一为 1 种

```ts
// 标准响应信封
interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
  };
}

// 成功响应
{ ok: true, data: { filePath: "notes/hello.md", content: "..." } }

// 错误响应
{ ok: false, error: { code: "FILE_NOT_FOUND", message: "文件不存在" } }
```

**注意**: `lib/errors.ts` 中的 `ApiErrorResponse` 接口已经定义了这个模式的错误部分，只需要补充成功响应的对称定义。

---

## 6. 安全审计清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 路径穿越防护 | ⚠️ 部分覆盖 | file/route 用了 resolveSafe()，sync/route 的 isPathWithinMindRoot() 仅**部分使用**（gitignore 操作未使用） |
| 命令注入防护 | ⚠️ 风险 | sync/route 的 execSync 需审计 |
| CORS 验证 | ❌ 缺失 | 仅 auth/route 实现了 CORS |
| CSRF 防护 | ❌ 缺失 | 无 CSRF Token 验证 |
| 认证中间件 | ❌ 缺失 | 各路由独立实现（或不实现） |
| 请求大小限制 | ❌ 缺失 | 无文档化的限制 |
| 敏感数据日志 | ⚠️ 风险 | 部分路由在错误信息中泄露 API Key |
| 速率限制 | ❌ 缺失 | 无 |

---

## 7. 优先修复项

### P0（立即）
1. 推广 `handleRouteError()` 到所有路由（2 小时）
2. 审计 sync/route 的 `execSync` 安全性（1 小时）

### P1（本周）
3. 从 ask/route 抽取 SSE 事件处理和非流式回退（6 小时）
4. 从 file/route 抽取 switch 为分发表（4 小时）
5. 建立 `withErrorBoundary` 中间件（2 小时）

### P2（本月）
6. 统一 API 响应格式（8 小时）
7. 添加 Zod 输入验证到关键路由（6 小时）
8. 添加请求日志和关联 ID（4 小时）
