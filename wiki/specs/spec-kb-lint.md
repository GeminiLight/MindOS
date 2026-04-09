# Spec: 知识体检（KB Lint）

## 目标

提供一键检查知识库健康度的能力——发现孤立笔记、过期内容、断链引用、空文件，返回结构化报告和健康分数。通过 API、Agent 工具、MCP 工具三条路径暴露。

## 现状分析

MindOS 已有完整的文件读写和 LinkIndex（双向链接索引），但没有知识库整体健康度的分析能力。用户无法知道哪些笔记已经被遗忘、哪些引用已经失效。SKILL.md 中提到"知识体检"概念但无实现。

## 数据流 / 状态流

```
触发（Agent lint 工具 / MCP mindos_lint / GET /api/lint）
  │
  GET /api/lint?space=X
  │
  lib/lint.ts:
  ├─ collectAllFiles(space?) → 文件列表
  ├─ getLinkIndex() → 已有 LinkIndex 单例（O(1) 查询）
  ├─ findOrphans() → backlinks=0 且不在白名单
  ├─ findStaleFiles(90d) → mtime 检查
  ├─ findBrokenLinks() → 正则扫描 [[links]] + [](paths)
  ├─ findEmptyFiles() → content.trim().length < 50
  └─ computeHealthScore() → 100 分制
  │
  返回 LintReport JSON
```

## 方案

### 核心逻辑：`app/lib/lint.ts`

纯函数模块，不依赖 LLM，可独立测试。

```typescript
interface LintReport {
  timestamp: string;
  scope: string;
  stats: {
    totalFiles: number;
    orphanFiles: number;
    staleFiles: number;
    emptyFiles: number;
    brokenLinks: number;
  };
  healthScore: number; // 0-100
  orphans: Array<{ path: string; lastModified: string }>;
  stale: Array<{ path: string; lastModified: string; daysSinceUpdate: number }>;
  brokenLinks: Array<{ source: string; target: string; line: number }>;
  empty: string[];
}
```

**白名单**：INSTRUCTION.md / README.md / CONFIG.json / _overview.md / CHANGELOG.md / TODO.md 不标记为孤立。

**健康分数**：`100 - (orphanPenalty + stalePenalty + brokenPenalty + emptyPenalty)`
- 每个 orphan：-2 分（上限 -30）
- 每个 stale：-1 分（上限 -20）
- 每个 broken link：-3 分（上限 -30）
- 每个 empty：-1 分（上限 -20）
- 下限 0 分（各类上限合计 100，故极端情况可归零）

### API Route：`app/app/api/lint/route.ts`

`GET /api/lint?space=Projects`

### Agent 工具：`app/lib/agent/tools.ts`

在 `knowledgeBaseTools` 中新增 `lint` 工具。

### MCP 工具：`mcp/src/index.ts`

注册 `mindos_lint` MCP 工具，通过 `GET /api/lint` 透传。MCP 客户端（Claude Code、Cursor 等）可直接调用。

## 影响范围

### 新增文件
| 文件 | 用途 |
|------|------|
| `app/lib/lint.ts` | 核心分析逻辑 |
| `app/app/api/lint/route.ts` | API route |
| `app/__tests__/lint/lint.test.ts` | 单元测试 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `app/lib/agent/tools.ts` | 增加 `lint` 工具 |
| `mcp/src/index.ts` | 增加 `mindos_lint` MCP 工具 |
| `wiki/85-backlog.md` | 标记完成 |

### 不受影响
- UI 组件（本次不做 UI）
- CSS / 设计系统
- i18n（本次无 UI，无需 i18n keys）

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | 空 KB（0 文件）| 返回空报告，healthScore=100 |
| 2 | 系统文件孤立 | 白名单排除，不算 orphan |
| 3 | >1000 文件 KB | 无需分批——静态分析纯内存操作，<1s |
| 4 | 文件无 mtime（stat 失败）| 跳过该文件的 stale 检查 |
| 5 | 二进制文件 | 只分析 .md/.csv，跳过图片/音频 |
| 6 | Space 参数不存在 | 返回空报告，scope 标注 Space 名 |
| 7 | 自引用链接 | LinkIndex 已排除自引用 |

**风险**：orphan 误报（正常入口页无入链但不是孤立的）→ 白名单 + 用户可忽略。

## 验收标准

- [ ] `GET /api/lint` 返回完整 LintReport JSON，包含 stats + healthScore + 各类问题列表
- [ ] Agent 工具 `lint` 可在对话中调用（"帮我检查一下知识库健康度"）
- [ ] 空 KB lint 不报错，返回 healthScore=100
- [ ] 系统文件不被标为孤立
- [ ] brokenLinks 包含源文件路径和行号
- [ ] healthScore 在 0-100 范围内
- [ ] 单元测试覆盖正常/边界/错误路径（≥15 个 case）
