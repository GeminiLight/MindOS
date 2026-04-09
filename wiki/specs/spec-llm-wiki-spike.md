# Spec: LLM Wiki 启发 — 实施 Spike

## 目标

将 Karpathy LLM Wiki 调研（`spec-karpathy-llm-wiki-insights.md`）中提炼的 5 个改进方向落地为具体的代码改动计划，明确改什么文件、改什么函数、API 长什么样、UI 长什么样。

---

## 现状分析

MindOS 当前架构已具备 LLM Wiki 的大部分基础设施：
- **文件读写**：完整的 CRUD 工具链（`tools.ts` 780 行，20+ 工具）
- **搜索**：全文搜索 + backlinks + recent（`searchFiles` / `findBacklinks`）
- **Bootstrap**：MCP `mindos_bootstrap` 返回 INSTRUCTION + README + CONFIG（`/api/bootstrap/route.ts` 42 行）
- **AI 模式**：Agent / Chat / Organize 三种 prompt + 工具集
- **审计**：`.agent-log.json` 追加式日志

**缺什么：**

| 缺失能力 | 现状 | 对标 LLM Wiki |
|----------|------|--------------|
| 查询回流 | Agent 回答后消失在聊天记录中 | Query 结果可 file 回 wiki |
| 知识体检 | SKILL.md 中提到概念，无具体实现 | Lint 是一等公民操作 |
| Smart Index | Bootstrap 只返回 README 文本，无文件摘要 | index.md 含每页一句话描述 |
| 深度摄入 | Organize 放文件到目标 Space，不更新现有笔记 | Ingest 涟漪更新 10-15 页 |
| 知识编译 | 无 | Space 级综述自动生成 |

---

## 方案

### Feature 1: 查询回流（Save Insight）— P0

**用户故事：** Agent 回答了一个有价值的问题，用户想一键把这段回答保存为知识库中的笔记。

#### 1.1 前端：MessageList 增加"保存"按钮

**文件：** `app/components/ask/MessageList.tsx`

在 assistant 消息气泡的操作栏（目前只有 Copy 按钮）旁边，增加一个 "Save to KB" 按钮：

```tsx
// 在 CopyMessageButton 旁边增加
function SaveToKBButton({ text, onSave }: { text: string; onSave: (text: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSave(text)}
      className="p-1 rounded-md bg-card border border-border/60 shadow-sm text-muted-foreground hover:text-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
      title="Save to knowledge base"
    >
      <FolderInput size={11} />
    </button>
  );
}
```

点击后弹出一个轻量 dialog（复用现有组件风格）：
- **目标路径**：Space 选择器 + 文件名输入框（AI 预填建议路径）
- **内容预览**：显示将要保存的 Markdown 内容（可编辑）
- **操作**：保存 / 追加到现有文件 / 取消

#### 1.2 API：新增保存端点

**不需要新 API**——直接复用 `POST /api/file` 的 `create_file` 或 `append_to_file` op。前端直接调用。

#### 1.3 路径建议逻辑

**文件：** `app/lib/agent/save-insight.ts`（新建）

```typescript
export interface SaveInsightSuggestion {
  path: string;           // 建议的保存路径
  mode: 'create' | 'append'; // 新建 or 追加
  title: string;          // 建议的标题
}

export function suggestSavePath(
  messageContent: string,
  existingTree: FileTreeNode[],
): SaveInsightSuggestion {
  // 1. 从回答内容提取关键词
  // 2. 在 existingTree 中匹配最相关的 Space
  // 3. 生成文件名（日期 + 关键词 slug）
  // 4. 如果匹配到同名已有文件，建议 append 而非 create
}
```

#### 1.4 MCP 工具

**文件：** `app/lib/agent/tools.ts` + `mcp/src/index.ts`

不需要新 MCP 工具——Agent 本身已有 `create_file` / `append_to_file`。在 Agent prompt 中增加指引即可：

```
When your answer is substantial and the user might want to keep it, 
proactively offer: "要把这段分析保存到知识库吗？"
```

**文件改动：** `app/lib/agent/prompt.ts` AGENT_SYSTEM_PROMPT 增加一条 Core Directive。

#### 1.5 改动清单

| 文件 | 改动 | 大小 |
|------|------|------|
| `app/components/ask/MessageList.tsx` | 增加 SaveToKBButton + SaveDialog | ~80 行 |
| `app/lib/agent/save-insight.ts` | 新建：路径建议逻辑 | ~60 行 |
| `app/lib/agent/prompt.ts` | AGENT_SYSTEM_PROMPT 增加回流指引 | ~3 行 |
| `app/components/ask/SaveInsightDialog.tsx` | 新建：保存对话框组件 | ~120 行 |

---

### Feature 2: 知识体检（KB Lint）— P1

**用户故事：** 用户想知道知识库的健康度——有没有孤立笔记、过期内容、缺失交叉引用。

#### 2.1 API Route

**文件：** `app/app/api/lint/route.ts`（新建）

```typescript
// GET /api/lint?space=Projects&depth=shallow
// Response: LintReport JSON

interface LintReport {
  timestamp: string;
  scope: string;        // "全部" or Space name
  stats: {
    totalFiles: number;
    totalLinks: number;
    orphanFiles: number;  // 无入链的文件
    staleFiles: number;   // >90天未更新
    emptyFiles: number;   // 空文件或极短
    brokenLinks: number;  // 引用了不存在的文件
  };
  orphans: Array<{ path: string; lastModified: string }>;
  stale: Array<{ path: string; lastModified: string; daysSinceUpdate: number }>;
  brokenLinks: Array<{ source: string; target: string; line: number }>;
  suggestions: string[]; // LLM 生成的改进建议（可选）
}
```

实现分两层：
- **静态分析（不需要 LLM，快速）：** 扫描文件树 + backlinks 索引 → 统计孤立/断链/陈旧/空文件
- **LLM 分析（可选，深度）：** 调用 LLM 分析矛盾、建议合并、推荐新建

```typescript
export async function GET(req: NextRequest) {
  const space = req.nextUrl.searchParams.get('space') ?? undefined;
  const depth = req.nextUrl.searchParams.get('depth') ?? 'shallow'; // shallow | deep
  
  // Phase 1: static analysis (fast, no LLM)
  const allFiles = collectAllFiles(space);
  const orphans = findOrphans(allFiles);
  const stale = findStaleFiles(allFiles, 90);
  const broken = findBrokenLinks(allFiles);
  const empty = findEmptyFiles(allFiles);
  
  const report: LintReport = { /* ... */ };
  
  // Phase 2: LLM suggestions (optional, when depth=deep)
  if (depth === 'deep') {
    report.suggestions = await generateLintSuggestions(report);
  }
  
  return NextResponse.json(report);
}
```

#### 2.2 核心分析函数

**文件：** `app/lib/lint.ts`（新建）

```typescript
import { collectAllFiles, getFileContent } from '@/lib/fs';
import { findBacklinks } from '@/lib/fs';

export function findOrphans(files: FileEntry[]): OrphanEntry[] {
  // 对每个文件调用 findBacklinks，入链数=0 的就是孤立页
  // 排除：INSTRUCTION.md, README.md, CONFIG.json（系统文件不算孤立）
}

export function findStaleFiles(files: FileEntry[], thresholdDays: number): StaleEntry[] {
  // mtime < now - thresholdDays
}

export function findBrokenLinks(files: FileEntry[]): BrokenLinkEntry[] {
  // 正则扫描每个文件中的 [[wiki-link]] 和 [text](path) 引用
  // 检查目标文件是否存在
}

export function findEmptyFiles(files: FileEntry[]): string[] {
  // content.trim().length < 50 或只有 frontmatter
}
```

#### 2.3 MCP 工具

**文件：** `mcp/src/index.ts` — 新增 `mindos_lint`

```typescript
server.registerTool("mindos_lint", {
  title: "Knowledge Base Health Check",
  description: "Run a health check on the knowledge base. Returns orphan pages, stale content, broken links, and improvement suggestions.",
  inputSchema: z.object({
    space: z.string().optional().describe("Scope to a specific Space path"),
    depth: z.enum(["shallow", "deep"]).default("shallow")
      .describe("shallow=static analysis only (fast), deep=includes LLM suggestions"),
  }),
  annotations: { readOnlyHint: true },
}, async ({ space, depth }) => {
  const params: Record<string, string> = {};
  if (space) params.space = space;
  if (depth) params.depth = depth;
  const json = await _get("/api/lint", params);
  return ok(JSON.stringify(json, null, 2));
});
```

**文件：** `app/lib/agent/tools.ts` — 新增 `lint` 工具到 knowledgeBaseTools

```typescript
{
  name: 'lint',
  label: 'Knowledge Health Check',
  description: 'Run a health check: find orphan pages (no inbound links), stale files (>90 days), broken links, and empty files. Returns a structured report.',
  parameters: Type.Object({
    space: Type.Optional(Type.String({ description: 'Scope to a specific Space' })),
  }),
  execute: safeExecute(async (_id, params) => {
    const mindRoot = getMindRoot();
    const { findOrphans, findStaleFiles, findBrokenLinks, findEmptyFiles } = await import('@/lib/lint');
    const allFiles = collectAllFiles(params.space);
    // ... run analysis, return report
  }),
}
```

#### 2.4 UI（Phase 2，可后做）

**位置：** 设置页 / 工具栏 / 或 Command Palette

一个简单的"知识体检"页面：
- 健康分数（100 分制：基于孤立率、陈旧率、断链率计算）
- 分类展示问题列表
- 每条问题可跳转到对应文件
- "一键修复"按钮（交给 Agent 自动修复简单问题如断链）

#### 2.5 改动清单

| 文件 | 改动 | 大小 |
|------|------|------|
| `app/lib/lint.ts` | 新建：静态分析核心逻辑 | ~150 行 |
| `app/app/api/lint/route.ts` | 新建：API route | ~60 行 |
| `app/lib/agent/tools.ts` | 增加 `lint` 工具 | ~30 行 |
| `mcp/src/index.ts` | 增加 `mindos_lint` 工具 | ~20 行 |
| `app/components/lint/LintReport.tsx` | 新建：UI 展示（Phase 2） | ~200 行 |

---

### Feature 3: Bootstrap 增强（Smart Index）— P1

**用户故事：** 外部 Agent 通过 MCP 连接到 MindOS，调用 `bootstrap` 后能快速了解每个文件的内容概要，不需要逐个 read。

#### 3.1 改进 Bootstrap API

**文件：** `app/app/api/bootstrap/route.ts`

当前输出：
```json
{
  "instruction": "INSTRUCTION.md 内容",
  "index": "README.md 内容",
  "config_json": "CONFIG.json 内容"
}
```

增强后输出：
```json
{
  "instruction": "...",
  "index": "...",
  "config_json": "...",
  "file_index": "Projects/\n  product-roadmap.md — 产品路线图和优先级\n  tech-decisions.md — 技术选型记录\nJournal/\n  2026-04.md — 4月日记\n  ..."
}
```

**实现方式**：不依赖 LLM 生成摘要（太慢），而是从每个文件提取首行非空非 heading 文本作为摘要：

```typescript
function extractOneLiner(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过空行、heading、frontmatter 分隔符、空 heading
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') continue;
    // 跳过 frontmatter 内的键值对
    if (trimmed.match(/^\w+:\s/)) continue;
    // 截断到 80 字符
    return trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed;
  }
  return '';
}

function buildFileIndex(tree: FileTreeNode[]): string {
  const lines: string[] = [];
  function walk(nodes: FileTreeNode[], depth: number) {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      if (node.type === 'directory') {
        lines.push(`${indent}${node.name}/`);
        if (node.children) walk(node.children, depth + 1);
      } else {
        const content = tryRead(node.path);
        const summary = content ? extractOneLiner(content) : '';
        lines.push(`${indent}${node.name}${summary ? ' — ' + summary : ''}`);
      }
    }
  }
  walk(tree, 0);
  return lines.join('\n');
}
```

#### 3.2 性能考虑

- **文件数 < 100**：直接生成完整 index（< 5KB，无性能问题）
- **文件数 100-500**：只展开前 3 层 + 每层前 20 个文件
- **文件数 > 500**：返回 Space 级摘要（每个 Space 一行 + 文件数），细节靠 `list_files` + `search`

在 `buildFileIndex` 中增加：
```typescript
const MAX_FILES_IN_INDEX = 200;
let fileCount = 0;
// 在 walk 中: if (++fileCount > MAX_FILES_IN_INDEX) { lines.push('  ... and more'); return; }
```

#### 3.3 MCP 端同步

**文件：** `mcp/src/index.ts` — `mindos_bootstrap` handler

当前已经透传 `/api/bootstrap`，无需改动——API 返回新字段后 MCP 自动包含。

#### 3.4 改动清单

| 文件 | 改动 | 大小 |
|------|------|------|
| `app/app/api/bootstrap/route.ts` | 增加 `file_index` 字段生成 | ~50 行 |
| `app/lib/fs.ts` 或 `app/lib/file-index.ts` | `extractOneLiner` + `buildFileIndex` | ~40 行 |

---

### Feature 4: 深度摄入（Ingest Ripple）— P2

**用户故事：** 用户通过 AI Organize 导入一篇新文章，AI 不仅把它放到合适的 Space，还检查现有笔记是否需要更新引用。

#### 4.1 Organize Prompt 增强

**文件：** `app/lib/agent/prompt.ts`

在 `ORGANIZE_SYSTEM_PROMPT` 末尾增加 "关联扫描" 指令：

```
8. After placing files, search for existing notes that mention similar topics.
   If you find related notes, suggest updates (add cross-references, flag potential 
   contradictions, note supplementary information). Present suggestions to the user 
   before making changes — do NOT auto-edit existing files without confirmation.
```

#### 4.2 Organize 工具集扩展

**文件：** `app/lib/agent/tools.ts`

当前 `ORGANIZE_TOOL_NAMES` 包含 9 个工具。为支持关联扫描，需要增加：

```typescript
const ORGANIZE_TOOL_NAMES = new Set([
  // 现有 9 个...
  'get_backlinks',  // 新增：查找关联
  'get_recent',     // 新增：找最近相关文件
]);
```

#### 4.3 实现策略

不改 route.ts 中的 organize 流程——纯靠 prompt 引导 Agent 自主执行关联扫描。Agent 的典型行为：

1. 读取上传文件 → 提取关键概念
2. `search` 关键概念 → 找到相关现有笔记
3. 读取相关笔记 → 对比新旧内容
4. 向用户展示发现："发现 3 篇相关笔记可能需要更新：[列表]，需要我更新它们吗？"
5. 用户确认 → 执行 `update_section` / `append_to_file`

#### 4.4 改动清单

| 文件 | 改动 | 大小 |
|------|------|------|
| `app/lib/agent/prompt.ts` | ORGANIZE_SYSTEM_PROMPT 增加关联扫描指令 | ~5 行 |
| `app/lib/agent/tools.ts` | ORGANIZE_TOOL_NAMES 增加 2 个工具 | ~2 行 |

---

### Feature 5: 知识编译（Space Overview）— P3

**用户故事：** 用户的 "Research" Space 有 50 篇笔记，想让 AI 生成一份综述——核心概念、关键发现、知识空白。

#### 5.1 MCP 工具

**文件：** `mcp/src/index.ts` — 新增 `mindos_compile`

```typescript
server.registerTool("mindos_compile", {
  title: "Compile Space Overview",
  description: "Generate or update a knowledge overview for a Space. Reads all files in the Space and produces a structured summary with key concepts, findings, gaps, and cross-references. Saves as _overview.md in the Space.",
  inputSchema: z.object({
    space: z.string().min(1).describe("Space path to compile (e.g. 'Research')"),
    force: z.boolean().default(false).describe("Regenerate even if _overview.md exists and is recent"),
  }),
}, async ({ space, force }) => {
  const json = await _post("/api/compile", { space, force });
  return ok(JSON.stringify(json, null, 2));
});
```

#### 5.2 API Route

**文件：** `app/app/api/compile/route.ts`（新建）

```typescript
export async function POST(req: NextRequest) {
  const { space, force } = await req.json();
  
  // 1. 收集 Space 下所有文件
  const files = collectSpaceFiles(space);
  
  // 2. 检查现有 _overview.md 是否足够新
  const overviewPath = path.join(space, '_overview.md');
  if (!force && overviewExists(overviewPath) && isRecent(overviewPath, 7)) {
    return NextResponse.json({ status: 'up-to-date', path: overviewPath });
  }
  
  // 3. 构建 prompt：把所有文件的标题+首段发给 LLM
  const fileDigests = files.map(f => ({
    path: f.path,
    excerpt: extractExcerpt(f.content, 200), // 前 200 字符
  }));
  
  // 4. 调用 LLM 生成综述
  const overview = await generateOverview(space, fileDigests);
  
  // 5. 保存为 _overview.md
  saveFileContent(overviewPath, overview);
  
  return NextResponse.json({ status: 'compiled', path: overviewPath });
}
```

#### 5.3 综述模板

LLM 输出格式：

```markdown
# [Space Name] — 知识综述

> 自动生成于 2026-04-09，基于 N 篇笔记。

## 核心概念

- **概念 A**：一句话解释 → 详见 [笔记路径]
- **概念 B**：...

## 关键发现

1. 发现描述 → 来源：[笔记路径]
2. ...

## 跨笔记关联

- [笔记 A] 和 [笔记 B] 都讨论了 X，但结论不同
- ...

## 知识空白

- 尚未覆盖 Y 方面
- Z 相关的笔记已过期（>90天未更新）

## 建议下一步

- 调研 [主题]
- 更新 [过期笔记]
```

#### 5.4 改动清单

| 文件 | 改动 | 大小 |
|------|------|------|
| `app/app/api/compile/route.ts` | 新建：编译 API | ~80 行 |
| `app/lib/compile.ts` | 新建：编译核心逻辑 + LLM 调用 | ~100 行 |
| `mcp/src/index.ts` | 增加 `mindos_compile` 工具 | ~20 行 |
| `app/lib/agent/tools.ts` | 增加 `compile` 工具 | ~25 行 |

---

## 数据流 / 状态流

### 整体改动架构图

```
                  ┌─────────────────────────────────────────┐
                  │              MindOS App                  │
                  │                                         │
                  │  ┌──────────┐  ┌──────────┐  ┌────────┐│
  User ──────────►│  │ Ask Panel│  │ Lint Page│  │Compile ││
                  │  │ +SaveBtn │  │ (P2 UI)  │  │ (P3)   ││
                  │  └────┬─────┘  └────┬─────┘  └───┬────┘│
                  │       │             │             │      │
                  │  ┌────▼─────────────▼─────────────▼────┐│
                  │  │            API Routes                ││
                  │  │  /api/file  /api/lint  /api/compile  ││
                  │  │  /api/ask   /api/bootstrap           ││
                  │  └────┬─────────────┬─────────────┬────┘│
                  │       │             │             │      │
                  │  ┌────▼─────────────▼─────────────▼────┐│
                  │  │          lib/ 核心逻辑               ││
                  │  │  save-insight.ts  lint.ts  compile.ts││
                  │  │  agent/prompt.ts  agent/tools.ts     ││
                  │  └─────────────────────────────────────┘│
                  └───────────────┬─────────────────────────┘
                                  │ HTTP fetch
                  ┌───────────────▼─────────────────────────┐
                  │           MCP Server (mcp/)              │
                  │                                         │
                  │  mindos_lint (new)                       │
                  │  mindos_compile (new)                    │
                  │  mindos_bootstrap (enhanced)             │
                  │  mindos_* (existing 20+ tools)           │
                  └─────────────────────────────────────────┘
                                  ▲
                                  │ MCP Protocol
                  ┌───────────────┴─────────────────────────┐
                  │         External Agents                  │
                  │   Claude Code / Cursor / Codex / etc.    │
                  └─────────────────────────────────────────┘
```

### Feature 1 数据流（查询回流）

```
用户提问 → Agent 读 KB → 生成回答 → 渲染在 MessageList
                                         │
                          [💾 SaveToKBButton] ← 用户点击
                                         │
                          SaveInsightDialog 弹出
                          ├─ suggestSavePath() → 预填路径
                          └─ 用户确认/修改
                                         │
                          POST /api/file { op: create_file }
                                         │
                          文件写入 KB ← change-log 追加
```

### Feature 2 数据流（知识体检）

```
用户触发（UI / CLI: mindos lint / MCP: mindos_lint）
         │
GET /api/lint?space=X&depth=shallow
         │
lib/lint.ts:
  ├─ collectAllFiles(space) → 文件列表
  ├─ findOrphans() → 扫描 backlinks，入链=0 的
  ├─ findStaleFiles(90d) → mtime 检查
  ├─ findBrokenLinks() → 正则扫描 [[links]] + [](paths)
  └─ findEmptyFiles() → content.trim().length < 50
         │
返回 LintReport JSON
         │
  UI 渲染 / CLI 输出 / MCP 返回给外部 Agent
```

---

## 影响范围

### 新增文件

| 文件 | 用途 |
|------|------|
| `app/lib/lint.ts` | 知识体检核心分析逻辑 |
| `app/lib/agent/save-insight.ts` | 保存路径建议逻辑 |
| `app/lib/compile.ts` | Space 编译核心逻辑 |
| `app/lib/file-index.ts` | Bootstrap file index 生成 |
| `app/app/api/lint/route.ts` | Lint API route |
| `app/app/api/compile/route.ts` | Compile API route |
| `app/components/ask/SaveInsightDialog.tsx` | 保存到 KB 对话框 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `app/components/ask/MessageList.tsx` | 增加 SaveToKBButton |
| `app/lib/agent/prompt.ts` | Agent/Organize prompt 增加指引 |
| `app/lib/agent/tools.ts` | 增加 lint + compile 工具，扩展 ORGANIZE_TOOL_NAMES |
| `app/app/api/bootstrap/route.ts` | 增加 file_index 字段 |
| `mcp/src/index.ts` | 增加 mindos_lint + mindos_compile |
| `skills/mindos/SKILL.md` | 文档更新（新工具） |
| `app/data/skills/mindos/SKILL.md` | 同步 |

### 不受影响的模块

- **Desktop/Electron**：纯前后端改动，不涉及 shell
- **A2A / ACP**：独立模块，不交叉
- **IM 集成**：独立模块，不交叉
- **CSS / 设计系统**：新 UI 复用现有组件（Dialog / Button / 状态色），无新色值

### 破坏性变更

无。所有改动都是新增功能或增强现有输出（bootstrap 新增字段，向后兼容）。

---

## 边界 case 与风险

### 边界 case

| # | 场景 | 处理方式 |
|---|------|---------|
| 1 | 用户保存空回答或纯 thinking block | SaveToKBButton 只在有实质文本内容时显示（`text.trim().length > 50`） |
| 2 | lint 扫描 > 1000 文件的大 KB | 分批处理 + 超时保护（30s）；返回部分结果 + "扫描未完成"标记 |
| 3 | lint 报告的孤立页实际是入口页（如 README） | 内置白名单排除：`README.md`, `INSTRUCTION.md`, `_overview.md`, `CONFIG.json` |
| 4 | bootstrap file_index 过大（> 500 文件） | 截断到 MAX_FILES_IN_INDEX=200，附加 "use list_files for full tree" |
| 5 | compile Space 只有 1-2 个文件 | 不调用 LLM，直接返回 "Space 文件太少，暂不需要综述" |
| 6 | 深度摄入：Organize 关联扫描建议更新系统文件 | Organize prompt 明确禁止修改 INSTRUCTION.md / README.md（已有 WRITE_TOOLS 守卫） |
| 7 | 用户连续保存同一回答多次 | 前端禁用按钮 + 检查路径是否已存在相同内容 |

### 风险

| 风险 | 概率 | 影响 | Mitigation |
|------|------|------|------------|
| Lint 误报：标记正常文件为"孤立" | 中 | 低 | 白名单 + 用户可忽略；不自动修复 |
| Compile 生成低质量综述 | 中 | 低 | 用户可删除/手动编辑 `_overview.md` |
| Bootstrap file_index 暴露敏感内容 | 低 | 中 | index 只含文件名 + 首行摘要，不含全文 |
| Organize 关联扫描增加 token 消耗 | 中 | 中 | 关联扫描只在 Agent 模式下启用，Chat/简单 Organize 不触发 |
| SaveInsight 对话框 UX 过重 | 低 | 中 | 极简设计：路径 + 预览 + 两个按钮，不加多余选项 |

---

## 实施顺序

```
Week 1: Feature 1 (查询回流) — 最小改动，最高用户价值
  - SaveToKBButton + SaveInsightDialog
  - suggestSavePath 逻辑
  - Agent prompt 增加回流指引

Week 2: Feature 3 (Bootstrap 增强) — 基础设施，服务后续功能
  - extractOneLiner + buildFileIndex
  - bootstrap API 增加 file_index

Week 3: Feature 2 (知识体检) — 独立模块，可并行
  - lib/lint.ts 核心分析
  - /api/lint route
  - MCP mindos_lint + Agent lint 工具

Week 4: Feature 4 (深度摄入) — 纯 prompt 改动，风险最低
  - Organize prompt 增加关联扫描指令
  - ORGANIZE_TOOL_NAMES 扩展

Later: Feature 5 (知识编译) — 依赖 LLM，成本/质量需验证
  - lib/compile.ts + /api/compile
  - MCP mindos_compile
```

---

## 验收标准

### Feature 1: 查询回流
- [ ] Assistant 消息气泡上显示 💾 按钮（hover 时出现，移动端常显）
- [ ] 点击弹出对话框，预填合理的保存路径
- [ ] 保存后文件出现在 KB 中，内容正确包含回答全文
- [ ] 空回答 / 纯 thinking block 不显示保存按钮
- [ ] 重复保存同一内容时给出提示

### Feature 2: 知识体检
- [ ] `GET /api/lint` 返回 `LintReport` JSON，包含 stats + orphans + stale + brokenLinks
- [ ] MCP `mindos_lint` 工具可被外部 Agent 调用
- [ ] Agent 工具 `lint` 可在对话中调用（"帮我检查一下知识库健康度"）
- [ ] 空 KB lint 不报错，返回空报告
- [ ] 系统文件（README/INSTRUCTION）不被标为孤立

### Feature 3: Bootstrap 增强
- [ ] `GET /api/bootstrap` 返回新的 `file_index` 字段
- [ ] file_index 包含目录树 + 每文件一句话摘要
- [ ] 500+ 文件的 KB 有截断保护，不超过 200 条目
- [ ] MCP `mindos_bootstrap` 自动包含新字段（无需改 MCP 代码）
- [ ] 性能：file_index 生成 < 1s（200 文件以内）

### Feature 4: 深度摄入
- [ ] AI Organize 完成后，Agent 主动搜索相关笔记并展示发现
- [ ] Agent 不会未经用户确认就修改现有文件
- [ ] 无相关笔记时不多余输出（静默跳过）

### Feature 5: 知识编译
- [ ] `mindos compile Research` 生成 `Research/_overview.md`
- [ ] 综述包含：核心概念、关键发现、知识空白、建议
- [ ] 7 天内重复编译跳过（除非 force=true）
- [ ] 文件数 < 3 的 Space 不编译
