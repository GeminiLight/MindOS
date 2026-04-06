# Spec: Wiki/Space Homepage

## 目标

当用户在 Activity Rail 上点击 Wiki/Space 按钮时，展示一个精美、高效的主页面，包含：
1. 最近更新的空间列表（按更新时间排序）
2. 收件箱（Inbox）中最近添加的文件
3. 提供快速操作和导航入口

消除当前"点击没有任何反馈、没有主页"的体验。

---

## 现状分析

**当前行为：**
- 点击 Wiki/Space 按钮后，无明确的主页面，用户不知道应该做什么
- 只有在点击「Files」面板时，才能看到文件树和空间列表
- 缺少「首次登录后，应该看什么」的引导视图
- Inbox 隐藏在 HomeContent 深处，不是首要关注点

**为什么不满足需求：**
1. 用户需要一个明确的"入口"来浏览最近的工作区（Spaces）
2. Inbox 中的文件应该更显眼，便于快速整理
3. 缺少视觉上的「层级感」和「美感」，让用户感到产品是精心设计的

---

## 关键数据类型

> **[FIX #5]** 明确定义所有关键类型及其来源

```typescript
// 来源: app/app/page.tsx (服务端组件 props)
export interface SpaceInfo {
  name: string;        // 目录名（可能含 emoji 前缀）
  path: string;        // 相对路径, e.g. "wiki/Specs"
  fileCount: number;   // 递归 .md/.csv 文件计数
  description: string; // README.md 首行非空文本
}

// 来源: app/lib/core/types.ts
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
  isSpace?: boolean;
  spacePreview?: SpacePreview;
}

// 来源: app/lib/core/inbox.ts
export interface InboxFileInfo {
  name: string;
  path: string;         // "Inbox/filename.md"
  size: number;
  modifiedAt: string;   // ISO 8601
  isAging: boolean;     // true if > 7 days old
}

// WikiHomePanel 内部使用
interface RecentFile {
  path: string;
  mtime: number;
}
```

---

## 数据流 / 状态流

```
User clicks Wiki/Space button in ActivityBar
          |
ActivityBar calls toggle('wiki-home')
          |
useLeftPanel sets activePanel = 'wiki-home'
          |
SidebarLayout renders WikiHomePanel via Panel children pattern
          |
WikiHomePanel receives fileTree prop (from SidebarLayout, SSR)
+ fetches data in parallel:
  |-- GET /api/recent-files?limit=20 -> recent files with mtime
  |-- GET /api/inbox -> inbox files
  `-- (optional) GET /api/agent-activity?limit=10
          |
Data flows through (all in frontend):
  SpaceInfo[]    <- summarizeTopLevelSpaces(mindRoot, fileTree)
  RecentFile[]   <- groupBySpace(recent, spaces)
  InboxFileInfo[] <- from /api/inbox, sorted by mtime desc
          |
Render WikiHomePanel with 3 sections:
  1. Hero: Brand + Quick Actions (New Note, Search)
  2. Spaces Grid: sorted by update time (desc), front-end sort
  3. Inbox Section: recent files with upload/organize actions
          |
User interacts:
  - Click Space -> navigate to /view/<space-path>
  - Click Inbox file -> navigate to /view/<file-path>
  - Drag file to Inbox -> POST /api/inbox
  - Click AI Organize -> dispatch 'mindos:inbox-organize' event
```

**缓存策略：**
- fileTree: 由 SidebarLayout 通过 SSR prop 传入，3s 版本轮询自动 refresh
- Recent files: `mindos:files-changed` 事件驱动刷新
- Inbox: `mindos:files-changed` + `mindos:inbox-updated` 事件驱动刷新

---

## 方案

### A. Panel 类型扩展

> **[FIX #1]** 修改的是 `PanelId` 类型（不是 `LeftPanelType`），位于 `ActivityBar.tsx:11`

在 `app/components/ActivityBar.tsx` 中修改 PanelId 类型：

```typescript
// 修改前:
export type PanelId = 'files' | 'search' | 'echo' | 'agents' | 'discover' | 'workflows';

// 修改后:
export type PanelId = 'files' | 'search' | 'echo' | 'agents' | 'discover' | 'workflows' | 'wiki-home';
```

同时在 `app/lib/config/panel-sizes.ts` 中新增默认宽度：

> **[FIX #2]** 必须在 `DEFAULT_LEFT_PANEL_WIDTH` 中注册新 panel 的宽度

```typescript
export const DEFAULT_LEFT_PANEL_WIDTH: Record<PanelId, number> = {
  files: 280,
  search: 320,
  echo: 340,
  agents: 300,
  discover: 300,
  workflows: 320,
  'wiki-home': 320,  // <-- 新增
};
```

### A2. ActivityBar 按钮

> **[FIX #7]** 明确指定图标、位置和交互

**图标：** `Brain` (from lucide-react) — 与 HomeContent 中 Spaces section 使用的图标一致

**位置：** 在 ActivityBar 的中部 panel toggles 区域，紧跟在 Files 按钮之后：

```
Top:    Logo + divider
Middle: Files, **Wiki (NEW)**, Echo (labs), Search, Agents, Workflows (labs)
Spacer
Below:  Discover
Bottom: Settings, Sync
```

**代码 (ActivityBar.tsx)：**
```tsx
// 在 Files RailButton 之后、labsEcho 之前插入:
<RailButton
  icon={<Brain size={18} />}
  label={t.sidebar.wiki ?? 'Wiki'}
  active={activePanel === 'wiki-home'}
  expanded={expanded}
  onClick={() => toggle('wiki-home')}
  walkthroughId="wiki-home-panel"
/>
```

### B. 新建 `WikiHomePanel` 组件

**位置：** `app/components/panels/WikiHomePanel.tsx`

**结构：**
```
WikiHomePanel
|-- PanelHeader (title="Wiki", 复用现有 PanelHeader 组件)
|
|-- ScrollArea (flex-1 overflow-y-auto)
|   |-- Hero Section
|   |   |-- Brand identifier (warm amber bar + "Wiki" title)
|   |   |-- Tagline (e.g., "Your knowledge spaces, organized.")
|   |   `-- Quick Actions
|   |       |-- New Note (CTA amber button)
|   |       `-- Search (Cmd+K)
|   |
|   |-- Spaces Section
|   |   |-- "Your Spaces" title + space count + sort dropdown
|   |   |-- Space cards list (single column in panel, 不是 grid)
|   |   |   `-- Each card:
|   |   |       |-- Emoji icon + space name
|   |   |       |-- Description (first line from README)
|   |   |       |-- File count + last update time
|   |   |       |-- Hover: Border highlight, slight shadow
|   |   |       `-- Click: Navigate to /view/<space-path>
|   |   `-- "View all" toggle (if >8 spaces)
|   |
|   `-- Inbox Section
|       |-- "Inbox" title + file count
|       |-- Upload button (click to browse)
|       |-- Recent files (sorted by mtime desc)
|       |   `-- Each file:
|       |       |-- File icon (doc/csv)
|       |       |-- File name
|       |       |-- Upload time (relative)
|       |       |-- Aging indicator (amber dot if >7 days)
|       |       `-- Click: Navigate to /view/Inbox/<file-name>
|       `-- AI Organize button
|
`-- (no footer, panel 底部由 SyncStatusBar 处理)
```

**注意：** Panel 宽度为 320px，所以 Space cards 使用**单列列表**而非 grid，每个 card 全宽。

### B2. SidebarLayout 集成

> **[FIX #6]** 遵循现有 Panel children 渲染模式（与 EchoPanel/SearchPanel 完全一致）

在 `SidebarLayout.tsx` 的 `<Panel>` children 中新增：

```tsx
// 在 WorkflowsPanel 之后新增:
<div className={`flex flex-col h-full ${lp.activePanel === 'wiki-home' ? '' : 'hidden'}`}>
  <WikiHomePanel
    fileTree={fileTree}
    active={lp.activePanel === 'wiki-home'}
    maximized={lp.panelMaximized}
    onMaximize={lp.handlePanelMaximize}
  />
</div>
```

### C. 数据获取与状态管理

> **[FIX #3]** 不新建 useWikiHome hook，直接复用 useLeftPanel + 组件内部 state

**状态管理：** 复用 `useLeftPanel` hook（无需修改该 hook）。`useLeftPanel` 通过 `PanelId` 泛型自动支持 `'wiki-home'`，因为 PanelId 类型在 ActivityBar.tsx 中已扩展。

**数据获取：** WikiHomePanel 组件内部管理数据加载：

```typescript
// app/components/panels/WikiHomePanel.tsx 内部
interface WikiHomePanelProps {
  fileTree: FileNode[];  // SSR prop，从 SidebarLayout 传入
  active: boolean;
  maximized: boolean;
  onMaximize: () => void;
}

export default function WikiHomePanel({ fileTree, active, maximized, onMaximize }: WikiHomePanelProps) {
  // Spaces: 从 fileTree 推导（纯前端，无需 API）
  const spaces = useMemo(() => summarizeTopLevelSpaces(fileTree), [fileTree]);

  // Recent files: 从 API 获取
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);

  // Inbox: 复用 InboxSection 组件（已有自己的数据获取逻辑）

  // 排序: 组件内部 state
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'fileCount'>('recent');

  // 刷新 recent files
  useEffect(() => {
    if (!active) return; // 不活跃时不加载
    const load = async () => {
      const res = await fetch('/api/recent-files?limit=20');
      if (res.ok) setRecentFiles(await res.json());
    };
    load();
    // 监听文件变化事件
    window.addEventListener('mindos:files-changed', load);
    return () => window.removeEventListener('mindos:files-changed', load);
  }, [active]);

  // 排序后的 spaces
  const sortedSpaces = useMemo(() => {
    // ... 前端排序逻辑
  }, [spaces, recentFiles, sortBy]);

  // ...
}
```

> **[FIX #4]** 不新增 /api/spaces 端点。Spaces 数据从 `fileTree` prop 前端推导。

### D. 排序与分组

> **[FIX #8]** 明确：所有排序在前端完成，不新增 API 端点

**Spaces 排序选项（前端 `useMemo` 计算）：**
1. **By Update Time (default)** — 通过 `recentFiles` 中 `max(mtime)` per space 计算
2. **A-Z** — `spaces.sort((a, b) => a.name.localeCompare(b.name))`
3. **By File Count** — `spaces.sort((a, b) => b.fileCount - a.fileCount)`

**Inbox 排序：** 由 `InboxSection` 组件内部处理，始终按 mtime desc

**排序 UI：** 使用 `<select>` 或自定义 dropdown（遵循设计系统的 custom select 模式）

### E. 美学与设计系统

**色彩：**
- 品牌色：Warm Amber (`var(--amber)` #c8873a)
- 背景：Light theme (white/gray-50) / Dark theme (gray-950)
- 卡片边框：`border-border` (gray-200 light / gray-800 dark)
- 焦点色：amber ring (`focus-visible:ring-2 focus-visible:ring-ring`)

**间距与排版：**
- Hero margin: mb-8 (32px)
- Section margin: mb-8 (32px)
- Card padding: px-3.5 py-3 (14px horiz, 12px vert)
- Card gap: gap-2 (8px)
- Section title: text-sm font-semibold font-display
- Subtitle: text-xs text-muted-foreground

**组件约束（Panel 内）：**
- Panel 宽度: 320px (由 panel-sizes.ts 控制)
- Space cards: 单列全宽（Panel 太窄，不适合 grid）
- Inbox section: max-height 约 300px，overflow-y-auto

**响应式：**

> **[FIX #9]** 使用实际断点配置 (panel-sizes.ts)

- Desktop (>=1024px): WikiHomePanel 作为左侧 Panel 展示
- Tablet (768px-1023px): 同 Desktop
- Mobile (<768px): Panel 隐藏。WikiHomePanel 通过移动端 drawer 展示（复用现有 drawer 机制）

> **[FIX #10]** 移动端遵循现有 drawer 模式，无需特殊处理。SidebarLayout 已有 `mobileOpen` drawer，WikiHomePanel 可在未来作为 drawer 内容的一个 tab。MVP 阶段移动端不展示 WikiHomePanel（与 Echo/Search 等 panel 一致，移动端用 modal fallback）。

### F. 交互与反馈

**Hover states：**
- Space card: `hover:border-[var(--amber)]/30 hover:shadow-sm`
- File row: `hover:translate-x-0.5 hover:bg-muted`
- Button: `hover:opacity-80`

**Loading state：**
- Skeleton screens for spaces list (4 placeholders)
- Inbox 复用 InboxSection 已有的 skeleton

**Error state：**
- Toast notification if fetch fails (`toast.error()`)
- 自动重试（下次 `mindos:files-changed` 事件触发时）

**Empty states：**
- No spaces: 虚线边框区域 + icon + "Create your first space" CTA button
- No inbox files: 复用 InboxSection 已有的空状态（虚线边框 + upload button）

### G. Keyboard & Accessibility

- Tab navigation: Works through all interactive elements
- Enter: Open selected space / file
- Esc: Close panel (inherited from SidebarLayout keyboard handler)
- Focus ring: `focus-visible:ring-1 focus-visible:ring-ring`（与其他 panel 按钮一致）
- ARIA labels: `aria-label` on icon buttons, `aria-expanded` on toggles
- 语义 HTML: `<section>` for each section, `<nav>` for space list

---

## 影响范围

### 变更文件列表
1. **新建：**
   - `app/components/panels/WikiHomePanel.tsx` (~350 LOC)
   - Tests: `__tests__/components/WikiHomePanel.test.tsx` (~150 LOC)

2. **修改：**
   - `app/components/ActivityBar.tsx` — PanelId 类型新增 `'wiki-home'` + 新增 RailButton
   - `app/lib/config/panel-sizes.ts` — `DEFAULT_LEFT_PANEL_WIDTH` 新增 `'wiki-home': 320`
   - `app/components/SidebarLayout.tsx` — Panel children 新增 WikiHomePanel 渲染
   - i18n 文件 — 新增 `t.sidebar.wiki` 等国际化文本

3. **无需修改：**
   - `app/hooks/useLeftPanel.ts` — PanelId 类型自动传播，无需改动
   - `app/components/Panel.tsx` — 通过 panel-sizes.ts 配置，无需改动
   - API 路由 — 全部复用现有端点

4. **API 端点 (全部复用，不新增)：**
   - `GET /api/recent-files?limit=20` — 最近编辑的文件
   - `GET /api/inbox` — Inbox 文件列表
   - fileTree 通过 SSR prop 传入，无需 API

### 受影响的其他模块

| 模块 | 影响 | 理由 |
|------|------|------|
| **ActivityBar** | 修改 PanelId 类型 + 新增 button | 类型扩展 + Wiki 入口按钮 |
| **panel-sizes.ts** | 新增一行配置 | 注册 wiki-home 默认宽度 |
| **SidebarLayout** | 新增 1 个 children div | 遵循 EchoPanel 模式渲染 WikiHomePanel |
| **useLeftPanel** | 无修改 | PanelId 类型自动传播 |
| **Panel.tsx** | 无修改 | 读取 panel-sizes.ts 配置即可 |
| **HomeContent** | 无修改 | 主内容区独立 |
| **InboxSection** | 复用，无修改 | WikiHomePanel 内嵌 InboxSection 组件 |

### 是否有破坏性变更

**无。** PanelId union type 扩展是向后兼容的。不修改现有 API、组件行为或 UI。

---

## 边界 Case 与风险

### 边界 Case 与处理方式

| Case | 处理方式 |
|------|---------|
| **无任何空间** | 显示空状态: 虚线边框 + Brain icon + "Create your first space" CTA |
| **无 Inbox 文件** | 复用 InboxSection 空状态（虚线边框 + upload button） |
| **Inbox 有 >50 文件** | InboxSection 已有 VISIBLE_LIMIT=5 + "show more" toggle |
| **空间名称超长** | `truncate` class + `title` attr 显示完整名字 |
| **文件描述超长** | `line-clamp-1` + `title` attr |
| **网络断开** | `toast.error()` + 下次 files-changed 事件自动重试 |
| **文件被删除** | `mindos:files-changed` 事件触发 fileTree 刷新 + recent files 重载 |
| **移动端** | Panel 不显示（复用现有移动端行为），MVP 不处理 |
| **Emoji 文件名** | `extractEmoji()` + `stripEmoji()` 已有工具函数 |
| **高频率事件** | debounce 80ms（与 InboxSection 一致） |

### 已知风险与 Mitigation

| 风险 | 影响 | Mitigation |
|------|------|-----------|
| **性能：大量空间 (>100)** | 列表渲染卡顿 | 默认显示 8 个 + toggle 展开（P2: 虚拟滚动） |
| **缓存不一致** | 用户看到过期数据 | 事件驱动刷新 + SSR prop 3s 版本轮询 |
| **首页加载延迟** | 用户感到卡顿 | Skeleton screens + fileTree 是 SSR prop（零延迟） |
| **Dark mode 样式问题** | 文字看不清 | 只用 CSS 变量，不硬编码颜色 |

---

## 验收标准

### 功能验收

- [ ] 点击 ActivityBar 中的 Wiki 按钮（Brain icon），左侧 panel 展开 WikiHomePanel
- [ ] 再次点击 Wiki 按钮，panel 关闭（toggle 行为，与 Files 一致）
- [ ] WikiHomePanel 加载后，显示 Hero + Spaces + Inbox 三个区域
- [ ] Spaces 默认按"最近更新时间"排序
- [ ] 排序下拉切换正常（By Update Time / A-Z / By File Count）
- [ ] 点击 Space card，导航到 `/view/<space-path>`
- [ ] Inbox Section 显示最近文件，点击导航到 `/view/Inbox/<filename>`
- [ ] 点击"AI Organize"按钮，触发 `mindos:inbox-organize` 事件
- [ ] 空状态处理：无空间时显示 CTA，无 Inbox 文件时显示上传引导

### UX 验收

- [ ] 页面加载时显示 skeleton screens（不是空白）
- [ ] 所有交互元素有 hover 反馈
- [ ] Panel 不活跃时不发起 API 请求（`active` guard）

### 视觉验收

- [ ] Space card 视觉层级清晰：标题 > 描述 > 元数据
- [ ] 间距遵循 4/8/16/24/32 的 scale
- [ ] 只使用 CSS 变量，无硬编码 hex
- [ ] `focus-visible:` (not `focus:`)
- [ ] Dark mode 样式正确

### 无障碍验收

- [ ] 所有交互元素可用 Tab 导航
- [ ] 按钮有 `aria-label` 或文字标签
- [ ] 下拉菜单支持键盘操作

### 性能验收

- [ ] 不活跃时零网络请求
- [ ] Spaces >50 个时，仍可流畅滚动
- [ ] 无控制台 error 或 warning

### 测试覆盖

- [ ] Component tests: WikiHomePanel（render、排序、empty state）
- [ ] Integration tests: 点击 ActivityBar -> panel 打开、数据展示
- [ ] E2E tests (可选)

---

## 后续优化方向 (P2/P3)

1. **虚拟滚动** — 当 spaces >100 时，使用 react-window
2. **搜索 within panel** — 快速搜索空间名称
3. **快捷操作** — 右键菜单: Pin / Add tag / Delete
4. **拖拽排序** — 自定义空间顺序，保存到 localStorage
5. **AI 建议** — 基于使用频率推荐 "Top 3 Spaces"
6. **移动端支持** — 在 drawer 中展示 WikiHomePanel
7. **Activity Feed** — 集成 `/api/agent-activity`

---

## 技术决策备注

### 为什么在 Left Panel 而不是 Main Content?

**Left Panel 方案（选中）：**
- 不中断当前正在编辑的文件
- 与 Files/Search/Agents 等 panel 交互模式一致

**Main Content 方案（弃选）：**
- 切换时丢失当前编辑的文件状态

### 为什么不新建 useWikiHome hook?

> **[FIX #3]**

`useLeftPanel` 已经管理所有 panel 状态（activePanel、panelWidth、maximize 等）。PanelId 类型扩展后自动支持 `'wiki-home'`，无需额外 hook。WikiHomePanel 组件内部管理自己的数据加载（spaces 从 fileTree 推导，recent files 从 API 获取，inbox 复用 InboxSection 组件）。

### 为什么不新增 /api/spaces?

> **[FIX #4]**

- fileTree 已经通过 SSR prop 传入 SidebarLayout
- `summarizeTopLevelSpaces()` 可以在前端从 fileTree 推导出 SpaceInfo[]
- 新增 API 端点会增加一个额外网络请求，没有必要

### 为什么不直接修改 HomeContent?

HomeContent 是主内容页面（路由 `/`），WikiHomePanel 是左侧 panel 导航工具。两者复用 InboxSection 组件，但职责不同。

---

## 修改清单 (Checklist)

| 文件 | 操作 | 改动描述 |
|------|------|---------|
| `app/components/ActivityBar.tsx:11` | 修改 | PanelId 新增 `'wiki-home'` |
| `app/components/ActivityBar.tsx:~209` | 新增 | Brain icon RailButton (在 Files 后) |
| `app/lib/config/panel-sizes.ts:10-17` | 修改 | 新增 `'wiki-home': 320` |
| `app/components/SidebarLayout.tsx:~448` | 新增 | WikiHomePanel children div |
| `app/components/panels/WikiHomePanel.tsx` | 新建 | ~350 LOC |
| i18n 文件 | 修改 | 新增 wiki 相关文本 |

---

## Ref

- Design System: `wiki/21-design-principle.md`
- Layout: `wiki/22-page-design.md`
- Component patterns: `app/components/panels/` 既有 panel 参考
- Current HomeContent: `app/components/HomeContent.tsx`
- InboxSection: `app/components/home/InboxSection.tsx`
- Panel sizes: `app/lib/config/panel-sizes.ts`

---

## 审查修正记录

| ID | 问题 | 修正 |
|----|------|------|
| #1 | PanelId 类型名称错误（写成 LeftPanelType） | 改为 PanelId，明确文件位置 ActivityBar.tsx:11 |
| #2 | 遗漏 panel-sizes.ts 配置 | 新增 `'wiki-home': 320` 到 DEFAULT_LEFT_PANEL_WIDTH |
| #3 | 不应新建 useWikiHome hook | 删除，复用 useLeftPanel + 组件内部 state |
| #4 | /api/spaces 不存在且不需要 | 删除"可选新增"，明确前端从 fileTree 推导 |
| #5 | SpaceInfo 类型未定义 | 新增"关键数据类型"章节 |
| #6 | Panel children 渲染模式不清楚 | 新增 B2 章节，明确遵循 EchoPanel 模式 |
| #7 | ActivityBar 按钮图标/位置未指定 | 新增 A2 章节: Brain icon, Files 按钮之后 |
| #8 | Sorting API 策略未明确 | 明确所有排序在前端 useMemo 中完成 |
| #9 | 响应式断点不对齐 | 使用 panel-sizes.ts 中的实际断点 |
| #10 | 移动端处理未说明 | 明确 MVP 不处理移动端，复用现有 panel 隐藏行为 |
