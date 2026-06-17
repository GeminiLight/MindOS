<!-- Last verified: 2026-06-17 | Current stage: P1 -->

# 设计原则 (Design Principle)

本文件分两层使用：

1. **设计哲学**：定义 MindOS 的长期视觉性格，不随单个页面或组件变化。
2. **设计系统契约**：定义代码里应该复用的 primitive、token、surface、层级和交互规则。新组件优先遵守契约；契约没有覆盖时，先补契约再写局部样式。

## 核心品牌主张

**MindOS：让认知沉淀，让心手并进。**

在 AI 时代，心负责判断，手交给 Agent。

---

## 设计哲学

**Warm Amber — 人机共生的温暖工业感。** 琥珀色传递思考的温度，非对称结构表达人机互补。

工程落地时，这句话翻译成三个硬约束：

- **内容优先**：页面 chrome、阴影、装饰和浮层都让位于阅读与操作路径。
- **克制强调**：Amber 只表达当前焦点、关键动作、轻提示和系统状态，不做大面积装饰。
- **同类同形**：按钮、输入、下拉、浮层、卡片、badge、toast、页面壳必须优先使用同一套 primitive，不能在每个页面重新发明。

## Logo：不对称的无限大 (The Asymmetric Infinity)

传统 ∞ 符号的现代重构，象征人类智慧与机器执行力的共生循环。

| 元素 | 视觉 | 寓意 |
|------|------|------|
| 左侧（人类端） | 3px 细线 + 虚线 (Dash 2:4) | 非连续、跳跃、灵感碎片 |
| 右侧（Agent 端） | 4.5px 粗线 + 实心 | 确定性、连续性、执行力 |
| 比例 | 右侧半径 (~22px) > 左侧 (~15px) | "思维激发，行动放大" |
| 交汇处 | 四角星芒 (2.5px)，暖白 `#FEF3C7` | AI 点燃灵感的瞬间 |

**梯度：** 人类侧 opacity 0.8→0.3（思维模糊性）| Agent 侧 0.8→1.0（工业可靠性）

**工程格式：**
- 横向 `logo.svg`：80×40，导航栏/侧边栏
- 正方形 `logo-square.svg`：80×80，Favicon/App Icon
- SVG 格式，`stroke-linecap="round"`

## 调色板

低饱和温暖土色系，避免 Tailwind 默认的高饱和 amber。

### 亮色模式 (:root)

| Token | 值 | 语义用途 |
|-------|-----|---------|
| `--amber` | `#c8873a` | 品牌主色，交互高亮，链接，focus ring |
| `--amber-text` | `#9a6a2b` | 浅 amber 底上的文字，不用于 amber 实底 |
| `--amber-dim` | `rgba(200,135,58,0.18)` | 较强 amber 背景色（active、selected） |
| `--amber-subtle` | `rgba(200,135,30,0.08)` | 轻 amber 背景色（icon shell、hint、quiet selected） |
| `--amber-foreground` | `#ffffff` | amber 背景上的文字色（白色，确保可读性） |
| `--background` | `#f8f6f1` | 页面背景（温暖米白） |
| `--foreground` | `#1c1a17` | 正文前景色 |
| `--primary` | `#1c1a17` | 主按钮填充色（深灰，非 amber） |
| `--primary-foreground` | `#f8f6f1` | 主按钮文字 |
| `--card` | `#f2efe9` | 卡片背景 |
| `--muted` | `#e8e4db` | 禁用/次要背景 |
| `--muted-foreground` | `#7a7568` | 辅助文字 |
| `--accent` | `#d9d3c6` | 高亮背景（hover 行等） |
| `--border` | `rgba(28,26,23,0.1)` | 边框 |
| `--sidebar` | `#ede9e1` | 侧边栏背景 |

### 暗色模式切换机制

- `<html>` 元素上添加 `.dark` class 切换暗色模式
- 支持 system preference 自动跟随（`prefers-color-scheme: dark`）
- 手动切换入口：Settings > Appearance
- `layout.tsx` 包含 blocking script，在首次渲染前注入 `.dark` class，防止亮→暗闪烁（FOUC）

### 暗色模式 (.dark)

| Token | 值 | 语义用途 |
|-------|-----|---------|
| `--amber` | `#d4954a` | 品牌主色（暗色微提亮） |
| `--amber-text` | `#e0a85e` | 浅 amber 底上的文字，不用于 amber 实底 |
| `--amber-dim` | `rgba(212,149,74,0.20)` | 较强 amber 背景色（active、selected） |
| `--amber-subtle` | `rgba(212,149,74,0.10)` | 轻 amber 背景色（icon shell、hint、quiet selected） |
| `--amber-foreground` | `#ffffff` | amber 背景上的文字色（白色，确保可读性） |
| `--background` | `#131210` | 页面背景（近纯黑） |
| `--foreground` | `#e8e4dc` | 正文前景色 |
| `--primary` | `#e8e4dc` | 主按钮填充色 |
| `--primary-foreground` | `#131210` | 主按钮文字 |
| `--card` | `#1c1a17` | 卡片背景 |
| `--muted` | `#252219` | 禁用/次要背景 |
| `--muted-foreground` | `#8a8275` | 辅助文字 |
| `--accent` | `#2e2b22` | 高亮背景 |
| `--border` | `rgba(232,228,220,0.08)` | 边框 |
| `--sidebar` | `#1c1a17` | 侧边栏背景 |

### Prose 阅读区色板

独立于全局色板，专为 Markdown 长文阅读优化。

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `--prose-body` | `#3a3730` | `#c8c2b8` | 正文 |
| `--prose-heading` | `#1c1a17` | `#e8e4dc` | 标题 |
| `--prose-muted` | `#5a5750` | `#9a9488` | 次要文字 |
| `--prose-border` | `#ddd9d0` | `rgba(232,228,220,0.1)` | 分隔线、表格边框 |
| `--prose-pre-bg` | `#eae6de` | `#0a0906` | 代码块背景 |

### 语法高亮色板

| Token | 亮色 | 暗色 |
|-------|------|------|
| `--hljs-keyword` | `#9b4a1a` | `#d4954a` |
| `--hljs-string` | `#4a7a46` | `#a5c4a0` |
| `--hljs-variable` | `#7a6830` | `#d4c08a` |
| `--hljs-number` | `#2a5a8a` | `#8ab4d8` |
| `--hljs-title` | `#6a3a8a` | `#c8a0d8` |
| `--hljs-comment` | `#8a8275` | `#6a6560` |

### 状态色

代码中频繁使用的语义色值，统一为 CSS 变量管理：

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `--success` | `#7aad80` | `#7aad80` | 保存成功、同步完成、在线状态 |
| `--error` | `#c85050` | `#c85050` | 操作失败、删除确认、错误提示 |
| `--warning` | `var(--amber)` | `var(--amber)` | 警告提示（复用品牌色） |
| `--info` | `#5a8ab4` | `#8ab4d8` | 信息提示、帮助文本 |
| `--destructive` | `oklch(0.56 0.14 24)` | `oklch(0.56 0.14 22)` | 破坏性操作按钮背景（删除、放弃等） |
| `--destructive-foreground` | `#ffffff` | `#ffffff` | 破坏性按钮文字（白色） |

#### Destructive 色彩设计原则

- **克制而非恐吓**：破坏性操作用低饱和暖红（terracotta/dusty rose），不用高饱和刺眼红。与品牌 "温暖、专业、克制" 一致。
- **`--destructive` vs `--error`**：`--destructive` 用于按钮/操作背景（低饱和、配白字），`--error` 用于文字/图标提示（中等饱和、需要足够对比度）。两者不要混用。
- **按钮用法**：`bg-destructive text-destructive-foreground`，hover 用 `hover:bg-destructive/90`。

> **迁移状态**：核心 token 已存在，仍需要防止组件继续散落 `rgba(...)`、Tailwind 原色和局部 `color-mix(...)`。装饰色（例如文件类型、文件夹图标）可以保留原色，但必须限定在装饰语义；工具操作色（read/search/create/delete）应进入 renderer theme 或 CSS token，不在组件里重复硬编码。

### 硬编码色值禁令

**规则**：组件中禁止使用 `#xxxxxx` / `rgb()` 硬编码色值，必须走 CSS 变量（`var(--amber)` / `var(--foreground)` 等）。

| 分类 | 做法 | 示例 |
|------|------|------|
| **品牌/CTA** | `var(--amber)` + `var(--amber-foreground)` | `bg-[var(--amber)] text-[var(--amber-foreground)]` |
| **状态色** | `var(--success)` / `var(--error)` | `text-success` / `bg-error/10` |
| **文字** | `var(--foreground)` / `var(--muted-foreground)` | `text-foreground` / `text-muted-foreground` |
| **背景/边框** | `var(--card)` / `var(--border)` | `bg-card border-border` |

**例外**：CodeMirror 等第三方编辑器的主题对象不走 DOM CSS 变量（它们有独立的主题系统），硬编码是唯一选择，需在代码注释中标注。

### Amber 使用边界

| Token | 使用场景 | 禁止 |
|------|---------|------|
| `--amber` | CTA 实底、focus ring、当前主焦点、链接 | 大面积背景、普通正文 |
| `--amber-foreground` | 只用于 `--amber` 实底上的文字或图标 | 单独作为文字色；浅底上使用 |
| `--amber-text` | `--amber-subtle` / `--amber-dim` 浅底上的文字 | 实底按钮文字 |
| `--amber-subtle` | icon shell、quiet selected、轻提示背景 | 表达强 active 状态 |
| `--amber-dim` | active row、selected chip、较强 hover/active 背景 | 普通页面区块背景 |

组件中不要临时写 `color-mix(in_srgb,var(--amber)_XX%,...)` 来创造新的 amber 变体。确实需要新强度时，先补 token 或 primitive variant。

## 字体栈

四层字体分工，通过 CSS class 统一使用，**禁止 inline fontFamily**。

| 层级 | 字体 | CSS class / 选择器 | 用途 |
|------|------|-------------------|------|
| 品牌 | IBM Plex Sans 600 + letter-spacing 0.04em | `.font-brand` | "MindOS" 品牌名（仅品牌文字） |
| 正文 | Lora (serif) | `.prose` | Markdown 长文阅读 |
| UI / 标题 | IBM Plex Sans | `body`、`.prose h1-h4` | 界面元素、标题、标签、按钮 |
| 代码 / 技术 | IBM Plex Mono | `.font-display`、`code`、`.font-mono` | 代码块、等宽展示、版本号、文件路径、键盘快捷键 |

### `.font-display` 使用范围（严格限制）

`.font-display`（IBM Plex Mono 等宽体）**仅限**以下场景：
- 代码块和内联 `<code>`
- 键盘快捷键 `<kbd>`（如 `Cmd+K`）
- 版本号和技术标识符（如 `v0.6.27`、commit hash）
- JSON/CSV 数据视图
- Agent 活动日志中的工具名和文件路径
- Renderer 里的字段名、路径、计数、技术标签

**禁止**在以下元素上使用 `.font-display`：
- Section 标题（用默认 IBM Plex Sans）
- 按钮文字、链接文字
- 时间戳（relativeTime 显示）
- 面包屑导航
- Agent 名称、描述
- 表单标签
- Footer 文字
- Renderer 里的普通按钮、空状态说明、非技术标题

> 原因：等宽字体在中文环境下字间距不自然，且在 12-14px 小字号下显得"技术感过重"，不适合作为通用 UI 字体。

### Font Weight 使用规范

| 字体 | Weight | 用途 |
|------|--------|------|
| Lora | 400, 400i, 700 | Prose 正文、斜体、加粗 |
| IBM Plex Sans | 400, 500, 600 | UI 正文、中等强调、标题 |
| IBM Plex Mono | 400, 600 | 代码正文、display 标题 |

> **不要随意删除 weight 子集**（见 `80-known-pitfalls.md`），Google Fonts 加载时需要显式声明每个 weight。

**规则：** 新组件统一用 Tailwind `font-mono` / `font-sans` 或 CSS class `.font-brand`（品牌名）/ `.font-display`（代码/技术），不直接写 `style={{ fontFamily: ... }}`。

## UI 原则

| 原则 | 具体要求 |
|------|---------|
| Speed First | 无 loading spinner，内容即开即读 |
| Minimal Chrome | 只保留内容与搜索，无多余装饰 |
| Keyboard-driven | ⌘K 搜索、⌘/ AI 对话、⌘E 编辑模式 |
| 长文阅读优化 | prose 行高 1.85，代码块高对比，serif 正文 |

## 设计系统契约

### Primitive 决策表

同类 UI 必须优先复用同一入口，避免在页面里手写一套“看起来差不多”的样式。

| 场景 | 优先使用 | 禁止 / 需要说明 |
|------|---------|----------------|
| 普通按钮、icon button、CTA | `components/ui/button.tsx` 的 `Button` / `buttonVariants` | 新增手写 `bg-[var(--amber)] text-[var(--amber-foreground)]` 按钮 |
| Settings 表单和卡片 | `components/settings/Primitives.tsx` 的 `SettingCard`、`Field`、`Input`、`Select`、`Toggle` | 在 settings 子页新增裸 `rounded-xl border bg-card` surface |
| 内容页容器 | `components/shared/ContentPageShell.tsx` | 手写 `max-w-* mx-auto px-*`，除非该页明确不是内容页 |
| 左侧 panel 头部和导航行 | `panels/PanelHeader`、`panels/PanelNavRow` | 每个 panel 自己重写 header 高度、active 背景、icon button |
| Modal / Dialog | `components/ui/dialog.tsx` 或统一 `ModalSurface` pattern | 自写 `rounded-2xl shadow-2xl`、自写 backdrop |
| Popover / menu / listbox | 统一 floating/listbox primitive；没有时先抽取 | 组件内新增 `fixed z-50`、`z-[60]`、inline `zIndex` |
| Renderer table / toolbar / badge | renderer shared primitives 或 renderer theme | renderer 内复制 status map、inline table style、局部 segmented control |
| Hit target / hover area | `hit-target-box` 的既定 variant | 使用点直接堆 6 个以上 `--hit-target-*` 变量 |

### Surface taxonomy

| Surface | 默认样式 | 用途 |
|---------|----------|------|
| `CardSurface` | `rounded-lg border border-border bg-card` | 普通内容卡片、列表项容器 |
| `SettingSurface` | `rounded-xl border border-border/60 bg-card/65 p-5` | Settings 中有图标、说明、控件的配置块 |
| `PanelSurface` | 边框分隔，少阴影或无阴影 | 左右 panel、固定侧栏 |
| `PopoverSurface` | `rounded-lg border border-border bg-card shadow-lg` | 菜单、下拉、轻量浮层 |
| `ModalSurface` | `rounded-xl border border-border bg-card shadow-xl` | 居中 modal |
| `BottomSheetSurface` | mobile only `rounded-t-xl` 或 `rounded-t-2xl` | 移动端底部 sheet |
| `ToastSurface` | `rounded-lg` 或紧凑 `rounded-full` | 临时通知、状态提示 |

`rounded-2xl`、`shadow-2xl` 只用于移动底部 sheet、品牌登录卡或特殊 walkthrough；新增使用必须在 PR 描述中说明。

## 组件模式

### 圆角

| 场景 | Tailwind class | 实际值 |
|------|---------------|--------|
| 小元素（badge、tag、kbd） | `rounded` | 4px |
| 中等元素（输入框、代码内联） | `rounded-md` | 6px |
| 卡片、代码块 | `rounded-lg` | 8px (`--radius`) |
| 面板、模态框内容区 | `rounded-xl` | 12px |

### 组件规范

- **卡片：** `rounded-lg`、`bg-card`、`border border-border`，hover 时 amber 边框
- **按钮：** 主按钮 `bg-primary text-primary-foreground`，次按钮 `border border-border` 透明底。**Amber CTA 按钮**统一 `bg-[var(--amber)] text-[var(--amber-foreground)]`，`--amber-foreground` 必须是白色（`#ffffff`）——深色底 + 深色字不可读。**禁止**在非 amber 背景上使用 `amber-foreground` 作为文字色（该变量语义仅为"amber 背景上的前景"）。**Destructive 按钮**统一 `bg-destructive text-destructive-foreground`——低饱和暖红底 + 白字，不用高饱和红（详见状态色 Destructive 设计原则）
- **输入框：** `rounded-md border border-border bg-background`，focus 时 `ring-1 ring-ring`
- **模态框：** 居中，`modal-backdrop` 毛玻璃遮罩 `blur(8px)`，max-width 600px
- **辅助浮层：** 侧滑面板/确认弹窗等使用 `overlay-backdrop` 轻遮罩 `blur(2px)`，不切断上下文
- **浮动菜单/Popover：** `bg-card border-border shadow-lg rounded-lg`，无遮罩
- **Select 下拉：** 自定义组件（`settings/Primitives.tsx`），禁止原生 `<select>`。触发器样式同 Input；下拉面板 `bg-card border-border shadow-lg rounded-lg`；选中项 amber `✓` + `bg-accent`；键盘 ↑↓/Enter/Escape/Tab；`useId()` 确保多实例 ID 唯一
- **Badge：** `text-[10px] px-1.5 py-0.5 rounded font-mono`，色彩按状态区分
- **Toggle/Switch：** `w-9 h-5 rounded-full`，开启 `bg-amber-600`，关闭 `bg-muted`

### Focus 规范

所有可交互元素统一 focus-visible 样式：
```css
outline: 2px solid var(--amber);
outline-offset: 2px;
border-radius: 4px;
```

`--ring` 变量指向 `var(--amber)`，shadcn/ui 组件通过 `ring-ring` 自动继承。自定义 input 使用 `focus-visible:ring-1 focus-visible:ring-ring`。**不要用 `focus:` 前缀**（鼠标点击不应触发 ring）。

### Z-Index 层级

| 语义 | Tailwind / CSS | 用途 |
|------|----------------|------|
| page-sticky | `z-10` / `z-20` | TOC、页面内 sticky、局部 action dock |
| app-chrome | `z-30` | titlebar、activity rail、主 sidebar/header |
| app-panel | `z-40` | 右侧 ask/detail panel、mobile overlay、可调整 panel handle |
| app-popover | `z-50` | menu、listbox、tooltip、popover |
| app-modal | `z-50` | modal、dialog、confirm |
| system-overlay | 语义 class/token | update overlay、walkthrough、必须盖过 modal 的系统级引导 |

**规则：** 新组件选择最接近的语义层级，不要直接写表外数字。新增 `z-[...]`、`zIndex: ...`、`9999` 必须先补语义 class/token 和说明。

## 动效规范

| 动效 | 时长 | 缓动 | 用途 |
|------|------|------|------|
| `fadeSlideUp` | 0.22s | ease | 内容进入（列表项、卡片） |
| `slideUp` | 0.3s | ease-out | 移动端底部 sheet 模态框 |
| `transition-colors` | 0.15s | default | hover/focus 颜色过渡 |
| `transition-all` | default | default | toggle 滑块位移 |
| CSS Grid 展开 | 0.2s | ease-out | 内联列表/目录展开收起 |

**规则：** hover/focus/layout 动画不超过 0.3s，优先用 CSS transition 而非 keyframe animation。连续进度条可以使用 0.3-0.5s，但只限 progress fill，不用于 hover、popover、panel 或布局切换。

### 内联展开动画

统一使用 CSS Grid `grid-template-rows` 过渡实现内联展开/收起：

```html
<div class="grid transition-[grid-template-rows] duration-200 ease-out
            ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}">
  <div class="overflow-hidden">
    ... expanded content ...
  </div>
</div>
```

- 浏览器自动计算真实高度，无需 magic number
- 开/关速度一致（不像 `maxHeight: 9999px` 关闭时延迟）
- **例外**：AI 对话中的 `ToolCallBlock` / `ThinkingBlock` 等流式输出组件可保留条件渲染（内容长度不可预测，动画无意义）
- **禁止**：`maxHeight: 9999px` hack、`height: auto` transition（浏览器不支持）

## 机器可查 guardrails

新增或修改 Web UI 时，PR 前至少跑一次对应 grep，新增命中必须解释或消除：

```bash
# 组件里禁止新增硬编码色与 rgba 派生状态色
rg '#[0-9A-Fa-f]{3,8}|rgba?\(' packages/web/app packages/web/components --glob '*.{tsx,ts}' --glob '!*.test.*'

# 禁止新增表外层级
rg 'z-\[[^\]]+\]|zIndex:|9999' packages/web/app packages/web/components --glob '*.{tsx,ts}'

# 禁止新增原生 select；优先使用自定义 Select/listbox primitive
rg '<select|<option' packages/web/app packages/web/components --glob '*.{tsx,ts}'

# 禁止继续复制 amber CTA class；优先使用 Button variant
rg 'bg-\[var\(--amber\)\].*text-\[var\(--amber-foreground\)\]' packages/web/app packages/web/components --glob '*.{tsx,ts}'

# 检查过度圆角/阴影是否属于 surface taxonomy
rg 'rounded-2xl|shadow-2xl' packages/web/app packages/web/components --glob '*.{tsx,ts}'
```

这些 guardrails 是“新增债务拦截”，不是要求一次清空历史命中。做风格治理 PR 时按 primitive / surface / renderer 分批收口。

### 遮罩两级制

| 级别 | CSS class | 效果 | 适用场景 |
|------|-----------|------|---------|
| 重遮罩 | `.modal-backdrop` | `rgba(10,9,6,0.72)` + `blur(8px)` | 核心模态框（Ask、Settings、Search、Import） |
| 轻遮罩 | `.overlay-backdrop` | `rgba(10,9,6,0.35)` + `blur(2px)` | 辅助浮层（侧滑详情、确认弹窗、shadcn Dialog） |

**规则**：不要在组件中硬编码 `bg-black/XX backdrop-blur-[Xpx]`，统一引用 CSS class。

## 响应式策略

| 断点 | Tailwind | 适配策略 |
|------|----------|---------|
| < 640px (mobile) | 默认 | prose 字号 0.95rem，代码块 0.82em，表格 `display: block` 横滚 |
| ≥ 640px (sm) | `sm:` | prose 字号 1rem，代码块 0.855em，表格 `display: table` |
| ≥ 768px (md) | `md:` | 模态框居中（移动端为底部 sheet） |
| ≥ 1280px (xl) | `xl:` | TOC 侧栏显示（`hidden xl:block`），内容区右偏移（`xl:mr-[220px]`） |

### 移动端专项

- **模态框：** `< md` 从底部滑入（`slideUp`），`≥ md` 居中弹出
- **Safe area：** `padding-bottom: env(safe-area-inset-bottom)` 适配 iOS 刘海/Home Indicator
- **Tap highlight：** `hover: none` 时移除 `-webkit-tap-highlight-color`
- **滚动条：** 全局 5px 细滚动条，`.scrollbar-none` 可隐藏

## 内容宽度

```css
:root { --content-width: 780px; }
```

可通过 Settings > Appearance 覆盖为 `--content-width-override`。容器使用 `.content-width` class 自动居中。

## 无障碍 (Accessibility)

| 规范 | 要求 |
|------|------|
| 键盘导航 | 所有可交互元素可 Tab 到达；快捷键 ⌘K（搜索）、⌘/（AI 对话）、⌘E（编辑模式） |
| ARIA | Modal 必须 `role="dialog" aria-modal="true"`；toggle 用 `role="switch" aria-checked` |
| 屏幕阅读器 | 纯图标按钮必须有 `aria-label`；装饰性图标加 `aria-hidden="true"` |
| 动效 | 已支持 `prefers-reduced-motion: reduce` 关闭动画 |
| 色彩对比 | 正文/背景对比度 ≥ 4.5:1（WCAG AA） |
| Skip link | 未来应增加 "Skip to content" 跳转链接 |
