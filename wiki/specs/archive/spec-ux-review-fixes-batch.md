# Spec: UX Review 修复（Batch 1-4）

## 目标

修复 `review/ux-design-review-2026-03-22.md` 二审确认的 P0-P2 问题：1 个首次体验断裂 + 1 个暗色模式回归 + 72 处 inline style 技术债 + 若干 a11y/交互小修。

## 现状分析

| 问题 | 级别 | 位置 | 当前行为 |
|------|------|------|---------|
| OnboardingView 初始化失败无反馈 | P0 | OnboardingView.tsx catch 块 | `console.error` + `setLoading(null)`，UI 无变化 |
| AskFab 渐变色硬编码 | P1 | AskFab.tsx line 30 | 三个 hex `#b07c2e/#c8873a/#d4943f`，暗色模式不跟随 `--amber` |
| AI 建议轮播无 aria-live | P1 | HomeContent.tsx | `setSuggestionIdx` 每 3.5s 变化，无 `aria-live` |
| 72 处 inline style 绕过 token | P1 | HomeContent(29) + OnboardingView(14) + GuideCard(29) | `style={{ color: 'var(--foreground)' }}` 应为 Tailwind class |
| OnboardingView loading 全禁用 | P2 | OnboardingView.tsx line 83 | `isDisabled = loading !== null` 禁用所有按钮 |
| 时间线装饰点无 aria-hidden | P2 | HomeContent.tsx | 屏幕阅读器念出无意义装饰元素 |

## 数据流 / 状态流

改动纯前端，不涉及 API 或后端。数据流不变。

```
OnboardingView error state:
  handleSelect() → API fail → catch → setError(msg) → render error banner → user clicks "retry" → setError(null) + retry
  handleSelect() → API ok → router.refresh() → 正常流程

AskFab gradient:
  CSS var(--amber) ← globals.css :root/.dark → linear-gradient 动态跟随主题

Inline style → className:
  无数据流变化，纯 presentation 层替换
```

## 方案

### Batch 1: P0-1 OnboardingView error state

- 新增 `const [error, setError] = useState<string | null>(null)`
- catch 块 → `setError(i18n error message)`
- render error banner with `role="alert"`
- 新增 i18n key: `onboarding.initError` / `onboarding.retry`

### Batch 2: P1-1 Inline style → className（仅 3 个文件）

对 HomeContent / OnboardingView / GuideCard 批量替换：

| inline style | Tailwind class |
|---|---|
| `style={{ color: 'var(--foreground)' }}` | `text-foreground` |
| `style={{ color: 'var(--muted-foreground)' }}` | `text-muted-foreground` |
| `style={{ color: 'var(--amber)' }}` | `text-[var(--amber)]` |
| `style={{ background: 'var(--amber)' }}` | `bg-[var(--amber)]` |
| `style={{ background: 'var(--card)' }}` | `bg-card` |
| `style={{ background: 'var(--muted)' }}` | `bg-muted` |
| `style={{ borderColor: 'var(--border)' }}` | `border-border` |
| `style={{ background: 'var(--amber-dim)' }}` | `bg-[var(--amber-dim)]` |

组合 style 拆为多个 class。不可替换的保留（如 SVG 属性、动态计算值）。

### Batch 3: P1 AskFab + aria-live

- AskFab: `linear-gradient(135deg, var(--amber), color-mix(in srgb, var(--amber) 80%, white))`
- HomeContent suggestion span: 加 `aria-live="polite" aria-atomic="true"`

### Batch 4: P2 小修

- OnboardingView: `isDisabled = loading !== null` → `isLoading = loading === tpl.id; isDisabled = loading !== null && !isLoading`（选中的显示 loading，其他 disabled 但不显示 spinner）
  - 二审后修正：实际上全禁用是合理 UX（防止用户在一个模板 loading 时点另一个触发竞态）。改为：只改 spinner 显示逻辑，loading 时仍全禁用，但 spinner 只在被点击的卡片上显示（当前代码 line 82 `isLoading = loading === tpl.id` 已经这样做了，`isDisabled` 用 `loading !== null` 也是对的）。
  - **结论：P2-1 实际上是 false positive，当前行为正确。移除。**
- HomeContent 时间线装饰点：加 `aria-hidden="true"`

## 影响范围

### 修改文件

| 文件 | 改动 |
|------|------|
| `app/components/OnboardingView.tsx` | 新增 error state + error banner + inline style 替换 |
| `app/components/HomeContent.tsx` | inline style 替换 + aria-live + aria-hidden |
| `app/components/GuideCard.tsx` | inline style 替换 |
| `app/components/AskFab.tsx` | 渐变色改为 CSS 变量 |
| `app/lib/i18n-en.ts` | 新增 `onboarding.initError` |
| `app/lib/i18n-zh.ts` | 对应中文 |

### 不受影响

| 模块 | 原因 |
|------|------|
| API 路由 | 纯前端变更 |
| 设计 token (globals.css) | 不改 token 值，只改消费方式 |
| SidebarLayout / Panel / RightAskPanel | 本轮不改 resize handle（P2 后续） |

## 边界 case 与风险

| # | 场景 | 处理 |
|---|------|------|
| 1 | OnboardingView API 返回非 JSON 错误 | catch 已有 `.json().catch(() => ({}))` 兜底，error 显示 `HTTP ${status}` |
| 2 | `color-mix()` 浏览器兼容性 | Chrome 111+, Safari 16.2+, Firefox 113+ 均支持；MindOS 目标用户（开发者）浏览器版本远超此线 |
| 3 | inline style 替换漏改 | 用 `grep -c 'style={{' file` 做前后对比，确认数量下降 |
| 4 | inline style 中包含动态值（如 opacity 计算） | 保留这些 case，不强行替换 |
| 5 | GuideCard amber-subtle fallback `rgba(200,135,30,0.08)` | 这是 inline style 中用 CSS var 带 fallback 的 case，替换为 Tailwind arbitrary value 即可 |

## 验收标准

- [ ] OnboardingView API 失败时显示 error banner（含 role="alert"）
- [ ] AskFab 暗色模式下渐变色跟随 `--amber` 变化
- [ ] HomeContent inline style 数量从 29 → ≤5（保留动态值）
- [ ] OnboardingView inline style 数量从 14 → ≤3
- [ ] GuideCard inline style 数量从 29 → ≤5
- [ ] HomeContent 建议轮播有 `aria-live="polite"`
- [ ] HomeContent 时间线装饰点有 `aria-hidden="true"`
- [ ] `npx tsc --noEmit` 无新增 TS 错误
- [ ] `npx vitest run` 全部通过
- [ ] 中英文切换正常
