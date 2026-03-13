<!-- Last verified: 2026-03-14 | Current stage: P1 -->

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

| Token | 值 | 语义用途 |
|-------|-----|---------|
| `--amber` / `--primary` | `#F59E0B` | 品牌主色，交互高亮 |
| `--bg-light` | `#FFFBEB` | 亮色模式背景 |
| `--bg-dark` | `#1C1917` | 暗色模式背景 |
| `--text-primary` | `#292524` / `#F5F5F4` | 正文 |
| `--text-secondary` | `#78716C` / `#A8A29E` | 辅助文字 |

## UI 原则

| 原则 | 具体要求 |
|------|---------|
| Speed First | 无 loading spinner，内容即开即读 |
| Minimal Chrome | 只保留内容与搜索，无多余装饰 |
| Keyboard-driven | ⌘K 搜索、⌘/ AI 对话、⌘E 编辑模式 |
| 长文阅读优化 | 行高 1.7+，段间距适中，代码块高对比 |

## 组件模式

- **卡片：** 圆角 8px，微阴影，hover 时 amber 边框
- **按钮：** 主按钮 amber 填充，次按钮透明 + amber 边框
- **输入框：** 底部边框 1px，聚焦时 amber 色
- **模态框：** 居中，毛玻璃遮罩，max-width 600px
