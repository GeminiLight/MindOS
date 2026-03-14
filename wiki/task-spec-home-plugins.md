# Task Spec: 首页 Plugins 展示优化

---

## 背景

当前首页 Plugins 区域（`HomeContent.tsx:167-203`）使用 3 列等宽 grid，每个卡片只展示 emoji 图标 + 名称，存在以下问题：

1. **信息密度不足**：每个 renderer 注册时提供了 `description`、`tags`、`author`，但首页完全没展示
2. **入口文件映射重复维护**：`RENDERER_ENTRY`（HomeContent.tsx:18-29）与 `PLUGIN_ENTRY_FILES`（page.tsx:7-18）是两份独立的硬编码列表，新增 renderer 需要同步改三处（registry + HomeContent + page.tsx）
3. **不可用卡片的处理简陋**：入口文件不存在时只做 `opacity-40 pointer-events-none`，没有告诉用户为什么不可用、如何使其可用
4. **没有启用/禁用入口**：`registry.ts` 已有 `setRendererEnabled()` / `isRendererEnabled()` 机制（localStorage 持久化），但首页无法操作

---

## 目标

- 卡片展示更多元数据（description、tags）
- 消除入口文件映射的重复维护
- 不可用 plugin 给出明确提示和创建引导
- 提供 hover 或展开式的 plugin 详情

---

## 方案

### 1. RendererDefinition 扩展 entryPath 字段

在 `RendererDefinition` 上新增可选字段 `entryPath`，注册时直接声明：

```typescript
// registry.ts
export interface RendererDefinition {
  // ...existing fields...
  entryPath?: string;  // 新增：首页入口文件路径
}
```

```typescript
// index.ts — 注册示例
registerRenderer({
  id: 'todo',
  name: 'TODO Board',
  entryPath: 'TODO.md',    // 新增
  // ...rest
});
```

**前置工作：注册缺失的 renderer。** 当前 `index.ts` 只注册了 7 个 renderer，但实际存在 10 个组件文件。以下 3 个有组件但未注册：

| 组件 | 文件 | 建议 id | entryPath |
|------|------|---------|-----------|
| `BacklinksRenderer` | `BacklinksRenderer.tsx` | `backlinks` | `BACKLINKS.md` |
| `WorkflowRenderer` | `WorkflowRenderer.tsx` | `workflow` | `Workflow.md` |
| `DiffRenderer` | `DiffRenderer.tsx` | `diff-viewer` | `Agent-Diff.md` |

需先在 `index.ts` 补齐这 3 个的 `registerRenderer()` 调用（含 name/description/icon/tags/match/entryPath），否则 `getAllRenderers()` 返回的列表不完整，首页仍需 hardcode 这 3 个的入口。

**收益：** 消除 HomeContent 的 `RENDERER_ENTRY` 和 page.tsx 的 `PLUGIN_ENTRY_FILES`。page.tsx 改为：

```typescript
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index';

const entryPaths = getAllRenderers()
  .map(r => r.entryPath)
  .filter((p): p is string => !!p);
const existingFiles = getExistingFiles(entryPaths);
```

**注意：** `page.tsx` 是服务端组件，`import '@/lib/renderers/index'` 会在服务端执行。当前已有此 import（HomeContent.tsx 中），但 page.tsx 中也有同样的 import 需求。由于 `registerRenderer()` 只是往数组 push 对象、renderer 组件只是类型引用不会在服务端渲染，这在服务端是安全的。但需要注意 registry 是模块级 singleton，SSR 时每个请求共享同一个 registry 数组——当前已有此行为，无额外风险。

### 2. 卡片 UI 升级

**Before（当前）：**
```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ✅ TODO Board │ │ 📊 CSV Views  │ │ 🕸️ Wiki Graph │
└──────────────┘ └──────────────┘ └──────────────┘
```

**After：**
```
┌────────────────────────┐ ┌────────────────────────┐
│ ✅ TODO Board           │ │ 📊 CSV Views            │
│ Interactive kanban for  │ │ Table, Gallery, or      │
│ TODO.md/TODO.csv        │ │ Board for any CSV       │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │ │ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ #productivity #tasks    │ │ #csv #table #data       │
└────────────────────────┘ └────────────────────────┘
```

**具体改动（`HomeContent.tsx`）：**

- Grid 从 `grid-cols-2 sm:grid-cols-3` 改为 `grid-cols-1 sm:grid-cols-2`（2 列，更宽的卡片容纳 description）
- 卡片内部从单行 `icon + name` 改为：
  ```
  Row 1:  icon + name（现有）
  Row 2:  description（1-2 行，text-xs text-muted-foreground，line-clamp-2）
  Row 3:  tags（flex-wrap gap-1，每个 tag 为小 pill）
  ```
- Tags 使用 `text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground` 样式

**卡片高度**：不设固定高度，依赖 description 和 tags 自然撑开。Grid 使用 `items-start` 避免强制等高。

### 3. 不可用状态增强

当前：`opacity-40 pointer-events-none`

改为：
- 保持 `opacity-60`（从 0.4 提高，让用户能看清内容）
- 移除 `pointer-events-none`，改为可点击
- 点击后不跳转，而是展示 tooltip/toast：`"Create {entryPath} to activate this plugin"`
- 右上角加一个小的 `+` 图标暗示可创建

**实现方式：** 不可用卡片的 `<Link>` 改为 `<button>`（或 `<div role="button">`），onClick 时用一个临时 state 展示 inline 提示文案，3 秒后消失。

```tsx
const [hintId, setHintId] = useState<string | null>(null);
const hintTimer = useRef<ReturnType<typeof setTimeout>>(null);

function showHint(id: string) {
  if (hintTimer.current) clearTimeout(hintTimer.current);
  setHintId(id);
  hintTimer.current = setTimeout(() => setHintId(null), 3000);
}

useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

// 不可用卡片
<button
  onClick={() => showHint(r.id)}
  className="group flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border transition-all opacity-60 cursor-pointer hover:opacity-80 text-left"
  style={{ borderColor: 'var(--border)' }}
>
  <div className="flex items-center gap-2.5">
    <span className="text-base">{r.icon}</span>
    <span className="text-xs font-semibold font-display" style={{ color: 'var(--foreground)' }}>{r.name}</span>
  </div>
  {hintId === r.id && (
    <p className="text-[10px] animate-in" style={{ color: 'var(--amber)' }} role="status">
      Create {r.entryPath} to activate
    </p>
  )}
</button>
```

**注意：** 使用 `useRef` 持有 timer 引用，组件卸载时清理，避免 setState on unmounted。提示文案需 i18n 化（`t.home.createToActivate`），模板变量用插值。

### 4. 启用/禁用入口（可选，低优先级）

在 Settings → Plugins 中已有入口（如果没有则不做）。首页卡片不加 toggle，保持简洁。如果未来需要，可以在卡片右键菜单或长按中加"Disable"选项。

**本次不实施**，仅预留 `isRendererEnabled()` 的调用路径。

---

## 受影响文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `app/lib/renderers/registry.ts` | 修改 | `RendererDefinition` 新增 `entryPath?: string` |
| `app/lib/renderers/index.ts` | 修改 | 补齐 3 个未注册 renderer + 全部 10 个调用新增 `entryPath` 字段 |
| `app/app/page.tsx` | 修改 | 移除硬编码 `PLUGIN_ENTRY_FILES`，从 registry 动态获取 |
| `app/components/HomeContent.tsx` | 修改 | 移除 `RENDERER_ENTRY`；卡片 UI 升级（description + tags + 不可用提示） |

---

## 注意事项

1. **description i18n**：当前 renderer description 全部英文硬编码在 `index.ts`。本次 **不做** description 的 i18n 化——工作量较大（10 个 renderer × 2 语言），且 description 是面向开发者的技术说明，英文可接受。未来如需多语言，可在 `RendererDefinition` 上加 `descriptionKey` 映射到 i18n。
2. **提示文案 i18n**：不可用状态的 "Create {file} to activate" 需加入 `t.home.createToActivate`（en + zh），支持 `{file}` 插值。
3. **服务端 registry import**：`page.tsx`（服务端组件）import `@/lib/renderers/index` 是安全的——registry 只 push 对象引用，不触发客户端 API。已有先例（HomeContent 通过 `'@/lib/renderers/index'` side-effect import）。
4. **graph renderer 的 entryPath**：`graph` 的 match 是 `extension === 'md'`（匹配所有 md 文件），但 entryPath 设为 `README.md` 只是首页快捷入口，不影响 match 逻辑。

---

## 不做的事

- **不做** Plugin 详情弹窗/抽屉 — 首页保持快速导航定位，详情留给 Settings
- **不做** Plugin 安装/卸载 — 当前全部 builtin，等用户插件系统再做
- **不做** 首页卡片启用/禁用 toggle — 操作入口统一放 Settings
- **不做** 卡片拖拽排序 — 过度设计

---

## 工作量

**~0.5 天**

| 子项 | 估时 |
|------|------|
| entryPath 字段 + 消除重复映射 | 0.5h |
| 卡片 UI（description + tags + 2 列 grid） | 1.5h |
| 不可用状态增强（提示文案 + 动画） | 1h |
| 验证 + 响应式适配 | 0.5h |

---

## 验证

1. 首页 Plugins 区域展示 name + description + tags
2. 有入口文件的 plugin 点击正常跳转
3. 无入口文件的 plugin 点击展示创建提示（不跳转）
4. 新增 renderer 只需在 `index.ts` 注册时声明 `entryPath`，无需改 page.tsx 或 HomeContent
5. 移动端 1 列显示，pad/桌面 2 列
6. TypeScript 编译无错误
