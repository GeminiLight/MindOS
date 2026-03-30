# Spec: Space 体验增强（自动脚手架 + 首页 Space 分组）

## 目标

两件事，解决同一个问题——**让一级目录（Space）成为用户感知到的第一组织单元**：

1. **后端**：用户创建新 Space 时，自动生成 `INSTRUCTION.md` + `README.md`，保证 Agent 在任何 Space 中都能正确 bootstrap
2. **前端**：首页 "Recently Modified" 按 Space 分组展示，强化空间认知，提供直达入口

## 现状分析

### 知识库目录体系

MindOS 知识库的一级目录是用户的 **Space**（如 Profile、Notes、Workflows），每个 Space 通过两个文件引导 Agent 行为：

| 文件 | 作用 | 来源 |
|------|------|------|
| `INSTRUCTION.md` | Agent 在此目录的执行规则（bootstrap 第 5 步读取） | 模板预置 |
| `README.md` | 目录导航、结构说明 | 模板预置 |

### 问题

**后端问题**：
1. **模板 Space 有，自建 Space 没有**：en 模板预置 6 个 Space，每个都有 `INSTRUCTION.md` + `README.md`。用户自建的目录（如 `Learning/`）什么都没有
2. **Agent 行为降级**：`/api/bootstrap?target_dir=Learning` 返回 `target_instruction: undefined`，Agent 失去目录级引导
3. **用户不知道需要这些文件**：INSTRUCTION.md 是 MindOS 独特的 Agent 协议文件，用户不会主动创建
4. **根 README.md 不同步**：新 Space 不在导航索引里（违反 INSTRUCTION.md §5.1）

**前端问题**：
5. **空间认知缺失**：用户打开首页，Recent files 是扁平的时间线，5 个文件可能来自 3 个 Space，但 Space 信息被淹没在灰色小字路径里
6. **"回归用户"无处巡视**：几天没用的用户想看"各个区域什么状态"，只能去侧边栏点文件树
7. **结构感断裂**：GuideCard 说"你有 6 个区域"，往下一看只有零散文件列表

### 用户打开首页的三种心智模式

| 模式 | 用户在想 | 当前首页支持 |
|------|---------|------------|
| **意图驱动** | "我要问 AI 一个问题" | ✅ AI 命令栏 |
| **时间驱动** | "我刚才在弄什么" | ✅ Recent files |
| **空间驱动** | "我想去 Profile 看看" | ❌ 只能靠侧边栏 |

## 数据流 / 状态流

### Part A: 自动脚手架

```
用户/Agent 创建文件 "Learning/note.md"
  │
  ├─ fs-ops.ts: createFile() / writeFile()
  │   └─ mkdirSync("Learning/", { recursive: true })
  │
  ├─ 【新增】scaffoldIfNewSpace(mindRoot, filePath)
  │   ├─ 解析一级目录名："Learning"
  │   ├─ 检查：该目录有 INSTRUCTION.md 吗？
  │   │
  │   ├─ 没有 → 生成脚手架
  │   │   ├─ 写入 Learning/INSTRUCTION.md（通用模板）
  │   │   ├─ 写入 Learning/README.md（骨架）
  │   │   └─ 追加根 README.md 结构树
  │   │
  │   └─ 有 → 跳过（幂等）
  │
  └─ 返回原始结果（对调用方透明）
```

### Part B: 首页 Space 分组

```
page.tsx (Server Component)
  │
  ├─ getRecentlyModified(15)  → RecentFile[]（已有）
  ├─ 【新增】getTopLevelDirs() → SpaceInfo[]
  │   └─ 读 mindRoot 一级目录列表 + 每个目录的文件数
  │
  └─ <HomeContent recent={recent} spaces={spaces} />

HomeContent.tsx (Client Component)
  │
  ├─ 将 recent files 按一级目录分组
  │   → { spaceName: string, files: RecentFile[], fileCount: number }[]
  │
  ├─ 渲染分组时间线（有活动的 Space）
  │   ├─ Space 标题行（可点击跳转目录视图）
  │   └─ 该 Space 下的 recent files（最多 3 个，可展开）
  │
  └─ 渲染 "All Spaces" 行（补全无活动的 Space + Plugin 入口）
```

## 方案

### Part A: 自动脚手架

#### 新增 `space-scaffold.ts`

```typescript
// lib/core/space-scaffold.ts

import fs from 'fs';
import path from 'path';

const INSTRUCTION_TEMPLATE = (dirName: string) => `# ${dirName} Instruction Set

## Goal

- Define local execution rules for this directory.

## Local Rules

- Read root \`INSTRUCTION.md\` first.
- Then read this directory \`README.md\` for navigation.
- Keep edits minimal, structured, and traceable.

## Execution Order

1. Root \`INSTRUCTION.md\`
2. This directory \`INSTRUCTION.md\`
3. This directory \`README.md\` and target files

## Boundary

- Root rules win on conflict.
`;

const README_TEMPLATE = (dirName: string) => `# ${dirName}

## 📁 Structure

\`\`\`bash
${dirName}/
├── INSTRUCTION.md
├── README.md
└── (your files here)
\`\`\`

## 💡 Usage

(Describe the purpose and usage of this space.)
`;

/**
 * If filePath is inside a top-level directory that lacks INSTRUCTION.md,
 * auto-generate scaffolding files. Idempotent and fail-safe.
 *
 * Does NOT modify root README.md — that's the Agent's job per INSTRUCTION.md §5.1.
 * Automated string manipulation of user-editable markdown is fragile and risky.
 */
export function scaffoldIfNewSpace(mindRoot: string, filePath: string): void {
  try {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length < 2) return;

    const topDir = parts[0];
    if (topDir.startsWith('.')) return;

    const topDirAbs = path.join(mindRoot, topDir);
    const instructionPath = path.join(topDirAbs, 'INSTRUCTION.md');

    if (fs.existsSync(instructionPath)) return;

    const cleanName = topDir.replace(/^[\p{Emoji}\p{Emoji_Presentation}\s]+/u, '') || topDir;

    fs.writeFileSync(instructionPath, INSTRUCTION_TEMPLATE(cleanName), 'utf-8');

    const readmePath = path.join(topDirAbs, 'README.md');
    if (!fs.existsSync(readmePath)) {
      fs.writeFileSync(readmePath, README_TEMPLATE(cleanName), 'utf-8');
    }
  } catch {
    // Scaffold failure must never block the primary file operation
  }
}
```

#### 集成点：`fs-ops.ts`

只在 `createFile` 中触发（不在 `writeFile` 中）：

```typescript
import { scaffoldIfNewSpace } from './space-scaffold';

// createFile() 末尾加一行
export function createFile(mindRoot: string, filePath: string, initialContent = ''): void {
  // ... 原有逻辑 ...
  scaffoldIfNewSpace(mindRoot, filePath);  // ← 新增
}
```

**为什么不 hook `writeFile`**：`writeFile` 是覆盖写，用于更新已有文件，目录必然已存在。唯一例外是 Agent 对不存在的路径 `write_file`——但这时 `mkdirSync` 创建的中间目录不一定是用户意图的 "Space"，贸然生成脚手架可能造成困惑。`createFile` 语义明确（"新建文件"），是更安全的触发点。

### Part B: 首页 Space 分组

#### 数据层：`getTopLevelDirs()`

在 `page.tsx` 新增服务端数据获取：

```typescript
// app/page.tsx
import { getFileTree } from '@/lib/fs';

interface SpaceInfo {
  name: string;       // "👤 Profile"
  path: string;       // "👤 Profile/"
  fileCount: number;  // 子文件数量（递归）
}

function getTopLevelDirs(): SpaceInfo[] {
  const tree = getFileTree();
  return tree
    .filter(n => n.type === 'directory' && !n.name.startsWith('.'))
    .map(n => ({
      name: n.name,
      path: n.path + '/',
      fileCount: countFiles(n),
    }));
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}
```

传入 HomeContent：

```typescript
return <HomeContent recent={recent} existingFiles={existingFiles} spaces={getTopLevelDirs()} />;
```

#### 视图层：Space-Grouped Timeline

改造 HomeContent 的 "Recently Modified" section：

```
──── Recently Active ───────────────────────────

📝 Notes                              3 files · 2h ago
  · meeting-notes.md                        2h ago
  · idea-draft.md                           5h ago

👤 Profile                            1 file · 1d ago
  · Identity.md                             1d ago

🚀 Projects                           1 file · 2d ago
  · MindOS/roadmap.md                       2d ago

                                    [Show more ▾]

─── All Spaces ─────────────────────────────────
 📝 Notes(12)  👤 Profile(5)  🔗 Connections(3)
 🔄 Workflows(8)  📚 Resources(15)  🚀 Projects(4)
 📊 Graph  📋 TODO  🔀 Diff                    →
────────────────────────────────────────────────
```

**分组逻辑**：

```typescript
interface SpaceGroup {
  space: string;        // "📝 Notes"
  spacePath: string;    // "📝 Notes/"
  files: RecentFile[];  // 该 Space 下的 recent files
  latestMtime: number;  // 该组最新修改时间（用于组间排序）
  totalFiles: number;   // 该 Space 总文件数
}

function groupBySpace(recent: RecentFile[], spaces: SpaceInfo[]): SpaceGroup[] {
  const groups = new Map<string, SpaceGroup>();

  for (const file of recent) {
    const parts = file.path.split('/');
    if (parts.length < 2) continue; // root-level file → skip or "Other"
    const spaceName = parts[0];
    const spaceInfo = spaces.find(s => s.name === spaceName);

    if (!groups.has(spaceName)) {
      groups.set(spaceName, {
        space: spaceName,
        spacePath: spaceName + '/',
        files: [],
        latestMtime: 0,
        totalFiles: spaceInfo?.fileCount ?? 0,
      });
    }
    const g = groups.get(spaceName)!;
    g.files.push(file);
    g.latestMtime = Math.max(g.latestMtime, file.mtime);
  }

  // Sort groups by latest activity
  return [...groups.values()].sort((a, b) => b.latestMtime - a.latestMtime);
}
```

**组内展示规则**：

| 情况 | 展示 |
|------|------|
| 组内 ≤ 3 个文件 | 全部展示 |
| 组内 > 3 个文件 | 展示前 3 个，组标题显示 "+N more" |
| 根级文件 | 归入 "Other" 分组，排在最后 |

**"All Spaces" 行**：

- 展示**所有**一级目录（包括 Recent 中未出现的），每个显示 `emoji + name (fileCount)`
- 空 Space（0 文件）灰显，暗示"可以往这里加内容"
- 已有活动的 Space 正常色
- 整行可横向滚动（移动端友好）
- **Plugin chips 保留在 All Spaces 行下方**，不合并（语义不同：Space 是目录，Plugin 是渲染器入口）

**兜底规则**：`groupBySpace()` 返回空数组时（所有文件都在根级，或 spaces 为空），整个 section 回退到当前的扁平时间线，不分组。

#### 样式设计

```
Space 标题行：
┌─ 📝 Notes ────── 3 files · 2h ago ─────────┐
│  text-xs font-semibold uppercase tracking    │
│  amber color for Space name                  │
│  muted for metadata                          │
│  整行可点击 → /view/📝%20Notes/              │
└──────────────────────────────────────────────┘

组内文件：
  · meeting-notes.md                      2h ago
  text-sm, 左侧无 timeline dot，用 · 缩进
  与当前 timeline 视觉风格一致

All Spaces 行：
  flex flex-wrap gap-1.5，和 Plugin chips 相同样式
  每个 chip: px-2.5 py-1.5 rounded-lg text-xs
  有文件的: text-foreground
  空的: text-muted-foreground opacity-50
```

#### i18n

```typescript
// i18n-en.ts
home: {
  // ...existing...
  recentlyActive: 'Recently Active',
  allSpaces: 'All Spaces',
  nFiles: (n: number) => `${n} file${n === 1 ? '' : 's'}`,
  emptySpace: 'Empty',
}

// i18n-zh.ts
home: {
  // ...existing...
  recentlyActive: '最近活跃',
  allSpaces: '所有空间',
  nFiles: (n: number) => `${n} 个文件`,
  emptySpace: '空',
}
```

### 不做什么（显式排除）

| 排除项 | 原因 |
|--------|------|
| **AI 生成 README 内容** | 依赖 API Key，不可靠 |
| **Space 管理 UI（增删改）** | 一级目录 6-10 个，不需要专门管理界面 |
| **二级目录脚手架** | INSTRUCTION.md §3 明确说"Avoid creating them by default" |
| **i18n 模板内容** | 检测语言生成对应模板增加复杂度，先用英文，用户可改 |
| **Space 创建弹窗** | 脚手架是静默辅助，不应打断操作流 |
| **独立 Spaces section** | 不加首页层级数量，改造 Recent 区域即可 |
| **Space 图标自定义** | 直接用目录名自带的 emoji，无额外配置 |

## 影响范围

### 新增

| 文件 | 说明 |
|------|------|
| `app/lib/core/space-scaffold.ts` | `scaffoldIfNewSpace()` + 模板 + `appendToRootReadme()` |
| `app/__tests__/core/space-scaffold.test.ts` | 脚手架单元测试 |

### 修改

| 文件 | 改动 |
|------|------|
| `app/lib/core/fs-ops.ts` | `createFile()` 末尾加 1 行调用脚手架 |
| `app/app/page.tsx` | 新增 `getTopLevelDirs()`，传 `spaces` prop |
| `app/components/HomeContent.tsx` | "Recently Modified" 改为 Space-Grouped Timeline + "All Spaces" 行 |
| `app/lib/i18n-en.ts` | 新增 `home.recentlyActive` / `home.allSpaces` / `home.nFiles` |
| `app/lib/i18n-zh.ts` | 同上中文版 |

### 不改动

| 文件 | 原因 |
|------|------|
| `app/lib/agent/tools.ts` | 工具层不改，脚手架在 fs-ops 层透明触发 |
| `app/app/api/file/route.ts` | API 层不改，调用链自动生效 |
| MCP Server | 同一套 fs 函数，自动生效 |
| 模板文件 (`templates/`) | 已有 Space 不受影响（幂等） |

## 边界 case 与风险

### Part A: 脚手架

| # | 场景 | 处理 |
|---|------|------|
| 1 | `Learning/sub/deep/file.md`（多级嵌套） | 只取第一级 `Learning/` |
| 2 | 根级文件 `notes.md` | `parts.length < 2` → 跳过 |
| 3 | `.agents/skills/xxx.md` | `startsWith('.')` → 跳过 |
| 4 | 已有 INSTRUCTION.md 的目录 | 幂等跳过 |
| 5 | 已有 README.md 但无 INSTRUCTION.md | 只补 INSTRUCTION.md |
| 6 | 根 README.md 更新 | 不自动修改——由 Agent 按 INSTRUCTION.md §5.1 自行更新 |
| 7 | emoji 目录名 `📖 Learning/` | 正则剥离 emoji 作模板标题 |
| 8 | 脚手架写入失败 | try-catch 包裹，不阻塞主操作 |

### Part B: 首页分组

| # | 场景 | 处理 |
|---|------|------|
| 9 | 所有 recent files 都在同一个 Space | 只展示 1 个分组 + All Spaces 行 |
| 10 | 根级文件（不属于任何 Space） | 归入 "Other" 分组 |
| 11 | 空知识库 | 继续走 OnboardingView |
| 12 | 新用户只有模板文件 | 正常分组（模板文件也有 mtime） |
| 13 | 一级目录 > 10 个 | All Spaces 行 flex-wrap 自动换行 |
| 14 | spaces prop 为空（异常） | 回退到扁平时间线 |
| 15 | 所有 recent files 都在根级 | `groupBySpace()` 返回空数组 → 回退到扁平时间线 |
| 16 | `fileCount` 包含 INSTRUCTION.md/README.md | 可接受，用户不会在意精确数值 |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 脚手架拖慢文件创建 | 低 | 两次 `writeFileSync` < 1ms，try-catch 不阻塞 |
| 分组逻辑在大知识库（1000+ 文件）下性能 | 低 | `getRecentlyModified(15)` 只返回 15 条，分组是 O(n) 其中 n ≤ 15 |
| 首页布局变化导致视觉回归 | 中 | 分组后总信息量不变，只改排列方式；兜底到扁平模式 |

## 验收标准

### Part A: 自动脚手架

- [ ] `create_file("Learning/note.md")` → `Learning/INSTRUCTION.md` + `Learning/README.md` 自动出现
- [ ] 已有 INSTRUCTION.md 的目录不被覆盖
- [ ] 已有 README.md 但无 INSTRUCTION.md → 只补 INSTRUCTION.md
- [ ] `.agents/` 等隐藏目录不触发
- [ ] 根级文件创建不触发
- [ ] 脚手架失败不阻塞主操作
- [ ] 单元测试覆盖以上 case

### Part B: 首页 Space 分组

- [ ] 首页 "Recently Active" 按 Space 分组展示
- [ ] Space 标题行可点击，跳转到目录视图
- [ ] 组内最多展示 3 个文件
- [ ] 底部 "All Spaces" 行展示所有一级目录
- [ ] Plugin chips 保留在 All Spaces 行下方
- [ ] 空 Space 灰显
- [ ] 根级文件归入 "Other" 分组
- [ ] 分组为空时回退到扁平时间线
- [ ] i18n en/zh 正常
- [ ] 移动端 All Spaces 行正常换行

## 开发路线

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | `space-scaffold.ts` + 集成 `fs-ops.ts` + 单元测试 | 0.5d |
| 2 | `page.tsx` 新增 `getTopLevelDirs()` | 0.25d |
| 3 | `HomeContent.tsx` 分组逻辑 + Space-Grouped Timeline + All Spaces 行 | 0.75d |
| 4 | i18n + 兜底 + 视觉调优 | 0.25d |

**总计：~1.5-2d**
