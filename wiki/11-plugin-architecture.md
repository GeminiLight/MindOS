<!-- Last verified: 2026-03-14 | Current stage: P4 (complete) -->

# 插件架构设计 (Plugin Architecture)

> 目标：新增插件 = 新建目录 + 写 manifest，**零侵入已有文件**。

## 现状分析

### 当前注册方式

```
app/lib/renderers/index.ts    ← 手动 import 10 个组件 + 10 次 registerRenderer()
```

每新增一个 renderer 必须：
1. 在 `index.ts` 顶部加 `import`
2. 在 `index.ts` 底部加 `registerRenderer({...})`
3. 新建组件文件

**侵入点**：`index.ts` 是所有插件的集中注册处，每次改动都涉及已有文件。

### 当前消费方（不需要改）

| 文件 | 调用 | 用途 |
|------|------|------|
| `ViewPageClient.tsx` | `resolveRenderer()` | 文件视图渲染 |
| `HomeContent.tsx` | `getAllRenderers()` | 首页插件展示 |
| `page.tsx` | `getAllRenderers()` | 服务端 entryPath 检测 |
| `PluginsTab.tsx` | `getAllRenderers()` + `setRendererEnabled()` | 设置面板开关 |
| `SettingsModal.tsx` | `loadDisabledState()` | 初始化禁用状态 |

这些消费方只依赖 `registry.ts` 的 API，不直接 import 具体 renderer —— 改注册方式不影响它们。

---

## 方案：Manifest 自注册 + Auto-discovery

### 目录约定

```
app/components/renderers/
├── todo/
│   ├── manifest.ts          ← 自描述元数据 + match 规则
│   ├── TodoRenderer.tsx     ← 组件实现
│   └── index.ts             ← re-export（可选）
├── csv/
│   ├── manifest.ts
│   ├── CsvRenderer.tsx
│   ├── TableView.tsx
│   ├── GalleryView.tsx
│   ├── BoardView.tsx
│   ├── EditableCell.tsx
│   └── ConfigPanel.tsx
├── graph/
│   ├── manifest.ts
│   └── GraphRenderer.tsx
├── timeline/
│   ├── manifest.ts
│   └── TimelineRenderer.tsx
├── ... (每个 renderer 一个子目录)
```

### manifest.ts 规范

```ts
// app/components/renderers/todo/manifest.ts
import type { RendererManifest } from '@/lib/renderers/types';

export const manifest: RendererManifest = {
  id: 'todo',
  name: 'TODO Board',
  description: 'Renders TODO.md/TODO.csv as interactive kanban board',
  author: 'MindOS',
  icon: '✅',
  tags: ['productivity', 'tasks', 'markdown'],
  builtin: true,
  entryPath: 'TODO.md',
  match: ({ filePath }) => /\bTODO\b.*\.(md|csv)$/i.test(filePath),
  // lazy load — 组件只在命中时加载，不进入初始 bundle
  load: () => import('./TodoRenderer').then(m => m.TodoRenderer),
};
```

### 类型定义

```ts
// app/lib/renderers/types.ts（从 registry.ts 分离）

import type { ComponentType } from 'react';

export interface RendererContext {
  filePath: string;
  content: string;
  extension: string;
  saveAction: (content: string) => Promise<void>;
}

export interface RendererManifest {
  id: string;
  name: string;
  description: string;
  author: string;
  icon: string;
  tags: string[];
  builtin: boolean;
  entryPath?: string;
  match: (ctx: Pick<RendererContext, 'filePath' | 'extension'>) => boolean;
  // 二选一：静态组件 or 懒加载
  component?: ComponentType<RendererContext>;
  load?: () => Promise<ComponentType<RendererContext>>;
}
```

### 自动扫描注册

```ts
// app/lib/renderers/index.ts（从 142 行 → ~10 行）

import { registerRenderer } from './registry';

// Webpack/Next.js import.meta.glob 等效：require.context 或 dynamic import
// Next.js App Router 推荐方式：
const modules = require.context(
  '../../components/renderers',
  true,                          // recursive
  /\/manifest\.ts$/              // 只匹配 manifest.ts
);

for (const key of modules.keys()) {
  const { manifest } = modules(key);
  registerRenderer(manifest);
}
```

> **Next.js 兼容说明**：`import.meta.glob` 是 Vite 特性，Next.js (webpack) 用 `require.context` 或在 build 时生成静态 import 列表。具体方案需根据 Next.js 16 的 bundler（Turbopack/webpack）选择。

### registry.ts 适配

```ts
// resolveRenderer 增加 lazy load 支持
export async function loadComponent(def: RendererManifest): Promise<ComponentType<RendererContext>> {
  if (def.component) return def.component;
  if (def.load) {
    const comp = await def.load();
    def.component = comp; // 缓存，只加载一次
    return comp;
  }
  throw new Error(`Renderer "${def.id}" has no component or load function`);
}
```

---

## 迁移计划

### Phase 1：目录拆分（纯文件移动，不改逻辑）

将单文件 renderer 移入各自子目录：

| 现在 | 移到 |
|------|------|
| `renderers/TodoRenderer.tsx` | `renderers/todo/TodoRenderer.tsx` |
| `renderers/GraphRenderer.tsx` | `renderers/graph/GraphRenderer.tsx` |
| `renderers/TimelineRenderer.tsx` | `renderers/timeline/TimelineRenderer.tsx` |
| `renderers/SummaryRenderer.tsx` | `renderers/summary/SummaryRenderer.tsx` |
| `renderers/ConfigRenderer.tsx` | `renderers/config/ConfigRenderer.tsx` |
| `renderers/AgentInspectorRenderer.tsx` | `renderers/agent-inspector/AgentInspectorRenderer.tsx` |
| `renderers/BacklinksRenderer.tsx` | `renderers/backlinks/BacklinksRenderer.tsx` |
| `renderers/WorkflowRenderer.tsx` | `renderers/workflow/WorkflowRenderer.tsx` |
| `renderers/DiffRenderer.tsx` | `renderers/diff/DiffRenderer.tsx` |
| `renderers/csv/` | `renderers/csv/`（已是子目录，不动） |

`index.ts` 更新 import 路径，功能不变。

### Phase 2：添加 manifest.ts

每个子目录添加 `manifest.ts`，将 `registerRenderer({...})` 的内容搬过去。

### Phase 3：Auto-discovery

`index.ts` 替换为自动扫描，删除所有手动 import + register。

### Phase 4（可选）：Lazy Loading

`manifest.ts` 中 `component` 改为 `load`，组件按需加载。

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
