<!-- Created: 2026-03-20 -->

# Spec: Activity Bar + Panel 布局重构

## 目标

将 MindOS 桌面端布局从"单 Sidebar + 多 Modal"演进为"Activity Bar（Rail）+ 可切换 Panel + Content"三栏结构，使 AI 对话、搜索、设置等功能以 Panel 形态与内容并排显示，消除全屏 Modal 对内容区的遮盖。

## 现状分析

当前桌面端布局为双栏：

```
┌──────────┬──────────────────────────────────────┐
│ Sidebar  │  Main Content                         │
│ 280px    │  (SearchModal / AskModal /            │
│ fixed    │   SettingsModal 以 z-50 overlay 覆盖)  │
└──────────┴──────────────────────────────────────┘
```

**问题：**

1. **AI 对话遮盖内容** — AskModal 是全屏 overlay（z-50, max-w-2xl），用户无法一边对话一边参考文档。这是影响使用体验的第一大问题。
2. **Sidebar 职责过载** — 一个 Sidebar 承载 FileTree + Search/Settings/Ask 的入口按钮 + SyncStatus，功能入口分散在 header 按钮和快捷键中，可发现性差。
3. **Modal 打断流** — 搜索、设置都是 Modal，每次操作需要打开→完成→关闭，无法与其他上下文并行。
4. **AskFab 冗余** — 右下角浮动按钮 (AskFab) 打开的 AskModal 与 Sidebar 中 ⌘/ 打开的是同一个 Modal，两个入口维护两份状态（`Sidebar.askOpen` + `AskFab.open`）。

**涉及组件：**

| 组件 | 行数 | 职责 |
|------|------|------|
| `SidebarLayout.tsx` | 46 | 外壳：Sidebar + main + AskFab |
| `Sidebar.tsx` | 181 | 导航 + 3 个 Modal 的 open 状态 |
| `AskModal.tsx` | 403 | AI 对话 Modal |
| `AskFab.tsx` | 106 | 浮动按钮 + 第二个 AskModal 实例 |
| `SearchModal.tsx` | ~150 | 搜索 Modal |
| `SettingsModal.tsx` | 256 | 设置 Modal（8 tab） |

## 数据流 / 状态流

### 当前状态流

```
SidebarLayout
├─ collapsed: boolean ←→ Sidebar.onCollapse/onExpand
├─ Sidebar
│   ├─ searchOpen: boolean → SearchModal
│   ├─ askOpen: boolean → AskModal (实例 1)
│   ├─ settingsOpen: boolean → SettingsModal
│   └─ mobileOpen: boolean → drawer
├─ AskFab
│   └─ open: boolean → AskModal (实例 2, 独立状态)
│       └─ useAskModal store → cross-component open requests (GuideCard)
└─ main > children (ViewPageClient 等)
```

**问题标注：**
- AskModal 有两个独立实例（Sidebar 和 AskFab 各一个），状态不共享
- 3 个 Modal 的 open/close 状态分散在 Sidebar 内部，外部无法控制
- GuideCard 通过 `useAskModal` zustand store 间接控制 AskFab，链路长

### 目标状态流

```
SidebarLayout
├─ activePanel: 'files' | 'search' | 'ask' | 'settings' | null
│   (null = Panel 折叠, 无需额外 panelCollapsed flag)
├─ ActivityBar (Rail)
│   ├─ 按钮点击 → setActivePanel(id) / toggle
│   └─ 当前选中 = activePanel
├─ Panel (280px, 条件渲染)
│   ├─ activePanel === 'files'    → <FileTreePanel />
│   ├─ activePanel === 'search'   → <SearchPanel /> (原 SearchModal 内容)
│   ├─ activePanel === 'ask'      → <AskPanel />   (原 AskModal 内容)
│   └─ activePanel === 'settings' → <SettingsPanel /> (原 SettingsModal 内容)
├─ main > children
│   └─ padding-left: 48px (rail) + 280px (panel, if open)
└─ mobileOpen: boolean → drawer (移动端保留当前行为)
```

**键盘快捷键映射：**
- `⌘K` → `setActivePanel(activePanel === 'search' ? null : 'search')` （toggle）
- `⌘/` → `setActivePanel(activePanel === 'ask' ? null : 'ask')` （toggle）
- `⌘,` → `setActivePanel(activePanel === 'settings' ? null : 'settings')` （toggle）
- `Escape` → `setActivePanel(null)` 或 focus 回 main

**GuideCard 集成：**
- `useAskModal.open()` → 直接调用 `setActivePanel('ask')`，不再需要 AskFab 中转

## 方案

### 1. 新增 ActivityBar 组件

```tsx
// components/ActivityBar.tsx (~80 行)
interface ActivityBarProps {
  activePanel: PanelId | null;
  onPanelChange: (id: PanelId | null) => void;
  syncStatus: SyncStatus;
}
```

三组布局，从上到下：

```
┌────┐
│ ∞  │  Logo → 点击回首页 (/), 不参与 Panel 切换
│────│  1px border-border 分隔
│ 📁 │  Files    (FolderTree icon, 默认选中)
│ 🔍 │  Search   (Search icon, ⌘K)
│ ✨ │  Ask AI   (Sparkles icon, ⌘/)
│    │
│    │  ← flex-1 弹性空间，撑开上下两组
│    │
│────│  1px border-border 分隔
│ ⚙️ │  Settings (Settings icon, ⌘,)
│ 🔄 │  Sync     (RefreshCw icon + SyncDot)
└────┘
```

**三组语义：**
1. **顶部 — 品牌**：Logo（∞ 不对称无限大，当前 Sidebar header 中的 SVG 组件复用），点击 `router.push('/')`。不触发 Panel 切换，不参与 `activePanel` 状态。
2. **中部 — 核心功能**：Files / Search / Ask AI — 高频切换上下文的入口。
3. **底部 — 系统功能**：Settings / Sync — 低频操作，始终贴底。

**不放入 Rail 的功能（设计决策）：**

| 候选 | 决定 | 理由 |
|------|------|------|
| 👤 用户/Profile | ❌ 不放 | MindOS 是单用户本地工具，无账号体系。Profile 在知识库文件中管理，不在 GUI 层。未来团队版 (P2) 可在 Sync 下方加 Avatar |
| 🧩 插件 | ❌ 不放 | 低频操作，已在 Settings > Plugins tab 中 |
| 📊 监控 | ❌ 不放 | 低频操作，已在 Settings > Monitoring tab 中 |
| 📝 新建笔记 | ❌ 不放 | 是"操作"不是"导航上下文"，放在 FileTreePanel header 的 + 按钮 |
| 🏠 主页 | ❌ 不单独放 | Logo 点击即回首页，无需额外主页按钮 |

**原则：Rail 只放「高频切换上下文」的入口（≤5 个），低频管理功能归入 Settings tab。**

**样式规格：**
- 宽度：48px
- 背景：`var(--background)`（比 Panel 的 `var(--card)` 深一层）
- Logo 区域：`py-3`，Logo SVG 居中，hover `opacity-80`，无选中态
- 功能按钮：40×40px 点击区域（含 padding），图标 18px
- 图标默认色：`muted-foreground`，选中态：`amber`
- 选中指示器：左侧 2px 竖线 `var(--amber)`，高度与图标等高（18px），`rounded-r-full`
- hover 态：`bg-muted` 圆角背景（`rounded-md`）
- 不显示文字标签，hover 显示 tooltip（`title` 属性）
- z-index：30（与当前 Sidebar 同级）
- 上下分组之间：`border-t border-border`（1px 分隔线）

**无障碍 (ARIA)：**
- Rail 容器：`role="toolbar" aria-label="Navigation" aria-orientation="vertical"`
- 各按钮：`aria-pressed={isActive}` + `aria-label="Files"` 等
- Panel 容器：`role="region" aria-label={panelLabel}`
- 焦点管理：切换 Panel 后 focus 移到 Panel 首个可聚焦元素（搜索输入框 / AI 输入框）

### 2. 重构 SidebarLayout

```tsx
// components/SidebarLayout.tsx
export default function SidebarLayout({ fileTree, children }) {
  const [activePanel, setActivePanel] = useState<PanelId | null>('files');
  const panelOpen = activePanel !== null;

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>

      {/* Desktop: Rail + Panel */}
      <ActivityBar activePanel={activePanel} onPanelChange={setActivePanel} />
      <Panel activePanel={activePanel} fileTree={fileTree} onPanelChange={setActivePanel} />

      {/* Mobile: 保留当前 header + drawer */}
      <MobileHeader onMenuOpen={...} />
      <MobileDrawer open={mobileOpen} fileTree={fileTree} />

      <main className={`... ${panelOpen ? 'md:pl-[328px]' : 'md:pl-[48px]'}`}>
        {children}
      </main>
    </>
  );
}
```

### 3. Panel 组件

```tsx
// components/Panel.tsx (~60 行)
interface PanelProps {
  activePanel: PanelId | null;
  fileTree: FileNode[];
  onPanelChange: (id: PanelId | null) => void;
}
```

- 宽度：280px（Files/Search/Ask），380px（Settings）
- 宽度通过 Panel 的 `widthByPanel` map 配置，CSS 变量 `--panel-width`
- 背景：`var(--card)`（与当前 Sidebar 同色）
- 过渡：`transition-transform duration-200`，关闭时 `translateX(-280px)`
- 内容按 `activePanel` 条件渲染

### 4. 内容面板拆分

从 Modal 中提取纯内容组件（去掉 overlay / backdrop / dialog wrapper）：

| 原 Modal | 新 Panel 内容组件 | 改动 |
|----------|-----------------|------|
| `SearchModal` | `SearchPanel` | 去掉 `fixed inset-0` wrapper，保留搜索逻辑 |
| `AskModal` | `AskPanel` | 去掉 `fixed inset-0` wrapper + backdrop，保留对话逻辑 |
| `SettingsModal` | `SettingsPanel` | 去掉 `fixed inset-0` wrapper，tab 系统保留 |

策略：**Modal 组件保留**（移动端仍用 Modal），Panel 内容组件作为共享核心，两种容器复用同一内容。

```tsx
// AskPanel.tsx — 面板版本
export function AskPanel({ currentFile }: { currentFile?: string }) {
  return <AskContent currentFile={currentFile} variant="panel" />;
}

// AskModal.tsx — Modal 版本（移动端）
export function AskModal({ open, onClose, currentFile }: AskModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop ...">
      <div role="dialog" ...>
        <AskContent currentFile={currentFile} variant="modal" onClose={onClose} />
      </div>
    </div>
  );
}
```

### 5. 移除 AskFab

AskFab 被 ActivityBar 的 ✨ 按钮完全替代：
- 桌面端：Rail ✨ 按钮切换 AskPanel
- 移动端：保留 Header 中的按钮（已存在）

`useAskModal` store 修改：`open()` → 直接调用 `setActivePanel('ask')`。

**桥接方案：** `useAskModal` 是 zustand store（全局），`activePanel` 是 React state（SidebarLayout 内）。桥接方式：
1. SidebarLayout 内 `useEffect` 监听 `useAskModal.open` 变化
2. 当 `askModal.open === true` 时，调用 `setActivePanel('ask')` + `setInitialMessage(askModal.initialMessage)`
3. 消费后 `askModal.close()` 重置 store
4. 这与当前 AskFab 的桥接模式一致，只是宿主从 AskFab 迁移到 SidebarLayout

### 6. 快捷键统一

当前快捷键分散在 `Sidebar.tsx` 的 useEffect 中。重构后统一到 `SidebarLayout` 层：

```tsx
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setActivePanel(p => p === 'search' ? null : 'search');
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      setActivePanel(p => p === 'ask' ? null : 'ask');
    }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      setActivePanel(p => p === 'settings' ? null : 'settings');
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### 7. 移动端不变

移动端 (<768px) 完全保留当前行为：
- 顶部 Header Bar
- ☰ 打开 Drawer（FileTree）
- 🔍/⚙️/✨ 打开对应 Modal（底部 sheet）
- ActivityBar 在移动端不渲染（`hidden md:flex`）

## 影响范围

### 变更文件列表

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `components/ActivityBar.tsx` | **新建** | Activity Bar Rail 组件 |
| `components/Panel.tsx` | **新建** | Panel 容器，按 activePanel 切换内容 |
| `components/panels/FileTreePanel.tsx` | **新建** | FileTree 面板包装 |
| `components/panels/SearchPanel.tsx` | **新建** | 搜索面板（从 SearchModal 提取） |
| `components/panels/AskPanel.tsx` | **新建** | AI 对话面板（从 AskModal 提取） |
| `components/panels/SettingsPanel.tsx` | **新建** | 设置面板（从 SettingsModal 提取） |
| `components/SidebarLayout.tsx` | **重写** | 三栏布局 + activePanel 状态 |
| `components/Sidebar.tsx` | **重写** | 拆解为 ActivityBar + Panel + MobileDrawer |
| `components/AskModal.tsx` | **修改** | 提取 AskContent 共享核心 |
| `components/SearchModal.tsx` | **修改** | 提取 SearchContent 共享核心 |
| `components/SettingsModal.tsx` | **修改** | 提取 SettingsContent 共享核心 |
| `components/AskFab.tsx` | **删除** | 被 ActivityBar ✨ 按钮替代 |
| `hooks/useAskModal.ts` | **修改** | 对接 activePanel 状态 |

### 受影响但不改的模块

- `ViewPageClient.tsx` — 不受影响，仍通过 `pathname` 获取 `currentFile`
- `FileTree.tsx` — 不受影响，纯展示组件，被 `FileTreePanel` 包装
- `settings/*.tsx` — 所有 tab 组件不受影响，仍被 SettingsPanel 或 SettingsModal 引用
- `ask/*.tsx`（MessageList, SessionHistory 等）— 不受影响，被 AskContent 引用
- `HomeContent.tsx` — GuideCard 通过 `useAskModal` 触发，hook 内部实现改变但接口不变

### 是否有破坏性变更

- **无 API 变更**：纯前端重构
- **快捷键不变**：⌘K / ⌘/ / ⌘, 行为一致
- **移动端不变**：<768px 保留 Modal + Drawer
- **localStorage 不变**：所有持久化 key 不改

## 边界 case 与风险

### 边界 case

| # | 场景 | 处理方式 |
|---|------|---------|
| 1 | 窄屏桌面（768-1024px），Rail 48px + Panel 280px + Content 仅剩 ~440px | Panel 在 `<1024px` 时叠在 Content 之上（`position: absolute`），不挤压内容。点击 Content 区域自动关闭 Panel |
| 2 | 快速连续切换 Panel（⌘K → ⌘/ → ⌘,） | `activePanel` 是单一 state，原子切换，无 race condition |
| 3 | Panel 打开时页面路由变化 | `usePathname` 监听路由变化，Panel 保持打开但 AskPanel 更新 `currentFile` |
| 4 | AskPanel 正在 streaming 时切换到其他 Panel | AskPanel 使用 `useRef` 保持 abort controller，切换 Panel 不触发 unmount（条件渲染用 `display: none` 而非卸载），streaming 继续 |
| 5 | AskPanel 正在 streaming 时切换到移动端宽度 | 不处理。桌面→移动端的实时切换是极端场景（resize 开发工具 除外），Panel 隐藏但 AskContent 保持挂载（`hidden md:flex`），回到桌面宽度后恢复 |
| 6 | Settings 在 Panel 中保存后需要刷新 FileTree | 与当前行为一致（`router.refresh()`），Panel 内的 FileTreePanel 会响应 |
| 7 | `useAskModal.open()` 从 GuideCard 调用 | hook 内部直接调用 `setActivePanel('ask')`，同时传入 `initialMessage` |
| 8 | 用户从未使用过新布局（首次升级） | `activePanel` 默认为 `'files'`，视觉上与当前 Sidebar 一致，用户无需学习 |

### 风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| AskPanel unmount/remount 丢失对话状态 | 高 | 使用 `display: none` + `visibility` 切换而非条件渲染，或用 `useRef` 缓存消息 |
| Panel 宽度 280px 对 Settings 内容不够 | 中 | Settings Panel 默认 380px；其他 Panel 280px。通过 `widthByPanel` map 配置 |
| Turbopack HMR 对新组件树的适应 | 低 | 开发时验证 HMR 正常工作，清理 `.next` 缓存 |
| 移动端回退路径覆盖不完整 | 中 | 移动端完全保留当前实现，不做任何改动；ActivityBar `hidden md:flex` |

## 验收标准

- [ ] **V1**: 桌面端 (≥768px) 左侧渲染 48px Activity Bar，三组布局：顶部 Logo + 中部 3 个功能按钮 + 底部 2 个系统按钮
- [ ] **V1.1**: Rail 顶部 Logo（∞ SVG）点击跳转首页 (/)，不触发 Panel 切换
- [ ] **V1.2**: Logo 与功能按钮之间、功能按钮与系统按钮之间有 1px border 分隔
- [ ] **V2**: 点击 Rail 按钮切换右侧 Panel 内容（Files/Search/Ask/Settings）
- [ ] **V3**: 再次点击同一 Rail 按钮折叠 Panel，Content 区域扩展到 `md:pl-[48px]`
- [ ] **V4**: `⌘K` 切换搜索 Panel，`⌘/` 切换 AI Panel，`⌘,` 切换设置 Panel
- [ ] **V5**: AI 对话在 Panel 中可正常 streaming，切换到其他 Panel 再切回不丢失消息
- [ ] **V6**: 移动端 (<768px) 行为与当前完全一致（Header + Drawer + Modal）
- [ ] **V7**: `AskFab` 组件已删除，所有入口通过 ActivityBar 或移动端 Header
- [ ] **V8**: `useAskModal.open()` 仍能从 GuideCard 正常触发 AI 对话
- [ ] **V9**: Settings Panel 宽度适配，tab 导航和保存功能正常
- [ ] **V10**: 选中态 Rail 按钮显示 amber 色 + 左侧 2px 指示线
- [ ] **V11**: SyncDot 在 Rail 底部正常显示同步状态
- [ ] **V12**: 全量测试通过（`npx vitest run`），无回归
- [ ] **V13**: Playwright 截图 — 桌面 Panel 展开/折叠 + 移动端 drawer + AI Panel streaming
