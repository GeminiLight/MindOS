<!-- Last verified: 2026-03-17 | Current stage: P1 -->

# 设计原则 (Design Principle)

## 设计哲学

**Warm Amber — 人机共生的温暖工业感。** 琥珀色传递思考的温度，非对称结构表达人机互补。

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
| `--amber-dim` | `rgba(200,135,58,0.12)` | amber 背景色（badge、hover 底色） |
| `--amber-foreground` | `#131210` | amber 按钮上的文字前景色 |
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
| `--amber-dim` | `rgba(212,149,74,0.12)` | amber 背景色 |
| `--amber-foreground` | `#131210` | amber 按钮上的文字前景色 |
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

代码中频繁使用的语义色值，统一为 CSS 变量管理（计划中，当前仍为硬编码）：

| Token | 亮色 | 暗色 | 用途 |
|-------|------|------|------|
| `--success` | `#7aad80` | `#7aad80` | 保存成功、同步完成、在线状态 |
| `--error` | `#c85050` | `#c85050` | 操作失败、删除确认、错误提示 |
| `--warning` | `var(--amber)` | `var(--amber)` | 警告提示（复用品牌色） |
| `--info` | `#5a8ab4` | `#8ab4d8` | 信息提示、帮助文本 |

> **迁移状态**：已完成。CSS 变量已定义，Tailwind token 已注册（`text-success` / `text-error` / `bg-success`），全部硬编码已替换（含 `text-green-500` / `bg-green-500` / `accent-amber-500`）。装饰色（`yellow-400` 文件夹图标、`emerald-400` CSV 图标、`blue-500` sync 指示、`purple-500` skill badge、`red-400`/`blue-400` TODO 标签）暂保留 Tailwind 原始色，不纳入语义色管理。

## 字体栈

三层字体分工，通过 CSS class 统一使用，**禁止 inline fontFamily**。

| 层级 | 字体 | CSS class / 选择器 | 用途 |
|------|------|-------------------|------|
| 正文 | Lora (serif) | `.prose` | Markdown 长文阅读 |
| UI / 标题 | IBM Plex Sans | `body`、`.prose h1-h4` | 界面元素、标题 |
| 代码 / Display | IBM Plex Mono | `.font-display`、`code`、`.font-mono` | 代码块、等宽展示、版本号 |

### Font Weight 使用规范

| 字体 | Weight | 用途 |
|------|--------|------|
| Lora | 400, 400i, 700 | Prose 正文、斜体、加粗 |
| IBM Plex Sans | 400, 500, 600 | UI 正文、中等强调、标题 |
| IBM Plex Mono | 400, 600 | 代码正文、display 标题 |

> ⚠️ **不要随意删除 weight 子集**（见 `80-known-pitfalls.md`），Google Fonts 加载时需要显式声明每个 weight。

**规则：** 新组件统一用 Tailwind `font-mono` / `font-sans` 或 CSS class `.font-display`，不直接写 `style={{ fontFamily: ... }}`。

## UI 原则

| 原则 | 具体要求 |
|------|---------|
| Speed First | 无 loading spinner，内容即开即读 |
| Minimal Chrome | 只保留内容与搜索，无多余装饰 |
| Keyboard-driven | ⌘K 搜索、⌘/ AI 对话、⌘E 编辑模式 |
| 长文阅读优化 | prose 行高 1.85，代码块高对比，serif 正文 |

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
- **按钮：** 主按钮 `bg-primary text-primary-foreground`，次按钮 `border border-border` 透明底
- **输入框：** `rounded-md border border-border bg-background`，focus 时 `ring-1 ring-ring`
- **模态框：** 居中，`modal-backdrop` 毛玻璃遮罩 `blur(8px)`，max-width 600px
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

| 层级 | Tailwind | 用途 |
|------|----------|------|
| 10 | `z-10` | 次要浮层（TOC 侧栏、tooltip） |
| 20 | `z-20` | 页面内 sticky（top bar） |
| 30 | `z-30` | 全局导航（sidebar、header） |
| 40 | `z-40` | 遮罩层（mobile overlay） |
| 50 | `z-50` | 最高层（modal、dialog） |

**规则：** 新组件选择最接近的语义层级，不要使用表外的 z-index 值。

## 动效规范

| 动效 | 时长 | 缓动 | 用途 |
|------|------|------|------|
| `fadeSlideUp` | 0.22s | ease | 内容进入（列表项、卡片） |
| `slideUp` | 0.3s | ease-out | 移动端底部 sheet 模态框 |
| `transition-colors` | 0.15s | default | hover/focus 颜色过渡 |
| `transition-all` | default | default | toggle 滑块位移 |

**规则：** 动画时长不超过 0.3s，优先用 CSS transition 而非 keyframe animation。

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
