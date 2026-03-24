<!-- Last verified: 2026-03-24 | Current stage: P1 -->

# 页面设计 (Page Design)

> 本文档定义 MindOS 各页面的布局结构、面板划分、交互流和视觉层级。
> 原子级规范（色值、字体、圆角、z-index）见 `21-design-principle.md`，本文档不重复，仅引用。

---

## 全局布局框架

### 桌面端 (≥768px)

```
┌─────────────────────────────────────────────────────────────┐
│ [Skip to content] (sr-only, focus 时可见)                    │
├──────────┬──────────────────────────────────────────────────┤
│ Sidebar  │  Main Content Area                               │
│ 280px    │  ┌──────────────────────────────┬──────────┐    │
│ fixed    │  │ Content (content-width)       │ TOC      │    │
│ z-30     │  │ max 780px, 居中              │ 200px    │    │
│          │  │                              │ xl only  │    │
│ ┌──────┐ │  │                              │ sticky   │    │
│ │Header│ │  │                              │ z-10     │    │
│ │ Logo │ │  │                              │          │    │
│ │ 🔍⚙️◀│ │  │                              │          │    │
│ ├──────┤ │  └──────────────────────────────┴──────────┘    │
│ │      │ │                                                  │
│ │ File │ │                                  ┌────────────┐  │
│ │ Tree │ │                                  │ AskFab ✨  │  │
│ │      │ │                                  │ fixed      │  │
│ │      │ │                                  │ bottom-6   │  │
│ ├──────┤ │                                  │ right-6    │  │
│ │Sync  │ │                                  │ z-40       │  │
│ │Status│ │                                  └────────────┘  │
│ └──────┘ │                                                  │
├──────────┴──────────────────────────────────────────────────┤
```

### Activity Bar + 左侧面板（md+）

桌面端左侧由 **48px Rail（Activity Bar）** 与 **可切换 Panel（默认宽约 280px，可拖拽调宽）** 组成。上文 ASCII 中的「Sidebar」在实现上对应 **Rail + 当前 Panel 内容** 占用的总宽度（约 48px + 280px 量级）。

**Rail 中部按钮顺序（上 → 下）**：空间（文件树）→ **回响 Echo** → 搜索（⌘K）→ 插件 → 智能体 → 探索。底部为帮助、同步、设置等（不切换主 Panel）。

**Panel 子视图**：`FileTree`、`EchoPanel`、`SearchPanel`、`PluginsPanel`、`AgentsPanel`、`DiscoverPanel`。回响无独立路由：内容为「与你有关 / 未完待续 / 每日回响 / 历史的你 / 心向生长」等自我向模块（不导流首页、Guide、探索）。规格见 `wiki/specs/spec-echo-panel.md`、`wiki/specs/spec-activity-bar-layout.md`、`wiki/specs/spec-discover-panel.md`。

### 移动端 (<768px)

```
┌──────────────────────────────────────┐
│ Header Bar (fixed, z-30)             │
│ [☰]   MindOS Logo   [●] [🔍] [⚙️]   │
├──────────────────────────────────────┤
│                                      │
│  Main Content (full width)           │
│  pt-[52px] (safe area + header)      │
│                                      │
│                                      │
│                          [AskFab ✨] │
│                                      │
└──────────────────────────────────────┘

Drawer (triggered by ☰):
┌──────────────┬───────────────────────┐
│ Sidebar      │ Overlay (z-40)        │
│ 85vw         │ bg-black/60           │
│ max 320px    │ backdrop-blur-sm      │
│ z-50         │                       │
│              │                       │
└──────────────┴───────────────────────┘
```

### Sidebar 折叠态

折叠时 Sidebar 整体 `translateX(-full)` 离屏，左侧边缘露出 Expand 按钮：

```
┌──┬───────────────────────────────────┐
│◀ │  Main Content (full width)        │
│● │  md:pl-0                          │
└──┴───────────────────────────────────┘
  6×40px  含 SyncDot 指示器
```

---

## 页面清单

| 路由 | 页面 | 组件入口 | 说明 |
|------|------|---------|------|
| `/` | 首页 | `HomeContent` | 最近文件、插件网格、AI 入口；GuideCard |
| `/explore` | 探索 | `app/explore/page.tsx` | 使用案例与分类；Discover 侧栏可入 |
| `/view/[...path]` | 查看/编辑 | `ViewPageClient` | Markdown/CSV/JSON 查看+编辑 |
| `/setup` | 初始化向导 | `Setup` | 8 步 Wizard |
| `/login` | 登录 | `LoginPage` | Web 密码认证 |
| `/help` | 帮助 | `app/help/page.tsx` | Activity Bar 底部 `?` 入口 |

---

## 1. 首页 (HomePage)

### 信息架构

```
┌──────────────────────────────────────────────┐
│ GuideCard（首次使用时出现，可关闭）             │
├──────────────────────────────────────────────┤
│ Hero 区                                       │
│ ├─ 品牌标识栏：竖线 + "MindOS" + tagline      │
│ ├─ AI Command Bar（主 CTA）                   │
│ │   [✨ {rotating suggestion}        ⌘/]     │
│ │   [🔍 Search files                 ⌘K]     │
│ └─ Quick Actions                              │
│     [→ Continue editing {file}] [+ New Note]  │
├──────────────────────────────────────────────┤
│ Plugins 区                                    │
│ 2-col grid：已激活 plugin 可点击，              │
│ 未激活 plugin 灰显 + 点击提示创建入口文件       │
├──────────────────────────────────────────────┤
│ Recently Modified 区                          │
│ Timeline 形态：左侧竖线 + dot + 文件列表       │
│ 首条高亮（amber dot + glow），默认展示 5 条     │
│ "Show more/less" 折叠控制                     │
├──────────────────────────────────────────────┤
│ Footer（品牌小字）                             │
└──────────────────────────────────────────────┘
```

### 设计要点

| 要素 | 规格 |
|------|------|
| AI Command Bar | 主 CTA，`rounded-xl`，hover 时 amber 边框高亮 |
| Suggestion 轮播 | 3.5s 间隔，无动画硬切（简洁） |
| Plugin 卡片 | `rounded-lg border`，hover 时 `border-amber-500/30 + bg-muted/50` |
| 未激活 Plugin | `opacity-60`，点击后显示 amber 提示文字 |
| Timeline dot | 首条 `w-2 h-2` amber + `outline: 2px amber-dim`，其余 `w-1.5 h-1.5` border 色 |
| 时间戳 | `relativeTime()`，`tabular-nums font-display`，低 opacity (0.5) |

### 空状态

知识库为空时不渲染上述内容，改为 `OnboardingView`（引导用户创建第一篇笔记或配置知识库路径）。

---

## 2. 查看/编辑页 (ViewPage)

### 页面结构

```
┌────────────────────────────────────────────────────────────┐
│ Top Bar (sticky, z-20)                                      │
│ ┌─────────────────────────────────────┬──────────────────┐ │
│ │ [←] Breadcrumb / path / file.md     │ [Graph][Raw][✏️] │ │
│ │     (mobile back) (路径导航)         │ 💾saved          │ │
│ └─────────────────────────────────────┴──────────────────┘ │
├────────────────────────────────────────────────────────────┤
│ Content Area                                                │
│ ┌──────────────────────────────────┬─────────────────────┐ │
│ │                                  │ TableOfContents     │ │
│ │ 内容区 (content-width)            │ (xl 以上可见)       │ │
│ │                                  │ 220px, sticky       │ │
│ │ MarkdownView / CsvView /         │ top-20              │ │
│ │ JsonView / Renderer              │                     │ │
│ │                                  │ heading 列表        │ │
│ │                                  │ 当前可视区高亮       │ │
│ ├──────────────────────────────────┤                     │ │
│ │ Backlinks                        │                     │ │
│ │ (引用当前文件的其他文件)           │                     │ │
│ └──────────────────────────────────┴─────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### Top Bar 操作按钮

按钮遵循统一样式：`px-3 py-1.5 rounded-md text-xs font-medium font-display`。

| 按钮 | 条件 | 底色 | 文字色 | 图标 |
|------|------|------|--------|------|
| Graph | md 文件 + graph plugin 已启用 + 非编辑态 | 激活: `amber-dim` / 默认: `muted` | 激活: `amber` / 默认: `muted-foreground` | `Share2` / `FileText` |
| Raw | 有 renderer + 非编辑态 + 非 graph 模式 | 同上 | 同上 | `Code` / `LayoutTemplate` |
| Edit | 非编辑态 + 无 renderer 覆盖 + 非 draft | `muted` | `muted-foreground` | `Edit3` |
| Cancel | 编辑态 | `muted` | `muted-foreground` | `X` |
| Save | 编辑态 | `amber` | `amber-foreground` | `Save` / `Loader2` (pending) |

### 视图模式切换

```
                    ┌── editing=true ──→ MarkdownEditor (wysiwyg / source)
                    │                    CsvView (inline edit)
ViewPageClient ─────┤
                    │   ┌── graphMode ──→ GraphRenderer
                    └── editing=false
                        │   ┌── useRaw ──→ MarkdownView (原始渲染)
                        └── └── default ──→ RegistryRenderer (如 TodoRenderer)
                                           或 MarkdownView + TOC
```

### 编辑模式

| 文件类型 | 编辑器 | 特殊行为 |
|----------|--------|---------|
| Markdown | `MarkdownEditor` (Tiptap WYSIWYG / source 双模式) | `⌘S` 保存，`Esc` 取消 |
| CSV | `CsvView` (内联编辑 + 追加行) | 保存时同步 saveAction |
| JSON | 不可编辑（只读查看） | — |
| Draft (Untitled.md) | MarkdownEditor + SaveAs 面板 | 选择目录 + 文件名后保存 |

### Draft SaveAs 面板

```
┌───────────────────────────────────────────────────┐
│ ┌─────────────────┐ ┌───────────────────────────┐ │
│ │ Directory  [▼]  │ │ File name                 │ │
│ │ /               │ │ Untitled.md               │ │
│ └─────────────────┘ └───────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

- `<select>` 遍历知识库所有目录
- `<input>` 支持 Enter 快速确认
- 校验：禁止路径穿越、非法字符

### Find in Page

`⌘F`（非编辑态）激活 `FindInPage` 组件，覆盖在内容区顶部。

### Backlinks

内容区底部渲染 `Backlinks`，列出所有通过 wiki-link 引用当前文件的笔记。

---

## 3. AI 对话 (AskModal)

### 当前形态

全屏 Modal（z-50），桌面居中 `max-w-2xl max-h-[75vh]`，移动端底部 sheet `h-[92vh]`。

### 面板结构

```
┌──────────────────────────────────────────────┐
│ Header                                        │
│ [✨ Ask AI — {filename}]  [📜] [↻] [✕]       │
├──────────────────────────────────────────────┤
│ SessionHistory (条件渲染，点击 📜 切换)        │
├──────────────────────────────────────────────┤
│ MessageList (flex-1, 可滚动)                  │
│                                              │
│ 空状态：emptyPrompt + suggestion chips       │
│ 加载态：connecting → thinking → streaming    │
│                                              │
│ User 消息（右对齐）                           │
│ Assistant 消息（左对齐，含 tool call blocks）  │
│ Error 消息（amber/红色提示）                  │
├──────────────────────────────────────────────┤
│ Input Area                                    │
│ ┌── Attached files (KB Context) ──────────┐  │
│ │ [📄 file.md ✕] [📄 notes.csv ✕]         │  │
│ └─────────────────────────────────────────┘  │
│ ┌── Uploaded files ───────────────────────┐  │
│ │ [📎 image.png ✕]                        │  │
│ └─────────────────────────────────────────┘  │
│ ┌── @mention dropdown (条件渲染) ─────────┐  │
│ │ file1.md                                │  │
│ │ file2.csv  (arrow key 导航)              │  │
│ └─────────────────────────────────────────┘  │
│ [📎] [@] [ input ........................] [▶]│
├──────────────────────────────────────────────┤
│ Footer hints: ↵ Send  @ Attach  ESC Close    │
└──────────────────────────────────────────────┘
```

### 交互流

```
用户打开 (⌘/ 或 AskFab)
  │
  ├─ 初始化 Session（loadSessions, 恢复历史）
  ├─ 自动 attach 当前查看的文件
  ├─ Focus 输入框
  │
  ├─→ 输入 "@" → 触发 mention 搜索 → 选择文件 → 添加到 attachedFiles
  ├─→ 点击 📎 → 本地文件上传 → 显示在 Uploaded Files
  │
  ├─→ 提交消息
  │     ├─ POST /api/ask (streaming)
  │     ├─ 状态流：connecting → thinking → streaming
  │     ├─ 实时更新最后一条 assistant 消息
  │     └─ 完成 / 错误 / 中止
  │
  ├─→ ↻ 新建会话 → 清空消息、重置附件
  ├─→ 📜 查看历史 → 加载旧会话
  └─→ ESC / 点击 backdrop → 关闭
```

### Loading 三阶段

| 阶段 | 触发时机 | 视觉表现 |
|------|---------|---------|
| `connecting` | 请求发出 | "Connecting..." 文字 |
| `thinking` | 收到 response headers | "Thinking..." 文字 |
| `streaming` | 收到第一个 content chunk | 消息实时更新，光标闪烁 |

### 错误处理

| 场景 | 行为 |
|------|------|
| HTTP 错误 | 解析 error body，显示为 `__error__` 前缀消息 |
| 用户中止 | 保留已有内容，无内容时显示 "Stopped" |
| 空响应 | 显示 "No response" 提示 |

---

## 4. 搜索 (SearchModal)

全局搜索，`⌘K` 触发。

### 布局

```
┌──────────────────────────────────────────────┐
│ [🔍 Search files...                     ESC] │
├──────────────────────────────────────────────┤
│ 结果列表 (即时搜索)                           │
│ ┌──────────────────────────────────────────┐ │
│ │ 📄 filename.md                           │ │
│ │   directory/path                         │ │
│ │   ...matching context snippet...         │ │
│ ├──────────────────────────────────────────┤ │
│ │ 📄 another-file.csv                      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 空状态："No results found"                   │
└──────────────────────────────────────────────┘
```

### 交互

- 输入即搜（debounce ~200ms）
- `↑`/`↓` 选择结果，`Enter` 打开
- `ESC` 关闭
- 搜索范围：文件名 + 全文内容

---

## 5. 设置 (SettingsModal)

`⌘,` 触发，8-tab 结构。

### Tab 清单

| Tab | 组件 | 职责 |
|-----|------|------|
| `ai` | `AiTab` | AI 服务商、模型、API Key、Agent 参数 |
| `appearance` | `AppearanceTab` | 字体、内容宽度、深色模式、语言 |
| `knowledge` | `KnowledgeTab` | 知识库路径、环境变量覆盖 |
| `mcp` | `McpTab` | MCP 状态、Agent 安装、Skill 管理 |
| `plugins` | `PluginsTab` | 插件开关 |
| `sync` | `SyncTab` | Git 同步配置、冲突管理 |
| `shortcuts` | `ShortcutsTab` | 快捷键参考 |

### 布局

```
┌──────────────────────────────────────────────────────┐
│ Settings                                         [✕] │
├────────────┬─────────────────────────────────────────┤
│ Tab List   │ Active Tab Content                      │
│ (左侧竖排) │                                         │
│            │ 各 tab 独立管理状态                      │
│ ● AI      │ Save 按钮在各 tab 内部                   │
│   Appear  │                                         │
│   Knowledge│                                        │
│   MCP     │                                         │
│   Plugins │                                         │
│   Sync    │                                         │
│   Shortcuts│                                        │
└────────────┴─────────────────────────────────────────┘
```

移动端 Tab List 变为水平滚动条。

---

## 6. 初始化向导 (Setup)

### 步骤流

```
Step 1: KB Path  →  验证路径存在
Step 2: AI       →  选择 provider + 配置 API Key
Step 3: Ports    →  Web Port + MCP Port
Step 4: Security →  Web Password + Auth Token
Step 5: Env      →  环境变量检查
Step 6: Agents   →  MCP Agent 安装
Step 7: Skills   →  Skill 启用/禁用
Step 8: Review   →  总览确认 → 完成
```

### 布局

```
┌──────────────────────────────────────────────┐
│ MindOS Setup                                  │
├──────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐   │
│ │ Progress: ● ● ● ○ ○ ○ ○ ○  (3/8)     │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ Step Content                                 │
│ (表单/配置内容)                               │
│                                              │
│                    [Back]  [Next / Complete]  │
└──────────────────────────────────────────────┘
```

- 整页布局，无 Sidebar
- 进度条横向 8 步，已完成用 amber 填充
- Back/Next 按钮固定底部

---

## 7. 登录页 (Login)

极简布局，居中表单。

```
┌──────────────────────────────────────────────┐
│                                              │
│           MindOS Logo                        │
│                                              │
│      ┌────────────────────────┐              │
│      │ Password [••••••]      │              │
│      │ [Login]                │              │
│      └────────────────────────┘              │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 公共组件规格

### Sidebar

| 属性 | 值 |
|------|-----|
| 宽度 | 280px (fixed) |
| 背景 | `bg-card` |
| 边框 | `border-r border-border` |
| z-index | 30 |
| 过渡 | `transition-transform duration-300` |

桌面端完整左侧栏 = **Activity Bar**（见上节）+ **本 Panel 容器**。移动端 Drawer 内仍为「Header + FileTree + Sync」式结构，无 Rail。

**Header 区**：Logo + 品牌名 + 动作按钮（Search / Settings / Collapse）

**FileTree 区**（`activePanel === 'files'` 时）：`overflow-y-auto`，占据 `flex-1`。层级缩进，文件夹展开/折叠。文件图标按类型区分（📄md / 📊csv / 📁dir）。当前文件高亮。

**SyncStatusBar**：底部 sticky，显示同步状态。健康指示灯（绿/黄/红 dot）。点击打开 Settings > Sync tab。

### Breadcrumb

```
Home / directory / subdirectory / filename.md
  ↑       ↑            ↑              ↑
 Link    Link         Link        当前(无链接)
```

- 各段 URL encode
- 当前文件不可点击
- 长路径在移动端省略中间段

### AskFab

```
Fixed bottom-6 right-6, z-40
amber 圆形按钮，Sparkles 图标
点击打开 AskModal
```

### TableOfContents

- 仅 `xl:` 以上显示
- 从 content 提取 h1-h4
- Intersection Observer 追踪当前可视 heading
- 当前 heading amber 高亮
- 点击平滑滚动到对应位置

---

## Renderer 系统

MindOS 通过 Renderer Registry 支持可插拔的内容渲染器。

### 渲染器列表

| Renderer | 触发文件/路径 | 功能 |
|----------|-------------|------|
| TodoRenderer | `TODO.md` | 交互式待办列表，拖拽排序 |
| GraphRenderer | 任意 md (opt-in) | 知识图谱可视化 |
| WorkflowRenderer | `Workflows/**/*.md` | 工作流编排 |
| DiffRenderer | `*.diff` | 代码差异查看 |
| TimelineRenderer | `CHANGELOG.md` | 时间线展示 |
| CsvView | `*.csv` | 表格/看板/画廊三视图 |

### 渲染优先级

```
1. graphMode=true && extension=md → GraphRenderer
2. registryRenderer exists && !useRaw → RegistryRenderer
3. extension=csv → CsvView
4. extension=json → JsonView
5. default → MarkdownView + TableOfContents
```

---

## 键盘快捷键

| 快捷键 | 作用域 | 行为 |
|--------|--------|------|
| `⌘K` | 全局 | 打开/关闭 SearchModal |
| `⌘/` | 全局 | 打开/关闭 AskModal |
| `⌘,` | 全局 | 打开/关闭 SettingsModal |
| `⌘S` | ViewPage 编辑态 | 保存 |
| `⌘F` | ViewPage 非编辑态 | Find in Page |
| `E` | ViewPage 非编辑态 (body focused) | 进入编辑 |
| `Escape` | 任何 Modal / 编辑态 | 关闭 / 取消 |

---

## 响应式断点行为

| 断点 | Sidebar | Top Bar | TOC | AskModal | Settings Tabs |
|------|---------|---------|-----|----------|---------------|
| <768px | 隐藏，Drawer 模式 | 显示 Header | 隐藏 | 底部 sheet 92vh | 水平滚动 |
| ≥768px | 固定左侧 280px | 不显示 | 隐藏 | 居中 modal 75vh | 左侧竖排 |
| ≥1280px | 固定左侧 280px | 不显示 | 固定右侧 220px | 居中 modal 75vh | 左侧竖排 |

---

## 优化路线图

> 按优先级排列，详细设计在对应 spec 中展开。

### P0 — 体验质变

| 改动 | 说明 | 预估 |
|------|------|------|
| Activity Bar + Panel 布局重构 | 左侧 48px Rail（Logo + 空间/回响/搜索/插件/智能体/探索 + 底部 Help/Sync/Settings）+ 可切换 Panel，与主内容并排。AI 对话、搜索等多为 Panel/右侧栏形态。移动端 Drawer 不变。回响见 `wiki/specs/spec-echo-panel.md`。详见 `wiki/specs/spec-activity-bar-layout.md` | 3-4d |

### P1 — 日常效率

| 改动 | 说明 | 预估 |
|------|------|------|
| 输入框 textarea 化 | AskModal 的 `<input>` 改为自适应高度 `<textarea>`，支持多行输入（Shift+Enter 换行） | 0.5d |
| FileTree Pin 收藏 | 常用文件/文件夹置顶，⭐ 标记，localStorage 持久化 | 0.5d |
| FileTree 折叠记忆 | 记住用户展开/折叠的目录状态，刷新后恢复 | 0.5d |
| 色彩变量一致性 | 清理残留的 Tailwind amber-500 硬编码，统一用 CSS 变量 | 0.5d |

### P2 — 精细化

| 改动 | 说明 | 预估 |
|------|------|------|
| Sidebar 宽度可调 | 拖拽条调整 200-400px，localStorage 记忆 | 1d |
| 首页双列布局 | md+ Recent 左 60% / Plugins 右 40%，减少滚动 | 1d |
| 搜索增强 | 最近搜索记录、结果预览 peek、搜索范围过滤 | 1d |

### P3 — 打磨

| 改动 | 说明 | 预估 |
|------|------|------|
| TOC 中屏折叠 | 1024-1279px TOC 折叠为顶部图标下拉 | 0.5d |
| 保存成功动效 | checkmark SVG stroke animation 0.3s | 0.5d |
| Plugin 卡片 hover 提升 | `translateY(-1px)` + `shadow-sm` | 0.5d |
| View Top Bar 溢出处理 | 窄屏按钮收入 `•••` 溢出菜单 | 0.5d |
