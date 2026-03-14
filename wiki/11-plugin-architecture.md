<!-- Last verified: 2026-03-14 | Current stage: ALL COMPLETE (v0.4.0) -->

# 插件架构设计 (Plugin Architecture)

> 目标：新增插件 = 新建目录 + 写 manifest，**零侵入已有文件**。
> **状态：全部 4 个 Phase 已完成，随 v0.4.0 发布。**

## 当前架构（已实现）

### 目录结构

```
app/components/renderers/
├── todo/
│   ├── manifest.ts          ← 元数据 + match + lazy load
│   └── TodoRenderer.tsx
├── csv/
│   ├── manifest.ts
│   ├── CsvRenderer.tsx
│   ├── TableView.tsx / GalleryView.tsx / BoardView.tsx / ConfigPanel.tsx
│   └── types.ts
├── graph/          ├── timeline/       ├── summary/
├── config/         ├── agent-inspector/ ├── backlinks/
├── workflow/       └── diff/
```

### manifest.ts 规范

```ts
// app/components/renderers/todo/manifest.ts
import type { RendererDefinition } from '@/lib/renderers/registry';

export const manifest: RendererDefinition = {
  id: 'todo',
  name: 'TODO Board',
  description: 'Renders TODO.md/TODO.csv as interactive kanban board',
  author: 'MindOS',
  icon: '✅',
  tags: ['productivity', 'tasks', 'markdown'],
  builtin: true,
  entryPath: 'TODO.md',
  match: ({ filePath }) => /\bTODO\b.*\.(md|csv)$/i.test(filePath),
  load: () => import('./TodoRenderer').then(m => ({ default: m.TodoRenderer })),
};
```

### Auto-discovery (codegen)

```bash
node scripts/gen-renderer-index.js
```

扫描 `app/components/renderers/*/manifest.ts`，自动生成 `app/lib/renderers/index.ts`（~23 行）。

钩子位置：
- `bin/cli.js` — `start` 和 `build` 命令在 `next build` 前调用
- `app/package.json` — `prebuild` 脚本

### Lazy Loading

- manifest 使用 `load: () => import(...)` 替代 `component`
- `ViewPageClient.tsx` 使用 `React.lazy()` + `<Suspense>` 渲染
- 组件只在命中时加载，不进入初始 bundle

### 消费方（无需修改）

| 文件 | 调用 | 用途 |
|------|------|------|
| `ViewPageClient.tsx` | `resolveRenderer()` + `React.lazy` | 文件视图渲染 |
| `HomeContent.tsx` | `getAllRenderers()` | 首页插件展示 |
| `page.tsx` | `getAllRenderers()` | 服务端 entryPath 检测 |
| `PluginsTab.tsx` | `getAllRenderers()` + `setRendererEnabled()` | 设置面板开关 |
| `SettingsModal.tsx` | `loadDisabledState()` | 初始化禁用状态 |

---

## 新增 Renderer 步骤

1. 创建目录 `app/components/renderers/{name}/`
2. 写组件 `{Name}Renderer.tsx`（export named function）
3. 写 `manifest.ts`（参照上方规范）
4. 运行 `node scripts/gen-renderer-index.js`（build 时自动运行）

**改动文件数：0 个已有文件。**

---

## 迁移历史

| Phase | 内容 | 状态 |
|-------|------|------|
| P1 | 目录拆分：10 个 renderer 移入子目录 | ✅ v0.4.0 |
| P2 | 添加 manifest.ts：元数据从 index.ts 搬入各子目录 | ✅ v0.4.0 |
| P3 | Auto-discovery：codegen 脚本扫描 manifest 生成 index.ts | ✅ v0.4.0 |
| P4 | Lazy Loading：`component` → `load`，React.lazy + Suspense | ✅ v0.4.0 |

---

## 约束与边界

### 插件只能访问的 API

```ts
interface RendererContext {
  filePath: string;                              // 当前文件路径
  content: string;                               // 文件内容
  extension: string;                             // 文件扩展名
  saveAction: (content: string) => Promise<void>; // 写回文件
}
```

插件**不应该**直接 import：
- `@/lib/fs.ts`（通过 saveAction 间接写入）
- `@/lib/settings.ts`（如需配置，未来通过 context 注入）
- 内部 store / 全局状态

### 命名约定

| 对象 | 规范 | 示例 |
|------|------|------|
| 子目录名 | kebab-case | `agent-inspector/` |
| manifest 文件 | `manifest.ts` | — |
| 组件文件 | PascalCase | `TodoRenderer.tsx` |
| manifest.id | kebab-case | `'agent-inspector'` |

---

## 判断标准

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 新增插件改动文件数 | 2（组件 + index.ts） | 1（新建目录） |
| index.ts 行数 | 142 行 | ~10 行 |
| 删除插件改动文件数 | 2 | 1（删除目录） |
| 组件加载 | 全量打包 | 按需 lazy load |
| 插件与宿主耦合 | 可 import 任意内部模块 | 仅通过 RendererContext |
