# Spec: Space-Aware Sidebar（文件树空间感知）

## 目标

让 Sidebar 文件树在视觉和交互层面区分「空间」（含 `INSTRUCTION.md` 的目录）与普通文件夹，隐藏系统文件（`INSTRUCTION.md`、`README.md`），并在用户点击空间目录时，于文件列表上方内联展示空间的规则摘要与说明，让用户**不打开文件就能感知空间的上下文**。

## 现状分析

### 视觉层

`FileTree.tsx` 对所有目录一视同仁——统一的 `Folder` / `FolderOpen` 图标 + `text-yellow-400` 颜色。用户扫视文件树时无法区分"这是一个有执行规则的空间"和"这只是一个分类子文件夹"。

```tsx
// 当前 DirectoryNode — 所有目录都是黄色文件夹
{open
  ? <FolderOpen size={14} className="text-yellow-400 shrink-0" />
  : <Folder size={14} className="text-yellow-400 shrink-0" />
}
```

### 系统文件噪声

`INSTRUCTION.md` 和 `README.md` 是 MindOS 的结构性系统文件，用户几乎不会在文件树中主动点击编辑。它们在每个空间中占据 2 行视觉位置，且与用户内容文件视觉权重相同，增加了认知负担。

### 交互层

空间目录支持双击重命名——与普通文件夹行为一致。但空间重命名需要调用 `renameSpaceDirectory`（更新 INSTRUCTION.md 内部引用等），而非 `renameFile`。当前的双击触发 `renameFileAction`，语义不匹配。同时，空间的删除应当走确认流程，不应与普通文件/文件夹混淆。

### 空间点击体验

当前点击空间目录只是展开/折叠子节点。用户无法快速了解"这个空间是做什么的""有什么规则"，必须手动找到并打开 `INSTRUCTION.md` 或 `README.md`。

## 数据流 / 状态流

```
Server: buildFileTree(dirPath)
  │
  ├─ 遍历目录，构建 FileNode[]
  ├─ 【新增】对 type=directory 的节点，检查 children 中是否有 INSTRUCTION.md
  │   └─ 有 → 设置 node.isSpace = true
  │   └─ 无 → 不设置（默认 undefined/false）
  │
  └─ 返回带 isSpace 标记的 FileNode[]

Client: FileTree → DirectoryNode
  │
  ├─ node.isSpace === true?
  │   ├─ 图标：Layers (amber) 替代 Folder (yellow-400)
  │   ├─ 左边框：2px border-l-amber（半透明）
  │   ├─ 双击：禁用（不触发 inline rename）
  │   ├─ 右键：显示 ContextMenu [Edit Rules | Rename Space | ── | Delete Space]
  │   ├─ Hover actions：[+ 新建文件] [📜 编辑规则]（无 ✏ 重命名）
  │   ├─ 子文件过滤：隐藏 INSTRUCTION.md 和 README.md
  │   └─ 展开后上方：SpaceHeader（INSTRUCTION 摘要 + README 摘要）
  │
  └─ node.isSpace !== true（普通文件夹）
      ├─ 图标/颜色：保持现状 Folder yellow-400
      ├─ 双击/hover actions：保持现状
      └─ 子文件过滤：隐藏 README.md

SpaceHeader 内联展示区（展开态 Space 目录内部、文件列表上方）
  │
  ├─ 读取 INSTRUCTION.md 前 N 行（规则摘要）
  ├─ 读取 README.md 前 N 行（空间说明）
  ├─ 以双卡片形式展示于可滚动容器中（max-h-[140px]）
  │   ├─ Rules 卡片：INSTRUCTION.md 摘要 + [查看全部] → 跳转 INSTRUCTION.md
  │   ├─ About 卡片：README.md 摘要 + [查看全部] → 跳转 README.md
  │   ├─ 容器支持上下滚动（overscroll-behavior: contain，不冒泡）
  │   └─ 默认各展示最多 3 行正文
  │
  └─ 数据来源：Server Component 在 buildFileTree 时预读
     或 Client 侧 fetch /api/file?op=read&path=xxx
```

## 方案

### 1. 数据层：FileNode 扩展

#### 1.1 类型扩展

```typescript
// app/lib/core/types.ts
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
  isSpace?: boolean;         // 目录下存在 INSTRUCTION.md
  spacePreview?: {           // 空间预览数据（仅 isSpace=true 时存在）
    instructionLines: string[];  // INSTRUCTION.md 正文前 N 行
    readmeLines: string[];       // README.md 正文前 N 行
  };
}
```

#### 1.2 buildFileTree 增强

在 `app/lib/fs.ts` 的 `buildFileTree` 中，对每个 directory 节点：

```typescript
if (entry.isDirectory()) {
  if (IGNORED_DIRS.has(entry.name)) continue;
  const children = buildFileTree(fullPath);
  if (children.length > 0) {
    const hasInstruction = children.some(c => c.type === 'file' && c.name === 'INSTRUCTION.md');
    const node: FileNode = {
      name: entry.name,
      path: relativePath,
      type: 'directory',
      children,
      isSpace: hasInstruction || undefined,
    };
    if (hasInstruction) {
      node.spacePreview = buildSpacePreview(fullPath);
    }
    nodes.push(node);
  }
}
```

#### 1.3 spacePreview 构建

```typescript
// app/lib/fs.ts
const PREVIEW_MAX_LINES = 3; // 最多展示的正文行数

function buildSpacePreview(dirAbsPath: string): FileNode['spacePreview'] {
  const extractBodyLines = (filePath: string, maxLines: number): string[] => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const bodyLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue; // 跳过标题和空行
        bodyLines.push(trimmed);
        if (bodyLines.length >= maxLines) break;
      }
      return bodyLines;
    } catch { return []; }
  };

  return {
    instructionLines: extractBodyLines(
      path.join(dirAbsPath, 'INSTRUCTION.md'), PREVIEW_MAX_LINES
    ),
    readmeLines: extractBodyLines(
      path.join(dirAbsPath, 'README.md'), PREVIEW_MAX_LINES
    ),
  };
}
```

**性能考量**：`buildSpacePreview` 仅在 `isSpace=true` 时触发，每个空间读 2 个小文件各取前几行，典型知识库 6-10 个空间，开销可忽略（< 5ms 总计）。

### 2. 视觉层：空间 vs 普通文件夹

#### 2.1 空间目录（isSpace=true）

```
  ┌─────────────────────────────────────────────┐
  │ ▸ ◇  📝 笔记                          12 ▸ │  ← Layers 图标，amber 色
  ┊                                             ┊  ← 左侧 2px amber border
  │   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
  │   │ 📜 Rules                              │ │  ← SpaceHeader card
  │   │ · Read root INSTRUCTION.md first.     │ │
  │   │ · Keep edits minimal, structured.     │ │
  │   │                               查看全部 │ │  ← 点击跳转 INSTRUCTION.md
  │   │                                       │ │
  │   │ 📖 About                              │ │
  │   │ · 个人学习笔记与知识沉淀              │ │
  │   │                               查看全部 │ │  ← 点击跳转 README.md
  │   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
  │     📄 meeting-notes.md                     │  ← 内容文件（无 INSTRUCTION/README）
  │     📄 idea-draft.md                        │
  │     📁 归档/                                │
  └─────────────────────────────────────────────┘
```

- **图标**：`Layers` (lucide) 替代 `Folder`/`FolderOpen`，颜色使用品牌色 `text-amber`（对应 CSS 变量 `var(--amber)`），而非硬编码 `yellow-400`
- **左边框**：`border-l-2` + amber 色半透明（`border-amber/30`），从空间行延伸到子节点区域底部，传达"这些文件都属于这个空间"
- **文件数 badge**：折叠态时，空间名称右侧显示内容文件数（不含 INSTRUCTION.md/README.md），使用 `text-muted-foreground text-xs`
- **子文件过滤**：`INSTRUCTION.md` 和 `README.md` 不在文件列表中渲染

#### 2.2 普通文件夹

- 图标/颜色保持现状：`Folder`/`FolderOpen` + `text-yellow-400`
- **子文件过滤**：`README.md` 不在文件列表中渲染（与空间策略对齐）
- 其余交互保持现状（双击重命名、hover [+] [✏]）

#### 2.3 嵌套空间（depth > 0 但 isSpace=true）

- 仅图标换为 `Layers` + amber 色，**不加左边框**，避免嵌套边框视觉混乱
- SpaceHeader 正常显示
- 同样隐藏 INSTRUCTION.md/README.md

### 3. 交互层

#### 3.1 空间双击禁用

在 `DirectoryNode` 中，当 `node.isSpace` 时：
- `onDoubleClick` 设为 no-op（不触发 inline rename）
- 原因：空间重命名需调用 `renameSpaceDirectory`（而非 `renameFile`），涉及 INSTRUCTION.md 内部标题更新

#### 3.2 空间右键菜单

空间目录支持右键（`onContextMenu`），弹出 ContextMenu：

| 菜单项 | 图标 | 行为 |
|--------|------|------|
| Edit Rules | `ScrollText` | 跳转到 `/view/{spacePath}/INSTRUCTION.md` |
| Rename Space | `Pencil` | 弹出 inline rename input，提交时调用 `renameSpaceAction` |
| ──（分隔线）── | | |
| Delete Space | `Trash2` | 确认弹窗（"删除空间 {name} 及其所有文件？此操作不可撤销"），确认后调用 `deleteSpaceAction` |

视觉与交互规范：

```
┌───────────────────────┐
│ 📜  Edit Rules        │  ← 普通行
│ ✏️  Rename Space      │  ← 普通行
│───────────────────────│  ← 分隔线 border-border/50, my-1
│ 🗑  Delete Space      │  ← text-error, hover:bg-error/10
└───────────────────────┘
```

- ContextMenu 使用 `position: fixed`，`z-50`（高于 sidebar `z-30` 和 Panel overlay `z-40`）
- 宽度 `min-w-[180px]`，背景 `bg-card`，圆角 `rounded-lg`，阴影 `shadow-lg`，边框 `border border-border`
- 菜单项高度 `py-2 px-3`，`text-sm`，hover 态 `bg-muted`
- Delete 行文字 `text-error`，hover 态 `bg-error/10`（危险操作视觉强调）
- ESC 或点击菜单外部关闭
- 边界检测：若菜单底部超出 viewport，向上弹出；若右侧超出，向左偏移

#### 3.3 新增 Server Actions

```typescript
// app/lib/actions.ts

export async function renameSpaceAction(
  spacePath: string,
  newName: string
): Promise<{ success: boolean; newPath?: string; error?: string }> {
  try {
    const newPath = renameSpace(spacePath, newName);
    revalidatePath('/', 'layout');
    return { success: true, newPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to rename space' };
  }
}

export async function deleteSpaceAction(
  spacePath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 递归删除目录
    deleteDirectory(spacePath);
    revalidatePath('/', 'layout');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete space' };
  }
}
```

`deleteDirectory` 需新增——当前 `deleteFile` 只删除单个文件，不支持递归删除目录。使用 `fs.rmSync(resolved, { recursive: true, force: true })`，加 `assertWithinRoot` 防护。

#### 3.4 空间 Hover Actions

| 按钮 | 图标 | 行为 | 条件 |
|------|------|------|------|
| 新建文件 | `Plus` | 现有行为不变 | 始终显示 |
| 编辑规则 | `ScrollText` | 跳转到 `INSTRUCTION.md` | isSpace |
| 重命名 | `Pencil` | 现有行为 | **不显示**（仅右键） |

对比普通文件夹 hover actions：`[Plus]` `[Pencil]`（保持现状）。

### 4. SpaceHeader 内联展示区

#### 4.1 展示位置

当空间目录展开时，在子文件列表**上方**插入 SpaceHeader 组件。

#### 4.2 组件结构

```tsx
function SpaceHeader({ preview, spacePath, depth }: {
  preview: FileNode['spacePreview'];
  spacePath: string;
  depth: number;
}) {
  // 外层：固定高度容器，overflow-y-auto 支持内容滚动
  // 内层：Rules 卡片 + About 卡片，垂直排列
  // 缩进对齐子文件（paddingLeft = (depth+1) * 12 + 8）
}
```

#### 4.3 整体布局

SpaceHeader 是一个**固定最大高度的可滚动容器**，内含两张卡片（Rules + About）垂直排列。当内容超出容器高度时，用户可以上下滚动查看。

```
┌──────────────────── SpaceHeader 容器 ────────────────┐
│  max-h-[140px], overflow-y-auto, scroll-smooth       │
│  scrollbar: thin, 仅 hover 时可见                     │
│                                                       │
│  ┌──────────────── Rules Card ──────────────────┐    │
│  │ 📜 Rules                                     │    │
│  │ · Read root INSTRUCTION.md first.            │    │
│  │ · Keep edits minimal, structured.            │    │
│  │ · Then read this directory README.md.        │    │
│  │                                     查看全部 │    │  ← 点击跳转 INSTRUCTION.md
│  └──────────────────────────────────────────────┘    │
│                    gap-1.5                            │
│  ┌──────────────── About Card ──────────────────┐    │
│  │ 📖 About                                     │    │
│  │ · 个人学习笔记与知识沉淀                     │    │
│  │                                     查看全部 │    │  ← 点击跳转 README.md
│  └──────────────────────────────────────────────┘    │
│                                                       │
└───────────────────────────────────────────────────────┘
  ↕ 用户可上下滚动                        8px mb ↓ 文件列表
```

#### 4.4 卡片视觉规范

每张卡片的样式：

| 属性 | 值 | 说明 |
|------|------|------|
| 背景 | `bg-muted/30` | 微弱底色，不抢视觉 |
| 边框 | `border border-border/40` | 轻边框区隔 |
| 圆角 | `rounded-md` | 与设计系统对齐 |
| 内边距 | `px-2.5 py-2` | 紧凑但不拥挤 |
| 标题 | `text-xs font-medium text-muted-foreground` | 图标 + 文字，如 `📜 Rules` |
| 正文行 | `text-xs text-muted-foreground/80 leading-relaxed` | 每行前缀 `·`，与文件树对齐 |
| "查看全部" | `text-xs text-amber hover:underline cursor-pointer` | 右对齐，点击跳转 |

图标选择：
- Rules 标题旁：`ScrollText` (lucide)，`size={12}`，`text-muted-foreground`
- About 标题旁：`BookOpen` (lucide)，`size={12}`，`text-muted-foreground`

#### 4.5 滚动行为

| 属性 | 值 | 说明 |
|------|------|------|
| 容器最大高度 | `max-h-[140px]` | 约容纳 Rules 卡片完整 + About 卡片一半，暗示可滚动 |
| 溢出 | `overflow-y-auto` | 仅内容超出时出现滚动 |
| 滚动条 | `scrollbar-thin scrollbar-thumb-border/50 scrollbar-track-transparent` | Tailwind scrollbar 插件，细滚动条 |
| 滚动条可见性 | hover 时渐显 | `opacity-0 group-hover/header:opacity-100 transition-opacity` |
| 滚动平滑 | `scroll-smooth` | 触摸设备友好 |
| 渐变遮罩 | 底部 `linear-gradient(transparent, bg-card)` 8px | 当内容被截断时，底部渐变提示"下方还有内容" |

**滚动不影响外层文件树滚动**：SpaceHeader 容器捕获滚动事件（`overscroll-behavior: contain`），滚动到边界后不会冒泡到父级 Panel 的 `overflow-y-auto`。

#### 4.6 空状态与条件渲染

| 场景 | 渲染行为 |
|------|---------|
| `instructionLines` 和 `readmeLines` 都为空 | 不渲染 SpaceHeader |
| 仅 `instructionLines` 为空 | 只渲染 About 卡片，不需要滚动容器 |
| 仅 `readmeLines` 为空 | 只渲染 Rules 卡片，不需要滚动容器 |
| 两者都有内容 | 渲染双卡片 + 滚动容器 |

只有一张卡片时，取消 `max-h` 限制（单卡片内容 ≤ 3 行，不会过高），不显示滚动条和渐变遮罩。

#### 4.7 响应式

- 宽度跟随 Panel 宽度，padding 对齐子文件缩进
- 文本截断用 `line-clamp-1` 或 `truncate`，保证单行不溢出
- 移动端 drawer（max-width 320px）中，卡片 padding 适当缩小（`px-2 py-1.5`）

### 5. 系统文件隐藏策略

#### 5.1 隐藏规则

| 文件 | 在空间内 | 在普通文件夹内 | 在根目录 |
|------|---------|-------------|---------|
| `INSTRUCTION.md` | 隐藏 | 不隐藏（非系统文件） | 不隐藏 |
| `README.md` | 隐藏 | 隐藏 | 不隐藏 |

#### 5.2 实现位置

在 `FileTree` 组件的 `nodes.map()` 渲染时过滤：

```typescript
const filteredNodes = nodes.filter(node => {
  if (node.type !== 'file') return true;
  // 空间内：隐藏 INSTRUCTION.md 和 README.md
  if (parentIsSpace && (node.name === 'INSTRUCTION.md' || node.name === 'README.md')) return false;
  // 普通文件夹内：隐藏 README.md
  if (!parentIsSpace && node.name === 'README.md') return false;
  return true;
});
```

需要从父 `DirectoryNode` 向子 `FileTree` 传递 `parentIsSpace` prop。

#### 5.3 文件数 badge 计算

空间名称旁的文件数 badge 应排除隐藏的系统文件：

```typescript
const contentFileCount = (node.children ?? [])
  .filter(c => c.type === 'file' && c.name !== 'INSTRUCTION.md' && c.name !== 'README.md')
  .length
  + (node.children ?? [])
    .filter(c => c.type === 'directory')
    .reduce((sum, c) => sum + countContentFiles(c), 0);
```

### 6. i18n

```typescript
// 新增 key — English
fileTree: {
  // ...existing...
  rules: 'Rules',
  about: 'About',
  viewAll: 'View all',
  editRules: 'Edit Rules',
  renameSpace: 'Rename Space',
  deleteSpace: 'Delete Space',
  confirmDeleteSpace: (name: string) => `Delete space "${name}" and all its files? This cannot be undone.`,
  nContentFiles: (n: number) => `${n}`,
}

// 新增 key — 中文
fileTree: {
  // ...existing...
  rules: '规则',
  about: '说明',
  viewAll: '查看全部',
  editRules: '编辑规则',
  renameSpace: '重命名空间',
  deleteSpace: '删除空间',
  confirmDeleteSpace: (name: string) => `删除空间「${name}」及其所有文件？此操作不可撤销。`,
  nContentFiles: (n: number) => `${n}`,
}
```

## 影响范围

### 变更文件列表

| 文件 | 改动 |
|------|------|
| `app/lib/core/types.ts` | `FileNode` 增加 `isSpace`、`spacePreview` 字段 |
| `app/lib/fs.ts` | `buildFileTree` 检测 `isSpace` + 构建 `spacePreview` |
| `app/components/FileTree.tsx` | 空间视觉差异、系统文件过滤、SpaceHeader、右键菜单、双击禁用 |
| `app/lib/actions.ts` | 新增 `renameSpaceAction`、`deleteSpaceAction` |
| `app/lib/fs.ts` | 新增 `deleteDirectory` 公开方法 |
| `app/lib/core/fs-ops.ts` | 新增 `deleteDirectory` 核心实现 |
| `app/lib/i18n-en.ts` | 新增 fileTree 相关 key |
| `app/lib/i18n-zh.ts` | 同上中文版 |

### 受影响但不修改的模块

| 模块 | 原因 |
|------|------|
| `SidebarLayout.tsx` | 仅传递 `fileTree` prop，类型兼容（`isSpace` 可选） |
| `Panel.tsx` | 同上 |
| `Sidebar.tsx`（legacy） | 同上 |
| Home page (`page.tsx`) | 不使用 FileTree，不受影响 |
| MCP Server | `FileNode` 新字段可选，序列化兼容 |
| API routes | 不涉及 |

### 无破坏性变更

`FileNode.isSpace` 和 `FileNode.spacePreview` 均为可选字段，现有消费方无需修改即可正常工作。

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | 目录有 INSTRUCTION.md 但无 README.md | `spacePreview.readmeLines` 为空数组，SpaceHeader 只显示 Rules 部分 |
| 2 | INSTRUCTION.md 为空文件 | `instructionLines` 为空数组，SpaceHeader 不显示 Rules 部分 |
| 3 | 二者都为空 | SpaceHeader 整体不渲染 |
| 4 | 嵌套空间（子目录也有 INSTRUCTION.md） | 仅图标换色，不加边框，避免多层嵌套边框 |
| 5 | 用户手动在子目录创建 INSTRUCTION.md | 正确识别为嵌套空间，行为一致 |
| 6 | 空间内只有 INSTRUCTION.md + README.md（无其他文件） | 系统文件隐藏后，子文件区域为空；SpaceHeader 仍正常展示；badge 显示 "0" |
| 7 | 空间重命名后 INSTRUCTION.md 内部标题不更新 | `renameSpaceDirectory` 已处理（只改目录名），INSTRUCTION.md 标题由用户/Agent 维护 |
| 8 | 右键菜单在 Panel 边缘溢出 | ContextMenu 使用 `position: fixed` + viewport 边界检测 |
| 9 | 根目录的 INSTRUCTION.md / README.md | 根目录不是"空间"，不触发隐藏（depth=0 且 path 无 `/`） |
| 10 | 文件树刷新时 spacePreview 数据过时 | 与现有 5s cache TTL 一致，写入操作会 invalidateCache |
| 11 | 删除空间后当前路由指向被删文件 | 与现有 `deleteFile` 行为一致：检测 `currentPath`，若命中则 `router.push('/')` |
| 12 | 移动端 drawer 中的右键菜单 | 移动端无鼠标右键；长按触发同等菜单，或通过 hover actions 的 `...` 更多菜单触发 |

### 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| `buildSpacePreview` 增加文件树构建耗时 | 低 | 仅读 isSpace 目录的 2 个文件各前几行，6-10 个空间 < 5ms |
| SpaceHeader 使 sidebar 内容更高，可能推远文件列表 | 中 | 设计紧凑（每个 preview 约 80-100px 高），且仅展开态显示 |
| 右键菜单组件增加 bundle size | 低 | 原生 DOM 事件 + 绝对定位 div，不引入第三方库 |
| `deleteDirectory` 递归删除是危险操作 | 中 | 二次确认弹窗 + `assertWithinRoot` 路径防护 + 只有 isSpace 目录才显示此菜单项 |

## 验收标准

### 数据层
- [ ] `FileNode.isSpace` 对含 `INSTRUCTION.md` 的目录标记为 `true`
- [ ] `FileNode.spacePreview` 正确提取 INSTRUCTION.md 和 README.md 的正文前 N 行
- [ ] 无 INSTRUCTION.md 的目录 `isSpace` 为 `undefined`
- [ ] 新增的 `deleteDirectory` 有 `assertWithinRoot` 防护
- [ ] 5s cache 刷新后 `isSpace` 和 `spacePreview` 反映最新文件系统状态

### 视觉层
- [ ] 空间目录使用 `Layers` 图标 + amber 色
- [ ] 空间目录有 2px 左边框（amber 半透明），延伸至子节点底部
- [ ] 普通文件夹视觉保持不变（黄色文件夹图标）
- [ ] 嵌套空间只换图标，不加边框
- [ ] 空间折叠态显示内容文件数 badge
- [ ] INSTRUCTION.md 和 README.md 不出现在空间的文件列表中
- [ ] README.md 不出现在普通文件夹的文件列表中
- [ ] 根目录下的 INSTRUCTION.md 和 README.md 正常显示

### 交互层
- [ ] 空间目录双击不触发 inline rename
- [ ] 空间目录右键弹出菜单：Edit Rules / Rename Space / ── / Delete Space
- [ ] Edit Rules 跳转到 `/view/{spacePath}/INSTRUCTION.md`
- [ ] Rename Space 弹出 inline rename input，调用 `renameSpaceAction`，成功后刷新文件树
- [ ] Delete Space 弹出确认弹窗，确认后调用 `deleteSpaceAction`
- [ ] Delete Space 菜单项使用 `text-error` 色 + 分隔线隔开
- [ ] 空间 hover 显示 [+ 新建文件] [📜 编辑规则]，不显示 [✏ 重命名]
- [ ] 普通文件夹 hover 保持现状 [+ 新建文件] [✏ 重命名]
- [ ] 右键菜单 `z-50`，`position: fixed`，带 viewport 边界检测
- [ ] ESC 关闭右键菜单
- [ ] 点击菜单外部关闭右键菜单

### SpaceHeader
- [ ] 空间展开时，文件列表上方显示 SpaceHeader 可滚动容器
- [ ] 容器最大高度 `max-h-[140px]`，`overflow-y-auto`
- [ ] 容器内含 Rules 卡片 + About 卡片，垂直排列
- [ ] Rules 卡片展示 INSTRUCTION.md 正文前 3 行（标题 `📜 Rules`）
- [ ] About 卡片展示 README.md 正文前 3 行（标题 `📖 About`）
- [ ] "查看全部" 点击跳转到对应文件页面
- [ ] 滚动条细窄，仅 hover 时渐显
- [ ] 内容被截断时底部有渐变遮罩提示
- [ ] 滚动不冒泡到父级 Panel（`overscroll-behavior: contain`）
- [ ] 只有一张卡片时不限制高度、不显示滚动条
- [ ] 两者都为空时不渲染 SpaceHeader
- [ ] SpaceHeader 视觉紧凑，不喧宾夺主

### i18n
- [ ] 所有新增文案有 en/zh 双语

### 测试
- [ ] `buildFileTree` 正确标记 `isSpace`
- [ ] `buildSpacePreview` 提取正文行、跳过标题和空行
- [ ] `deleteDirectory` 递归删除、路径防护、目录不存在时报错
- [ ] `renameSpaceAction` / `deleteSpaceAction` 成功和失败路径

## 开发路线

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | `FileNode` 类型扩展 + `buildFileTree` 增加 `isSpace` 检测 + `buildSpacePreview` | 0.5d |
| 2 | `deleteDirectory` 核心实现 + `renameSpaceAction` / `deleteSpaceAction` | 0.5d |
| 3 | `FileTree.tsx` 空间视觉差异（图标、边框、badge、系统文件隐藏） | 0.5d |
| 4 | SpaceHeader 组件 | 0.5d |
| 5 | 右键菜单 + 双击禁用 + hover actions 差异化 | 0.5d |
| 6 | i18n + 测试 + 视觉调优 | 0.5d |

**总计：~3d**
