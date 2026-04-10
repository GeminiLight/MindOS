# Spec: Obsidian 插件兼容方案

> **状态**：📋 Spec 完成
> **日期**：2026-04-10
> **关联文档**：
> - `wiki/specs/spec-obsidian-api-shim.md` — API Shim 层详细设计
> - `wiki/specs/spec-obsidian-ecosystem-research.md` — 插件生态调研报告

---

## 1. 背景与目标

### 1.1 为什么要兼容 Obsidian 插件

Obsidian 拥有最大的 Markdown 知识库插件生态：

| 指标 | 数值 |
|------|------|
| 社区插件总数 | 2,753+ |
| 总下载量 | 1.01 亿+ |
| 2025 年新增插件 | 821 个 |
| 2025 年下载量 | 3,366 万 |
| 活跃开发者 | 805+ |

MindOS 作为知识库产品，兼容 Obsidian 插件生态可以：

1. **降低用户迁移成本** — 用户无需放弃已熟悉的工具
2. **快速获得功能丰富度** — 2700+ 插件即刻可用（部分）
3. **吸引 Obsidian 开发者** — 插件开发者可以零成本将插件迁移到 MindOS
4. **减少重复开发** — 不必重新实现社区已有的功能

### 1.2 目标

**Phase 1（MVP）**：实现 Obsidian Plugin API Shim 层，使**简单到中等复杂度**的社区插件能在 MindOS 内运行，覆盖 Top 25 插件中的 60%+ 插件类型。

**Phase 2（增强）**：支持自定义 View、编辑器扩展、完整 Workspace 布局，覆盖 Top 25 插件中的 85%+。

**Phase 3（生态）**：建立 MindOS 插件市场，支持一键安装 Obsidian 社区插件。

### 1.3 非目标

- **不追求 100% API 兼容** — Obsidian 有数百个 API，且与 Electron 深度绑定，完全兼容不现实
- **不兼容 `isDesktopOnly: true` 插件** — 依赖 Node.js/Electron 原生 API 的插件（如 Git 插件）不在范围内
- **不替代 MindOS 原生功能** — AI Agent、Skill 体系、MCP 是 MindOS 的独有优势，不会被插件系统替代

---

## 2. 战略决策：不是"兼容"而是"兼容层"

### 2.1 行业先例分析

| 项目 | 方式 | 结果 |
|------|------|------|
| **Oxidian** (Rust+Tauri) | 3,500 行 JS Shim 模拟 Obsidian API | 仅简单插件可用，Dataview/Excalidraw 不行 |
| **Lokus/Otterly/Cherit** | 仅兼容 Vault 格式（.md 文件） | 不支持插件 |
| **Foam** (VS Code) | 使用 VS Code 自己的扩展生态 | 完全不兼容 |
| **Logseq** | 自建插件体系 | 完全不兼容 |

**结论**：没有任何成熟项目成功实现 Obsidian 插件的完整兼容。我们的策略是：

> **构建一个 API Shim 层**，将 Obsidian Plugin API 映射到 MindOS 已有能力上。
> 不修改 MindOS 核心架构去适应 Obsidian，而是用适配器模式桥接两者。

### 2.2 架构原则

```
┌─────────────────────────────────────────────┐
│            Obsidian 社区插件 (main.js)        │
│   (unmodified — 直接加载编译后的插件代码)       │
├─────────────────────────────────────────────┤
│          Obsidian API Shim Layer             │
│  ┌───────┐ ┌──────────┐ ┌──────────────┐    │
│  │ Vault │ │Workspace │ │MetadataCache │    │
│  │ Shim  │ │  Shim    │ │    Shim      │    │
│  └───┬───┘ └────┬─────┘ └──────┬───────┘    │
│      │          │               │            │
│  ┌───┴──────────┴───────────────┴──────┐     │
│  │     MindOS Adapter Bridge            │     │
│  │  (REST API / Direct Function Call)   │     │
│  └──────────────────────────────────────┘     │
├─────────────────────────────────────────────┤
│              MindOS 核心                      │
│  ┌────────┐ ┌────────┐ ┌───────────────┐    │
│  │fs-ops  │ │search  │ │link-index     │    │
│  │core    │ │index   │ │backlinks      │    │
│  └────────┘ └────────┘ └───────────────┘    │
│  ┌────────┐ ┌────────┐ ┌───────────────┐    │
│  │renderer│ │editor  │ │settings       │    │
│  │registry│ │(CM6)   │ │system         │    │
│  └────────┘ └────────┘ └───────────────┘    │
└─────────────────────────────────────────────┘
```

**关键设计决策**：

1. **Shim 层是纯 TypeScript 适配器** — 不修改 MindOS 核心代码
2. **插件运行在受控运行时中** — 第一阶段以主线程受控 runtime 为主，后续可演进为 iframe 隔离
3. **插件通过 REST API 或内部函数调用访问 MindOS** — 而非直接访问文件系统
4. **渐进式兼容** — 按 API 层次逐步实现，优先高频 API

---

## 3. 分层实现计划

### 3.1 API 兼容层次（按优先级）

| 层次 | API | 使用率 | 难度 | Phase |
|------|-----|--------|------|-------|
| **L1** | Plugin 生命周期 (onload/onunload/loadData/saveData) | 100% | 低 | Phase 1 |
| **L2** | Vault API (文件 CRUD + 事件) | 95% | 低 | Phase 1 |
| **L3** | Command 系统 (addCommand) | 85% | 低 | Phase 1 |
| **L4** | Settings UI (PluginSettingTab, Setting) | 70% | 中 | Phase 1 |
| **L5** | MetadataCache (frontmatter/tags/links) | 60% | 中 | Phase 1 |
| **L6** | Notice / Modal | 70% | 低 | Phase 1 |
| **L7** | Ribbon Icon / Status Bar | 40% | 低 | Phase 2 |
| **L8** | Markdown Post-Processor | 20% | 中 | Phase 2 |
| **L9** | 自定义 View (ItemView) | 25% | 中高 | Phase 2 |
| **L10** | Editor API (CM6 扩展) | 30% | 高 | Phase 2 |
| **L11** | Workspace 布局 (splits/tabs) | 20% | 高 | Phase 3 |
| **L12** | SuggestModal / FuzzySuggestModal | 15% | 中 | Phase 2 |
| **L13** | File/Editor Menu 扩展 | 15% | 中 | Phase 2 |
| **L14** | Protocol Handler | 5% | 低 | Phase 3 |

### 3.2 Phase 1 可覆盖的热门插件

实现 L1-L7 后，以下热门插件理论上可运行（或仅需小幅适配）：

| 插件 | 下载量 | 主要依赖 API | 可行性 |
|------|--------|-------------|--------|
| Tasks | 3,275,756 | MetadataCache + MarkdownPostProcessor | ✅ 大部分可行 |
| Style Settings | 2,198,564 | SettingTab + CSS 变量 | ✅ 完全可行 |
| QuickAdd | 1,691,027 | Command + Modal + Vault.create | ✅ 完全可行 |
| Remotely Save | 1,789,030 | Vault 事件 + loadData/saveData | ⚠️ 需要网络 API |
| Tag Wrangler | 920,906 | MetadataCache + Vault | ✅ 完全可行 |
| Linter | 855,271 | Editor + Vault + Command | ⚠️ 需要 Editor API |
| Copilot | 1,183,348 | Editor + 自定义 View + 外部 API | ⚠️ 需要 Phase 2 |
| Homepage | 1,052,139 | Workspace + Command | ✅ 基本可行 |
| Recent Files | 975,567 | Workspace 事件 + ItemView | ⚠️ 需要 Phase 2 |

### 3.3 Phase 2 新增可覆盖插件

追加 L8-L13 后：

| 插件 | 下载量 | 新增 API 需求 |
|------|--------|--------------|
| Excalidraw | 5,748,875 | registerView + ItemView + registerExtensions |
| Dataview | 3,913,185 | registerMarkdownCodeBlockProcessor + MetadataCache |
| Calendar | 2,499,078 | registerView (侧边栏) |
| Kanban | 2,194,392 | registerView + Vault |
| Templater | 3,960,873 | Editor API + Vault + Command |
| Advanced Tables | 2,695,280 | Editor API (CM6 扩展) |

---

## 4. 技术方案

### 4.1 插件加载流程

```
1. 用户安装插件
   └─ 将 main.js + manifest.json + styles.css 放入
      ${mindRoot}/.plugins/<plugin-id>/

2. MindOS 启动时扫描 .plugins/ 目录
   └─ 读取每个插件的 manifest.json
   └─ 检查 minAppVersion 兼容性
   └─ 检查 isDesktopOnly 限制

3. 用户启用插件
   └─ 加载 main.js（eval 或 dynamic import）
   └─ 注入 Shim 版本的 `require('obsidian')` 模块
   └─ 调用 plugin.onload()

4. 插件运行
   └─ 插件通过 Shim API 与 MindOS 交互
   └─ 所有 API 调用经过适配器桥接到 MindOS 核心

5. 用户禁用插件
   └─ 调用 plugin.onunload()
   └─ 清理所有注册的命令、视图、事件监听器
```

### 4.2 模块注入机制

Obsidian 插件使用 CommonJS 格式，通过 `require('obsidian')` 引入 API。我们需要拦截这个 require 调用：

```typescript
// plugin-loader.ts
function loadPlugin(pluginDir: string): Plugin {
  const code = readFileSync(`${pluginDir}/main.js`, 'utf-8');
  
  // 创建模块沙箱
  const module = { exports: {} };
  const require = (id: string) => {
    if (id === 'obsidian') return obsidianShim; // 注入 Shim
    throw new Error(`Module not found: ${id}`);
  };
  
  // 执行插件代码
  const fn = new Function('module', 'exports', 'require', code);
  fn(module, module.exports, require);
  
  // 获取默认导出的 Plugin 类
  const PluginClass = module.exports.default || module.exports;
  return new PluginClass(app, manifest);
}
```

### 4.3 安全隔离

插件运行在主进程中但受到限制：

| 维度 | 策略 |
|------|------|
| **文件访问** | 仅通过 Vault Shim 访问 mindRoot 内文件，路径验证 |
| **网络访问** | 通过 `requestUrl` Shim 代理，可设白名单 |
| **DOM 访问** | 限制在插件专属容器内 |
| **Node.js API** | 不提供（Web 环境无法提供 fs/child_process） |
| **其他插件** | 通过 `app.plugins` 只读访问已加载插件列表 |

### 4.4 插件存储结构

```
${mindRoot}/
├── .plugins/                          # 插件根目录
│   ├── registry.json                  # 插件注册表（启用/禁用状态）
│   ├── dataview/
│   │   ├── manifest.json              # Obsidian 原始 manifest
│   │   ├── main.js                    # 编译后的插件代码
│   │   ├── styles.css                 # 可选样式
│   │   └── data.json                  # 用户设置（自动生成）
│   ├── tasks/
│   │   ├── manifest.json
│   │   ├── main.js
│   │   └── data.json
│   └── ...
```

### 4.5 与 MindOS 现有系统的集成

| MindOS 系统 | 集成方式 |
|-------------|---------|
| **Renderer 注册表** | 插件的 `registerView()` 映射为 MindOS RendererDefinition |
| **Command Palette (⌘K)** | 插件的 `addCommand()` 注入到命令面板 |
| **Settings 页面** | 插件的 PluginSettingTab 渲染到 MindOS 设置页的"插件"区域 |
| **侧边栏 Panel** | 插件的 Ribbon Icon 映射到 MindOS Activity Bar |
| **文件操作** | Vault Shim 调用 MindOS fs-ops |
| **元数据** | MetadataCache Shim 调用 MindOS search-index + link-index |
| **编辑器** | Editor Shim 桥接 MindOS 的 CodeMirror 6 实例 |

---

## 5. MindOS 核心需要的改动

### 5.1 Phase 1 需要的新增能力

| 能力 | 当前状态 | 改动量 |
|------|---------|-------|
| **事件系统** | ❌ 无 | 需要新建。在 fs-ops 中加入 create/modify/delete/rename 事件发射 |
| **Command 注册 API** | ❌ 无 | 需要新建。全局命令注册表 + 命令面板集成 |
| **插件设置 UI 容器** | ❌ 无 | 在设置页面新增"社区插件"设置区域 |
| **插件管理器** | ❌ 无 | 新建插件扫描、加载、启用/禁用、卸载流程 |
| **CSS 注入** | ❌ 无 | 支持动态加载插件的 styles.css |
| **Ribbon/StatusBar** | ❌ 无 | Activity Bar 支持动态图标注入 |

### 5.2 Phase 2 需要的新增能力

| 能力 | 当前状态 | 改动量 |
|------|---------|-------|
| **自定义 View 宿主** | 部分（Renderer 系统） | 扩展 Renderer 支持 ItemView 协议 |
| **Markdown 渲染管线 Hook** | ❌ 无 | 在 Markdown 渲染器中加入 post-processor 管线 |
| **Editor Shim** | 部分（有 CM6） | 需要桥接 Obsidian Editor 抽象到 MindOS CM6 实例 |
| **Workspace Leaf** | ❌ 无 | 实现简化版 Leaf/Split 布局系统 |
| **File/Editor Menu** | ❌ 无 | 右键菜单扩展点 |

---

## 6. 实现路线图

### Phase 1: 基础兼容层（核心 Shim + 插件管理器）

**目标**：让 Style Settings、QuickAdd、Tag Wrangler 等简单插件跑起来。

```
Step 1: 插件管理器
  - .plugins/ 目录扫描
  - manifest.json 解析
  - 插件加载/卸载流程
  - registry.json 持久化

Step 2: 核心 Shim 实现
  - obsidian 模块 Shim（Plugin, App, Component 基类）
  - Vault Shim（文件 CRUD → MindOS fs-ops）
  - Events 系统（文件变更事件）
  - Plugin.loadData/saveData → data.json

Step 3: UI 集成
  - addCommand → MindOS 命令面板
  - PluginSettingTab → MindOS 设置页
  - Notice → MindOS Toast
  - Modal → MindOS Dialog
  - addRibbonIcon → Activity Bar

Step 4: MetadataCache Shim
  - frontmatter 解析（基于 MindOS search-index）
  - tags/links 提取
  - CachedMetadata 结构
  - changed/deleted 事件
```

### Phase 2: 高级兼容（视图 + 编辑器 + Markdown 管线）

**目标**：让 Dataview、Calendar、Kanban、Excalidraw 跑起来。

```
Step 5: 自定义 View
  - ItemView Shim
  - registerView → MindOS Renderer 注册
  - WorkspaceLeaf 简化实现
  - getLeaf / setViewState

Step 6: Markdown 处理器
  - registerMarkdownPostProcessor
  - registerMarkdownCodeBlockProcessor
  - 集成到 MindOS Markdown 渲染管线

Step 7: Editor Shim
  - Obsidian Editor → CM6 EditorView 桥接
  - registerEditorExtension
  - editorCallback 支持

Step 8: Workspace 增强
  - Workspace 事件（active-leaf-change, file-open 等）
  - openLinkText
  - file-menu / editor-menu 扩展
```

### Phase 3: 生态建设

```
Step 9: 插件市场
  - 从 obsidian-releases 仓库拉取社区插件列表
  - 兼容性评分系统（自动测试每个插件使用了哪些 API）
  - 一键安装/更新

Step 10: 开发者工具
  - MindOS 插件开发 CLI
  - Hot reload 支持
  - API 兼容性检查工具
```

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **API 表面太大** | 无法完整兼容 | 分层渐进实现，优先高频 API |
| **插件依赖 Node.js** | isDesktopOnly 插件无法运行 | 明确标注不支持，提供替代方案 |
| **插件间依赖** | 如 Dataview API 被其他插件依赖 | 优先实现被依赖最多的插件的 API |
| **Obsidian API 更新** | 新版本 API 变动 | 锁定 target API 版本（如 1.7.2），定期更新 |
| **性能问题** | 大量插件同时运行 | 插件沙箱隔离 + 资源配额 |
| **安全风险** | 插件可能有恶意代码 | Shim 层做权限控制，不暴露底层 fs |

---

## 8. 成功标准

### Phase 1 完成标准
- [ ] Style Settings 插件正常运行
- [ ] QuickAdd 插件正常运行
- [ ] Tag Wrangler 插件正常运行
- [ ] Homepage 插件正常运行
- [ ] 插件设置面板正常显示
- [ ] 命令面板集成正常
- [ ] 插件可以正常读写文件

### Phase 2 完成标准
- [ ] Dataview 查询块正常渲染
- [ ] Calendar 侧边栏视图正常显示
- [ ] Kanban 看板视图正常交互
- [ ] Excalidraw 画布正常编辑
- [ ] Templater 模板正常执行

### 量化目标
- Phase 1：Top 25 插件中 **8+ 个**可运行（32%+）
- Phase 2：Top 25 插件中 **18+ 个**可运行（72%+）
- Phase 3：Top 100 插件中 **60+ 个**可运行（60%+）
