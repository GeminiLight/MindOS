# Spec: Echo 内容页视觉与交互精修

## 目标
在 P0 路由与信息架构已落地的基础上，把 `/echo/*` 主内容区与 Echo 侧栏从「可用占位」提升为 **温暖、克制、可扫读** 的反思工作面：层次清晰、品牌琥珀点缀有度、空态不压抑、表单与折叠区符合设计系统。

## 现状分析
- 当前页为窄栏 `max-w-2xl`、扁平 `muted` 块堆叠，主标题与面包屑缺乏 **视觉锚点**，与首页 `HomeContent` 的层次（字重、琥珀提示、卡片节奏）不一致。
- `EchoPanel` 选中态仅 `bg-accent/50`，与 Activity Bar 的 **左侧琥珀指示条** 语言不统一。
- `h1` 使用 `font-display`（IBM Plex Mono）与产品「内向书写」气质略冲突；应与首页主标题一致（`font-display` 为现有全站首页惯例，本阶段 **对齐首页** 而非改全站字体策略）。

## 数据流 / 状态流

```
用户进入 /echo/[segment]
  → EchoSegmentPageClient（client）
  → 读 useLocale().echoPages / panels.echo（文案）
  → 读 localStorage（daily / growth，行为不变）
  → 仅 className / 结构变更；无新服务端数据、无新 API

EchoPanel
  → pathname 匹配 → PanelNavRow active=true
  → 可选左侧琥珀条（纯展示，无新 state）
```

## 方案
- **主内容区**：`max-w-3xl`；顶部 **hero 卡片**（`rounded-xl` + `border` + `bg-card` + 轻阴影）；**左侧琥珀竖线**（`::before` 或 absolute span，`var(--amber)`）；**kicker** 一行小写宽间距「ECHO / 回响」来自 i18n `echoPages.heroKicker`；面包屑用 `ChevronRight` 替代裸 `/`，链接 hover 琥珀语义色。
- **事实层 / 子卡**：`EchoFactSnapshot` 使用 `rounded-xl`、`bg-card`、可选图标容器（`bg-[var(--amber-dim)]` + lucide）；`continued` 双列使用 `border-dashed` 空态暗示「待填充」。
- **表单区**（daily / growth）：与事实层 **同级卡片** 节奏；label 采用小号大写 tracking（与设置卡一致）；主按钮 `rounded-lg`，次按钮 `border` + hover `amber-dim`。
- **见解折叠**：卡片化 `rounded-xl`；头部区与内容区分隔更清晰；动效 **≤200ms**（仅 chevron / hover 色）。
- **EchoPanel**：`PanelNavRow` 在 `active && href` 时增加 **左侧 2px 圆角琥珀条**（与 ActivityBar 一致），hint 行垂直节奏微调。
- **主区 segment 条**：hero 下 **pill 横向导航**（`EchoSegmentNav`），与 `ECHO_SEGMENT_HREF` 单源同步侧栏链接；面包屑仅父级，**不与 h1 重复当前小节名**。
- **设计系统**：色与环全部 `var(--amber)` / `ring-ring`；禁止新 hex；focus 一律 `focus-visible:`。

## 影响范围
- 变更：`app/components/echo/*`、`app/components/panels/EchoPanel.tsx`、`app/components/panels/PanelNavRow.tsx`、`app/lib/i18n-en.ts`、`app/lib/i18n-zh.ts`、`app/__tests__/lib/*`（i18n 键）
- 不受影响：路由、`echo-segments`、SidebarLayout 逻辑、AskModal API
- 无破坏性 API 变更

## 边界 case 与风险
1. **窄屏**：hero 与卡片 `px` 使用 `sm:px-6`；双列 `continued` 保持 `grid-cols-1 sm:grid-cols-2`。
2. **暗色**：琥珀与 `card`/`muted` 对比依赖现有 CSS 变量；需在 Playwright 或手动扫一眼 dark（若脚本仅亮色，文档注明）。
3. **仅键盘用户**：折叠按钮保留 `aria-expanded` / `aria-controls`；新增装饰条 `aria-hidden`。
4. **风险**：过度装饰 → 违背「克制」；缓解：琥珀仅用于 kicker、竖线、链接 hover、选中条，**不大面积铺色**。

## 自我 review（≥2 轮）

**轮 1 — 完整性**：覆盖五 segment 共用 hero、continued 双列、daily/growth 表单、past-you 禁用 CTA、见解折叠；侧栏与 Rail 指示条对齐；窄屏与暗色依赖现有 token，无新 hex。

**轮 2 — 可行性**：无新 API；`PanelNavRow` 仅在 `href && active` 时画条，Discover/Agents 未传 `active` 行为不变；动效 ≤200ms。

---

## 验收标准
- [x] 主内容区具备 hero 区（kicker + 面包屑 + h1 + lead），视觉层次明显优于改版前。
- [x] `continued` 双列空态为 dashed 边框风格；事实层为实心卡片。
- [x] Echo 侧栏当前 segment 有左侧琥珀指示条（与 Rail 语言一致）。
- [x] i18n：`echoPages.heroKicker` / `snapshotBadge` en/zh 一致存在；`npm test` 全绿。
- [x] Playwright 截图：`/tmp/echo-about-you-polish.png`、`/tmp/echo-daily-polish.png`。
- [x] 无新增硬编码 hex；focus 为 `focus-visible:ring-ring`。
