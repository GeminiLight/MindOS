# Task Spec: 文件/目录视图 UX 细节优化

---

## 背景

当前 GUI 在目录浏览和文件阅读层面有三个可感知的体验缺失：

1. **目录 Grid 密度一刀切**：`DirView.tsx` grid 模式下，文件夹和文件使用完全相同的卡片尺寸（含图标 + 名称 + 元信息）。文件夹本质是导航节点（不需要 mtime），而文件需要更多上下文（修改时间、大小）。二者混排时视觉层次不清晰。
2. **文件 topbar 缺少图标**：侧边栏 `FileTree.tsx` 每个条目都有文件类型图标（FileText / Table / Folder），但文件视图 `ViewPageClient.tsx` 的 Breadcrumb 区域纯文本，视觉不一致。
3. **无文档内搜索**：编辑模式（CodeMirror 6）未引入 `@codemirror/search`；阅读模式没有 ⌘F 搜索高亮。对知识库场景来说，长文档内查找是高频操作。

---

## 目标

- 目录 grid 中文件夹卡片更紧凑，文件卡片保持当前信息量
- 文件视图 topbar 的最后一级路径前展示文件类型图标，与侧边栏保持一致
- 支持 ⌘F 文档内搜索，编辑模式和阅读模式均可用

---

## 方案

### 1. 目录视图卡片密度分层

**文件**: `app/components/DirView.tsx`

**Grid 模式改动**：

- 文件夹卡片：去掉 mtime（本来也没有），缩小纵向 padding（`p-4` → `p-3`），图标从 28px → 22px，整体更紧凑
- 文件卡片：保持当前布局不变

```tsx
// Grid 模式 — 按类型分两种卡片样式
{entries.map(entry => (
  <Link
    key={entry.path}
    href={`/view/${encodePath(entry.path)}`}
    className={
      entry.type === 'directory'
        ? 'flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
        : 'flex flex-col items-center gap-2 p-4 rounded-xl border border-border bg-card hover:bg-accent hover:border-border/80 transition-all duration-100 text-center'
    }
  >
    {entry.type === 'directory'
      ? <FolderOpen size={22} className="text-yellow-400" />
      : <FileIconLarge node={entry} />}
    {/* ...name + meta... */}
  </Link>
))}
```

**List 模式**：不变（已足够紧凑）。

**i18n**：无新增。

---

### 2. 文件视图 topbar 增加文件图标

**文件**: `app/components/Breadcrumb.tsx`

当前 Breadcrumb 最后一段是纯文本 `<span>{segment}</span>`。改为根据文件扩展名在最后一段前插入图标：

```tsx
// Breadcrumb.tsx — 最后一段增加图标
function FileTypeIcon({ ext }: { ext: string }) {
  if (ext === '.csv') return <Table size={13} className="text-emerald-400 shrink-0" />;
  return <FileText size={13} className="text-zinc-400 shrink-0" />;
}

// 在最后一个 breadcrumb segment 前渲染
{isLast && !isDirectory && <FileTypeIcon ext={extension} />}
```

**关键**：只在最后一段（当前文件名）且非目录时展示，中间路径段不加。

**需读取 Breadcrumb.tsx 确认 props 结构**，可能需要传入 `extension` prop 或从 `filePath` 推导。

---

### 3. ⌘F 文档内搜索

分两个子任务：编辑模式 + 阅读模式。

#### 3a. 编辑模式（CodeMirror）

**文件**: `app/components/Editor.tsx`

CodeMirror 6 的 `basicSetup` 已包含 `@codemirror/search` 的快捷键绑定（⌘F 打开搜索面板），但需要确认：

- `@codemirror/search` 是否在 `node_modules` 中（`basicSetup` 会自动引入）
- 如果 `basicSetup` 版本已含 search panel → **零改动**，只需验证
- 如果未含 → 手动 import `search()` 扩展并加到 extensions 数组

**验证方式**: 启动 dev server → 进入编辑模式 → 按 ⌘F → 看是否弹出搜索框。

#### 3b. 阅读模式（Rendered HTML）

**文件**: 新建 `app/components/FindInPage.tsx` + 修改 `ViewPageClient.tsx`

阅读模式下需要自定义搜索 overlay：

**交互设计**：
- ⌘F 打开搜索条（页面顶部或 topbar 内联）
- 输入关键词 → 高亮所有匹配（`<mark>` 样式）+ 当前焦点高亮
- ↑/↓ 或 Enter/Shift+Enter 在匹配间跳转
- Esc 关闭并清除高亮
- 显示 "3 of 12" 计数

**实现方式**：
1. `FindInPage` 组件接收一个 `containerRef`（指向渲染区域的 DOM 元素）
2. 使用 `TreeWalker` API 遍历文本节点 → `Range` API 标记匹配
3. 用 CSS `::highlight()` API 或 fallback 到 `<mark>` 包裹（兼容性优先选 mark）
4. `scrollIntoView()` 跳转到当前焦点匹配

```tsx
// ViewPageClient.tsx — 阅读模式区域
const contentRef = useRef<HTMLDivElement>(null);
const [findOpen, setFindOpen] = useState(false);

useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      if (!editing) {
        e.preventDefault();
        setFindOpen(true);
      }
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [editing]);

// In render:
{!editing && findOpen && (
  <FindInPage containerRef={contentRef} onClose={() => setFindOpen(false)} />
)}
<div ref={contentRef}>
  <MarkdownView ... />
</div>
```

**i18n**：
```typescript
findInPage: {
  placeholder: 'Find in document…',     // ZH: '在文档中查找…'
  matchCount: (current: number, total: number) => `${current} of ${total}`,
  noResults: 'No results',              // ZH: '无结果'
}
```

---

## 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `app/components/DirView.tsx` | 文件夹卡片紧凑化 |
| 修改 | `app/components/Breadcrumb.tsx` | 最后一段加文件图标 |
| 验证 | `app/components/Editor.tsx` | 确认 basicSetup 含 search |
| 新建 | `app/components/FindInPage.tsx` | 阅读模式搜索 overlay |
| 修改 | `app/app/view/[...path]/ViewPageClient.tsx` | 集成 FindInPage + ⌘F 快捷键 |
| 修改 | `app/lib/i18n.ts` | findInPage 段 |

---

## 优先级建议

| 项 | 优先级 | 理由 |
|----|--------|------|
| Topbar 文件图标 | P0 | 改动最小（~10 行），视觉一致性提升明显 |
| 目录卡片密度 | P1 | 低风险 CSS 调整，改善浏览体验 |
| ⌘F 文档内搜索 | P1 | 编辑模式可能零改动；阅读模式需新组件，但不阻塞其他功能 |

---

## 验证

1. 目录 grid：文件夹卡片视觉上比文件卡片更紧凑，信息层次清晰
2. Topbar 图标：`.md` 文件显示 FileText，`.csv` 显示 Table，目录路径不显示
3. ⌘F 编辑模式：搜索面板弹出，匹配高亮，跳转正常
4. ⌘F 阅读模式：搜索条出现，高亮 + 计数 + 跳转 + Esc 关闭
5. `npm run build` 零报错
6. 现有 tests 全通过
