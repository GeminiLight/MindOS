# Spec: Obsidian API Shim 设计

> **状态**：📋 Spec 完成
> **日期**：2026-04-10
> **关联文档**：
> - `wiki/specs/spec-obsidian-plugin-compat.md`
> - `wiki/specs/spec-obsidian-spike-plan.md`
> - `wiki/specs/spec-obsidian-compatibility-matrix.md`

---

## 1. 文档目标

本文只回答一个问题：

> **如果我们要让 Obsidian 社区插件在 MindOS 内运行，`require('obsidian')` 这个模块应该长什么样，背后如何映射到 MindOS 现有能力。**

这里的 “Shim” 不是完整复刻 Obsidian，而是：

1. 暴露 Obsidian 插件最常使用的一组 API 形状
2. 把这些 API 的行为尽量映射到 MindOS 现有能力
3. 对暂不支持的 API 明确给出 stub / no-op / 报错策略
4. 让插件在“可运行”和“可诊断”之间取得平衡

---

## 2. 设计原则

### 2.1 原则一：优先兼容高频 API，而不是追求表面完整

Obsidian API 表面很大，但头部插件真正高频使用的 API 很集中：

- `Plugin` 生命周期
- `loadData/saveData`
- `Vault` 文件操作
- `addCommand`
- `PluginSettingTab`
- `Notice` / `Modal`
- `MetadataCache`
- 少量 `Workspace` 能力

所以 Shim 应优先覆盖这组能力。

### 2.2 原则二：优先行为兼容，而不是类型兼容

对社区插件来说，更重要的是：

- `app.vault.read(file)` 能不能读到内容
- `this.addCommand()` 能不能注册命令
- `this.loadData()` 能不能读到 `data.json`

而不是 TypeScript 类型是否 100% 对齐。

因此第一阶段重点是：

> **方法能调用，结果足够合理，错误足够明确。**

### 2.3 原则三：Shim 应尽量薄，真实能力放在宿主层

Shim 不是新的业务内核。它只负责适配。真正的数据与行为应该落在 MindOS 原有能力上：

- 文件读写 → `app/lib/core/fs-ops.ts:10`
- 搜索索引 → `app/lib/core/search-index.ts:107`
- 链接索引 → `app/lib/core/link-index.ts:29`
- Renderer 注册 → `app/lib/renderers/registry.ts:67`

### 2.4 原则四：每个 API 都必须定义“不支持时怎么办”

每个 Shim API 都必须落入以下四类之一：

1. **完整支持**
2. **部分支持**
3. **可运行 stub**
4. **明确抛错**

不能存在模糊状态。

---

## 3. 目标 API 版本

建议锁定一个 Obsidian API 目标版本，例如：

- **Target API**：`1.7.2`

原因：

1. 社区插件大量基于近年的 API surface 编译
2. 调研样本中 `removeCommand()`、`onUserEnable()` 等都已进入较新版本
3. 不锁定目标版本，会导致 shim 长期处于漂移状态

策略：

- 在文档中明确：**MindOS Obsidian Shim 目标兼容 API 1.7.2 的常用子集**
- 对超过目标版本的 API：默认不支持，按需补

---

## 4. 总体结构

### 4.1 模块边界

建议新增：

```
app/lib/obsidian-compat/
├── loader.ts
├── plugin-manager.ts
├── runtime.ts
├── events.ts
├── manifest.ts
├── files.ts
├── metadata.ts
├── commands.ts
├── ui.ts
├── styles.ts
├── workspace.ts
├── errors.ts
├── types.ts
└── shims/
    ├── obsidian.ts
    ├── component.ts
    ├── plugin.ts
    ├── app.ts
    ├── vault.ts
    ├── metadata-cache.ts
    ├── workspace.ts
    ├── ui.ts
    └── command.ts
```

### 4.2 运行时关系

```
plugin main.js
  → require('obsidian')
    → obsidian shim module
      → plugin runtime context
        → MindOS adapters
          → fs-ops / search-index / link-index / renderer registry / settings host
```

### 4.3 核心对象图

```
PluginInstance
  ├── app: AppShim
  ├── manifest: PluginManifest
  ├── runtime: PluginRuntime
  └── inherited from ComponentShim

AppShim
  ├── vault: VaultShim
  ├── metadataCache: MetadataCacheShim
  ├── workspace: WorkspaceShim
  ├── commands: CommandRegistryAdapter
  └── settings/ui hooks
```

---

## 5. 模块加载与注入

### 5.1 目标

Obsidian 社区插件编译后通常使用 CommonJS，依赖：

```js
const obsidian = require('obsidian');
```

所以我们必须在加载 `main.js` 时把 `obsidian` 模块替换为自己的 shim。

### 5.2 建议加载方式

```ts
function executePluginModule(code: string, obsidianShim: any) {
  const module = { exports: {} as any };
  const exports = module.exports;

  const require = (id: string) => {
    if (id === 'obsidian') return obsidianShim;
    throw new Error(`[obsidian-compat] Unsupported module: ${id}`);
  };

  const fn = new Function('module', 'exports', 'require', code);
  fn(module, exports, require);
  return module.exports.default ?? module.exports;
}
```

### 5.3 错误策略

如果插件 `require()` 了以下模块：

- `fs`
- `path`
- `child_process`
- `electron`
- 其他 Node/Electron 模块

默认判定为：

> **当前宿主不支持该插件运行环境。**

并在插件管理界面展示：

- 缺失模块名
- manifest 信息
- 是否 `isDesktopOnly`
- 建议动作（禁用 / 不支持）

---

## 6. Shim 导出面

建议 `obsidian.ts` 至少导出以下对象：

### 6.1 第一阶段导出

- `Plugin`
- `Component`
- `Events`
- `Notice`
- `Modal`
- `PluginSettingTab`
- `Setting`
- `App`
- `Vault`
- `MetadataCache`
- `Workspace`
- `TFile`
- `TFolder`
- `TAbstractFile`

### 6.2 第二阶段导出

- `ItemView`
- `MarkdownView`
- `WorkspaceLeaf`
- `FuzzySuggestModal`
- `Menu`
- `MenuItem`
- `Editor`
- `MarkdownRenderChild`

### 6.3 导出策略

对于未支持但插件常常 import 的类：

- 可以先导出一个最小类壳，避免 `undefined is not a constructor`
- 但其关键方法必须在运行时明确报“不支持”

---

## 7. Component / Events Shim

### 7.1 Component

Obsidian 的 `Component` 是生命周期与资源清理基类。它的重要意义不是 UI，而是：

- 子组件管理
- 自动清理事件
- 自动清理定时器
- 注册 unload callback

### 7.2 建议接口

```ts
class ComponentShim {
  private _children = new Set<ComponentShim>();
  private _unloadCallbacks = new Set<() => void>();

  load(): void
  unload(): void
  onload(): void
  onunload(): void
  addChild(child: ComponentShim): void
  removeChild(child: ComponentShim): void
  register(cb: () => void): void
  registerEvent(ref: EventRefLike): void
  registerDomEvent(el: EventTarget, type: string, cb: EventListener): void
  registerInterval(id: number): number
}
```

### 7.3 对 MindOS 的要求

这部分几乎不依赖 MindOS 现有代码，可以完全在 shim runtime 内部实现。

### 7.4 Events

建议新增一个最小事件总线：

```ts
type EventRefLike = { off: () => void };

class EventsShim {
  on(name: string, cb: (...args: any[]) => any): EventRefLike
  off(name: string, cb: (...args: any[]) => any): void
  offref(ref: EventRefLike): void
  trigger(name: string, ...args: any[]): void
}
```

### 7.5 适用对象

`EventsShim` 将作为这些对象的基类或组合成员：

- `VaultShim`
- `MetadataCacheShim`
- `WorkspaceShim`
- `PluginShim`

---

## 8. Plugin Shim

### 8.1 目标职责

`Plugin` shim 需要承接三类事情：

1. 生命周期
2. 插件私有数据
3. 插件向宿主注册能力

### 8.2 建议接口

```ts
class PluginShim extends ComponentShim {
  app: AppShim
  manifest: PluginManifestLike
  runtime: PluginRuntime

  async onload(): Promise<void> | void
  onunload(): void

  async loadData(): Promise<any>
  async saveData(data: any): Promise<void>

  addCommand(command: CommandLike): CommandLike
  removeCommand(commandId: string): void
  addSettingTab(tab: PluginSettingTabShim): void
  addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => any): HTMLElementLike
  addStatusBarItem(): HTMLElementLike

  registerView(type: string, creator: ViewCreatorLike): void
  registerExtensions(exts: string[], viewType: string): void
  registerMarkdownPostProcessor(...args: any[]): any
  registerMarkdownCodeBlockProcessor(...args: any[]): any
  registerEditorExtension(...args: any[]): void
}
```

### 8.3 `loadData/saveData` 映射

存储路径：

```
${mindRoot}/.plugins/<plugin-id>/data.json
```

建议行为：

- `loadData()`：文件不存在时返回 `null`
- `saveData(data)`：JSON 原子写入
- 由 runtime 自动确保目录存在

### 8.4 `addCommand` 映射

映射到宿主命令注册中心：

- command id 最终存储为：`obsidian:<pluginId>:<commandId>`
- 在命令面板 UI 中显示：`<plugin name>: <command name>`
- 卸载插件时批量清理该插件所有命令

### 8.5 `addSettingTab` 映射

映射到 MindOS 设置页中的“社区插件”分区。

策略：

- 宿主提供一个设置页容器
- 调用插件的 `display()` 渲染其内容
- 允许基础 Setting 组件渲染为 MindOS 表单组件

### 8.6 `addRibbonIcon` 映射

优先级从低到高：

1. **Phase 1**：退化为一个命令面板入口
2. **Phase 1.5**：渲染到 Activity Bar
3. **Phase 2**：支持左右侧栏插槽

### 8.7 `addStatusBarItem` 映射

Web 环境里可映射为底部状态栏区域；如果没有稳定宿主位置，可先返回一个可操作 DOM stub，但不真正挂载。

结论：

- 第一阶段：**部分支持**
- 必须保证插件不会因为调用它而崩

---

## 9. App Shim

### 9.1 目标

`App` shim 是插件访问宿主能力的总入口。

### 9.2 建议接口

```ts
class AppShim {
  vault: VaultShim
  metadataCache: MetadataCacheShim
  workspace: WorkspaceShim
  keymap: KeymapShim
  scope: ScopeShim

  isDarkMode(): boolean
  loadLocalStorage(key: string): any
  saveLocalStorage(key: string, data: any): void
}
```

### 9.3 `isDarkMode()` 映射

从 MindOS 现有主题状态获取。

### 9.4 `loadLocalStorage/saveLocalStorage` 映射

建议 key 前缀加插件命名空间：

- `obsidian-plugin:<pluginId>:<key>`

避免污染其他本地存储项。

### 9.5 不建议早期暴露的字段

- `app.plugins`
- `app.internalPlugins`
- 深层私有内部对象

这些很容易把 shim 拉进深层耦合。第一阶段可仅暴露只读、极小的插件注册信息。

---

## 10. 文件对象模型：TAbstractFile / TFile / TFolder

### 10.1 目标

大量插件不是直接用 path string，而是依赖 Obsidian 文件对象：

- `file.path`
- `file.name`
- `file.basename`
- `file.extension`
- `file.parent`
- `file.stat`

因此需要提供最小文件对象模型。

### 10.2 建议结构

```ts
class TAbstractFileShim {
  path: string
  name: string
  parent: TFolderShim | null
  vault: VaultShim
}

class TFileShim extends TAbstractFileShim {
  basename: string
  extension: string
  stat: {
    ctime: number
    mtime: number
    size: number
  }
}

class TFolderShim extends TAbstractFileShim {
  children: TAbstractFileShim[]
  isRoot(): boolean
}
```

### 10.3 数据来源

- 文件 stat：来自 `fs.statSync`
- 路径与目录关系：基于 mindRoot 下的相对路径计算
- 树结构可以复用 `FileNode` 风格数据 `app/lib/core/types.ts:147`

### 10.4 构建策略

为降低复杂度：

- 第一阶段不做全局常驻对象图
- 每次查询按需构建轻量对象
- 仅在必要场景缓存

---

## 11. Vault Shim

### 11.1 目标

这是第一阶段最关键的 shim 之一。绝大多数插件都依赖 `Vault`。

### 11.2 可直接映射的能力

MindOS 已具备大多数文件操作基础：

- `readFile()` `app/lib/core/fs-ops.ts:10`
- `writeFile()` `app/lib/core/fs-ops.ts:19`
- `createFile()` `app/lib/core/fs-ops.ts:39`
- `deleteFile()` `app/lib/core/fs-ops.ts:56`
- `renameFile()` `app/lib/core/fs-ops.ts:111`
- `moveFile()` `app/lib/core/fs-ops.ts:169`

### 11.3 建议支持接口

```ts
class VaultShim extends EventsShim {
  getAbstractFileByPath(path: string): TAbstractFileShim | null
  getFileByPath(path: string): TFileShim | null
  getFolderByPath(path: string): TFolderShim | null
  getMarkdownFiles(): TFileShim[]
  getFiles(): TFileShim[]
  getAllLoadedFiles(): TAbstractFileShim[]

  async read(file: TFileShim): Promise<string>
  async cachedRead(file: TFileShim): Promise<string>
  async create(path: string, data: string): Promise<TFileShim>
  async modify(file: TFileShim, data: string): Promise<void>
  async append(file: TFileShim, data: string): Promise<void>
  async delete(file: TAbstractFileShim): Promise<void>
  async rename(file: TAbstractFileShim, newPath: string): Promise<void>
  async copy(file: TFileShim, newPath: string): Promise<TFileShim>
}
```

### 11.4 行为映射

| Obsidian Vault API | MindOS 映射 | 备注 |
|---|---|---|
| `read(file)` | `readFile()` | 直接映射 |
| `cachedRead(file)` | 先直接调用 `readFile()` | 后续可加缓存 |
| `create(path, data)` | `createFile()` | 创建后触发 `create` 事件 |
| `modify(file, data)` | `writeFile()` | 修改后触发 `modify` 事件 |
| `append(file, data)` | 读后拼接写回 | 第一阶段可接受 |
| `delete(file)` | `deleteFile()` 或目录删除 | 触发 `delete` 事件 |
| `rename(file, newPath)` | 文件/目录 rename adapter | 触发 `rename` 事件 |
| `copy(file, newPath)` | read + create | 第一阶段可接受 |

### 11.5 关键缺口：事件

Vault 在 Obsidian 里不仅是文件 API，也是文件事件源。

需要在所有写路径补充：

- `trigger('create', file)`
- `trigger('modify', file)`
- `trigger('delete', file)`
- `trigger('rename', file, oldPath)`

同时驱动：

- SearchIndex 增量更新 `app/lib/core/search-index.ts:182`
- LinkIndex 增量更新 `app/lib/core/link-index.ts:136`
- MetadataCache 重算

### 11.6 `process(file, fn)` 是否首阶段支持

建议：

- 第一阶段可以不实现或用简单 read-modify-write 实现
- 但要明确它不是强原子 compare-and-swap

---

## 12. MetadataCache Shim

### 12.1 目标

`MetadataCache` 是第二个关键 shim。很多高价值插件依赖它，而 MindOS 恰好已经有搜索索引和链接索引。

### 12.2 可复用基础

- 搜索索引 `SearchIndex.rebuild()` `app/lib/core/search-index.ts:107`
- 链接索引 `LinkIndex.rebuild()` `app/lib/core/link-index.ts:29`
- backlinks `getBacklinks()` `app/lib/core/link-index.ts:87`

### 12.3 第一阶段建议支持的字段

```ts
interface CachedMetadataLite {
  frontmatter?: Record<string, any>
  tags?: Array<{ tag: string; position?: any }>
  headings?: Array<{ heading: string; level: number; position?: any }>
  links?: Array<{ link: string; original: string; position?: any }>
}
```

### 12.4 建议支持接口

```ts
class MetadataCacheShim extends EventsShim {
  resolvedLinks: Record<string, Record<string, number>>
  unresolvedLinks: Record<string, Record<string, number>>

  getFileCache(file: TFileShim): CachedMetadataLite | null
  getCache(path: string): CachedMetadataLite | null
  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFileShim | null
  fileToLinktext(file: TFileShim, sourcePath: string, omitMdExtension?: boolean): string
}
```

### 12.5 实现策略

不要试图直接复刻 Obsidian 的 metadata engine。建议拆成两层：

#### 层 A：静态提取器
从单个 Markdown 文件抽取：

- YAML frontmatter
- `#tag`
- ATX headings
- wikilinks / markdown links

#### 层 B：全局解析结果
从 LinkIndex 构建：

- `resolvedLinks`
- `unresolvedLinks`（可延后）
- link path resolve

### 12.6 `getFirstLinkpathDest` 映射

可以优先复用 `LinkIndex.extractLinks()` 已有的链接解析规则 `app/lib/core/link-index.ts:191`，并逐步抽出公共 resolver。

### 12.7 事件支持

在文件内容更新后，触发：

- `changed`
- `deleted`
- `resolved`（批量重建或首轮完成后）

第一阶段不必做得完全与 Obsidian 同步，但必须保证依赖元数据的插件可以“看到更新”。

---

## 13. Workspace Shim

### 13.1 第一阶段目标

第一阶段不要试图完整复刻 `WorkspaceLeaf` / split / side dock 系统。只提供最小可用能力。

### 13.2 第一阶段建议支持

```ts
class WorkspaceShim extends EventsShim {
  getActiveFile(): TFileShim | null
  getActiveViewOfType<T>(type: new (...args: any[]) => T): T | null
  openLinkText(linktext: string, sourcePath: string): Promise<void>
}
```

### 13.3 行为策略

- `getActiveFile()`：映射当前打开文件
- `openLinkText()`：映射到 MindOS 当前页面导航
- `getActiveViewOfType()`：第一阶段只支持很少数内建 view

### 13.4 第二阶段再支持

- `getLeaf()`
- `createLeafBySplit()`
- `registerView()` 配套宿主
- `getLeavesOfType()`
- file-menu / editor-menu

### 13.5 风险控制

Workspace 是最容易把项目拖向“重造 Obsidian”的区域。

结论：

> **第一阶段只做读活跃文件与打开链接，不做布局系统。**

---

## 14. Command Shim

### 14.1 目标

很多插件的实际价值就是注册几个命令，所以命令系统必须优先支持。

### 14.2 命令模型

```ts
interface CommandShim {
  id: string
  name: string
  callback?: () => any
  checkCallback?: (checking: boolean) => boolean | void
  editorCallback?: (editor: EditorShim, ctx: any) => any
  editorCheckCallback?: (checking: boolean, editor: EditorShim, ctx: any) => boolean | void
  hotkeys?: HotkeyLike[]
}
```

### 14.3 宿主注册中心

建议新增全局命令注册表：

```ts
register(pluginId: string, command: CommandShim): RegisteredCommand
unregister(pluginId: string, commandId: string): void
unregisterAll(pluginId: string): void
list(): RegisteredCommand[]
execute(fullId: string): Promise<void>
```

### 14.4 `checkCallback` 策略

Obsidian 的 `checkCallback(checking)` 很常见。

建议：

- `checking === true` 时只判断当前上下文下能否执行
- `checking === false` 时才真正执行

这对命令面板中的 disabled/enabled 状态很有价值。

### 14.5 `editorCallback` 第一阶段策略

如果当前还没有完整 `EditorShim`：

- 没有活跃编辑器时，不执行
- 命令展示为禁用
- 保持行为可预期

---

## 15. UI Shim：Notice / Modal / Setting / PluginSettingTab

### 15.1 Notice

最简单，直接映射到 MindOS toast/notification。

```ts
class NoticeShim {
  constructor(message: string, timeout?: number)
}
```

策略：构造即展示。

### 15.2 Modal

最小支持：

```ts
class ModalShim extends ComponentShim {
  app: AppShim
  containerEl: HTMLElement
  contentEl: HTMLElement
  titleEl: HTMLElement

  open(): void
  close(): void
  onOpen(): void
  onClose(): void
  setTitle(title: string): void
  setContent(content: string | HTMLElement): void
}
```

映射：

- `open()` → 宿主 dialog manager
- `contentEl` → dialog body root
- `close()` → 卸载 dialog

### 15.3 PluginSettingTab / Setting

这是第一阶段重点 UI 能力之一。

建议把 Obsidian Setting DSL 翻译为宿主表单结构，而不是硬依赖真实 DOM 结构。

#### 基础能力

- `setName()`
- `setDesc()`
- `addText()`
- `addToggle()`
- `addDropdown()`
- `addButton()`

#### 第一阶段不必完整支持

- Color picker
- Slider
- TextArea 的高级行为
- Complex nested DOM 操作

### 15.4 实现方式建议

不要直接模拟完整 Obsidian DOM API。建议内部做一个抽象：

```ts
interface SettingNode {
  kind: 'text' | 'toggle' | 'dropdown' | 'button'
  name?: string
  desc?: string
  value?: any
  onChange?: (value: any) => void
}
```

插件调用 Setting API 时，往容器里追加 `SettingNode`；宿主 UI 再把它渲染为 React 组件。

这样比直接 fake DOM 更可维护。

---

## 16. Markdown 后处理器 Shim

### 16.1 第一阶段建议

可以先在 `Plugin` 上保留注册接口，但实际仅记录，不接入完整渲染链。

```ts
registerMarkdownPostProcessor(fn)
registerMarkdownCodeBlockProcessor(lang, fn)
```

### 16.2 策略

- **Spike 阶段**：允许注册，但标记为未执行或仅在受控场景执行
- **Phase 2**：接入 MindOS Markdown 渲染器

### 16.3 为什么不能在第一阶段强做

因为这会把我们直接拉进：

- Markdown AST
- 渲染生命周期
- 局部 DOM 更新
- 插件渲染子树生命周期管理

这超出最小 shim 目标。

---

## 17. Editor Shim

### 17.1 策略

第一阶段尽量不承诺完整支持，只留接口位。

因为编辑器增强类插件依赖太深：

- CodeMirror 6 extensions
- selection / range / transaction
- editor callbacks
- MarkdownView 与 Editor 之间的耦合

### 17.2 最小接口壳

```ts
class EditorShim {
  getValue(): string
  setValue(content: string): void
  getSelection(): string
  replaceSelection(replacement: string): void
  getCursor(): EditorPositionLike
  setCursor(pos: EditorPositionLike): void
}
```

### 17.3 第一阶段行为

- 如果存在活跃编辑器，可桥接到当前编辑器实例
- 如果不存在，则明确抛错或禁用命令

### 17.4 不建议第一阶段支持

- `transaction()`
- `setSelections()`
- `registerEditorExtension()`
- CM6 ViewPlugin / StateField / Decoration

---

## 18. 样式注入 Shim

### 18.1 目标

许多插件带有 `styles.css`。即便不复杂，也至少要支持静态样式挂载。

### 18.2 建议策略

- 插件启用时读取 `${pluginDir}/styles.css`
- 注入 `<style data-plugin-id="...">...</style>`
- 插件停用时移除对应 style 节点

### 18.3 作用域策略

第一阶段可以直接全局注入，但建议加前缀 data attribute，便于清理。

长期更优方案：

- 插件容器级样式作用域
- 或 CSS namespace 约束

---

## 19. 错误处理与诊断

### 19.1 错误分类

所有插件错误应归类为：

1. **加载错误**：manifest 错、模块缺失、导出不合法
2. **API 不支持错误**：调用了未实现 shim
3. **运行时错误**：插件逻辑抛错
4. **宿主适配错误**：MindOS 适配器出错

### 19.2 诊断要求

每次失败至少记录：

- plugin id
- plugin version
- 调用 API 名
- 错误分类
- 原始错误 message
- stack（若有）

### 19.3 对用户展示

插件面板应展示：

- “已启用 / 已停用 / 启动失败 / 不支持”
- 最近一次错误摘要
- 缺失 API 列表

### 19.4 对开发者展示

建议额外提供一个 shim debug log：

- 注册了哪些命令
- 注册了哪些 setting tab
- 调用了哪些未实现 API
- 哪些事件被触发

---

## 20. API 支持矩阵（Shim 视角）

### 20.1 第一阶段：完整支持

- `Plugin.onload/onunload`
- `Plugin.loadData/saveData`
- `Plugin.addCommand`
- `Plugin.addSettingTab`
- `Notice`
- `Modal`（基础）
- `Vault.read/create/modify/delete/rename`
- `Vault.getFiles/getMarkdownFiles/getFileByPath`
- `MetadataCache.getFileCache/getCache`
- `App.isDarkMode`
- `App.loadLocalStorage/saveLocalStorage`

### 20.2 第一阶段：部分支持

- `addRibbonIcon`
- `addStatusBarItem`
- `Workspace.getActiveFile`
- `Workspace.openLinkText`
- `MetadataCache.resolvedLinks`
- `Command.checkCallback`

### 20.3 第一阶段：stub

- `registerView`
- `registerExtensions`
- `registerMarkdownPostProcessor`
- `registerMarkdownCodeBlockProcessor`
- `registerEditorExtension`
- `registerEditorSuggest`

### 20.4 第一阶段：明确不支持

- Electron / Node 原生模块
- 完整 Workspace split/leaf 模型
- Canvas / Publish / Sync 私有能力
- 深度 CodeMirror 插件能力

---

## 21. 实现顺序建议

### Step 1
- `EventsShim`
- `ComponentShim`
- `PluginShim`
- `PluginRuntime`

### Step 2
- `TFile/TFolder/TAbstractFile`
- `VaultShim`
- `data.json persistence`

### Step 3
- `CommandRegistry`
- `NoticeShim`
- `ModalShim`
- `PluginSettingTabShim`

### Step 4
- `MetadataCacheShim`
- link resolver
- cache invalidation / update hooks

### Step 5
- `WorkspaceShim` 最小支持
- 样式注入
- 插件错误面板

---

## 22. 当前建议

如果只看技术可行性，这份 Shim 设计说明了两件事：

### 22.1 值得做的部分

下面这层很值得做：

- Plugin runtime
- Vault
- Command
- Setting
- Notice / Modal
- MetadataCache 基础版

因为它们可以大量复用 MindOS 已有能力，而且足以覆盖一层高价值插件。

### 22.2 不应过早承诺的部分

下面这层不要在第一阶段承诺：

- 完整 Workspace
- 完整 Markdown 后处理器
- 完整 Editor / CM6 扩展能力
- Excalidraw / Dataview 级复杂插件兼容

结论：

> **API Shim 是可行的，但必须是“分层兼容的宿主适配器”，不能按“重造一个 Web 版 Obsidian”去做。**
