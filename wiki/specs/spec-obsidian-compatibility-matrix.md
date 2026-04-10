# Spec: Obsidian 插件兼容性矩阵

> **状态**：📋 Spec 完成
> **日期**：2026-04-10
> **关联文档**：
> - `wiki/specs/spec-obsidian-plugin-compat.md`
> - `wiki/specs/spec-obsidian-api-shim.md`
> - `wiki/specs/spec-obsidian-spike-plan.md`
> - `wiki/specs/spec-obsidian-ecosystem-research.md`

---

## 1. 文档目标

本文不是讲实现细节，而是回答三个更偏决策的问题：

1. **哪些 Obsidian API 值得优先兼容**
2. **哪些插件类型最适合先支持**
3. **哪些头部插件是我们应该用来验证路线的样本**

它的作用是把“调研”和“实现计划”之间补上一层：

> **把兼容路线从抽象讨论，落成一个有优先级、有取舍的矩阵。**

---

## 2. 评分方法

### 2.1 评分维度

每个 API 层、插件类型、代表插件，都按四个维度打分：

| 维度 | 含义 |
|---|---|
| **用户价值** | 对用户迁移和产品吸引力有多大 |
| **生态覆盖** | 能覆盖多少插件 / 多大下载量 |
| **实现难度** | 对 MindOS 宿主改动有多大 |
| **架构风险** | 是否容易把项目拖向重造 Obsidian |

### 2.2 结论标签

每项最后落到四种标签之一：

- **P0：立刻做**
- **P1：值得做，但放第二阶段**
- **P2：仅做有限支持**
- **P3：暂不做 / 不建议做**

---

## 3. API 层兼容矩阵

### 3.1 总表

| 层级 | API | 插件覆盖率 | 用户价值 | 难度 | 风险 | 优先级 | 结论 |
|---|---|---:|---:|---:|---:|---|---|
| L1 | Plugin 生命周期 | 100% | 高 | 低 | 低 | P0 | 必做 |
| L2 | loadData/saveData | 80%+ | 高 | 低 | 低 | P0 | 必做 |
| L3 | Vault CRUD + 事件 | 95% | 极高 | 低 | 低 | P0 | 必做 |
| L4 | Command System | 85% | 高 | 低 | 低 | P0 | 必做 |
| L5 | SettingTab / Setting | 70% | 高 | 中 | 低 | P0 | 必做 |
| L6 | Notice / Modal | 70% | 中高 | 低 | 低 | P0 | 必做 |
| L7 | MetadataCache | 60% | 极高 | 中 | 中 | P0 | 必做 |
| L8 | Ribbon / Status Bar | 40% | 中 | 低 | 低 | P1 | 可延后 |
| L9 | MarkdownPostProcessor | 20% | 高 | 中 | 中 | P1 | 第二阶段 |
| L10 | ItemView / registerView | 25% | 高 | 中高 | 高 | P1 | 第二阶段 |
| L11 | WorkspaceLeaf / split 布局 | 20% | 中 | 高 | 极高 | P3 | 暂不做 |
| L12 | Editor API | 30% | 高 | 高 | 高 | P2 | 有限支持 |
| L13 | registerEditorExtension | 15%-20% | 中高 | 很高 | 极高 | P3 | 暂不做 |
| L14 | FuzzySuggestModal | 15% | 中 | 中 | 低 | P1 | 第二阶段 |
| L15 | file-menu / editor-menu | 15% | 中 | 中 | 中 | P2 | 有限支持 |
| L16 | Protocol Handler | 5% | 低 | 中 | 低 | P3 | 暂不做 |

---

## 4. 为什么 L1-L7 是第一优先级

### 4.1 这组 API 覆盖了最广泛的“插件基本盘”

大量插件虽然名字不同，但底层依赖都很相似：

- 启动 / 停止
- 读写配置
- 注册命令
- 读写文件
- 读 frontmatter / tag / heading / link
- 显示设置页和一些基础 UI

如果没有 L1-L7，几乎不存在真正可运行的插件兼容。

### 4.2 这组 API 与 MindOS 现有能力的重叠度最高

可以直接复用：

- 文件操作：`app/lib/core/fs-ops.ts:10`
- 搜索索引：`app/lib/core/search-index.ts:107`
- 链接索引：`app/lib/core/link-index.ts:29`

所以这组能力是：

> **既高价值，又不需要先重建复杂宿主。**

### 4.3 这组 API 也是 Spike 最适合验证的范围

如果连这一层都跑不通，说明 Obsidian 插件兼容这条路线基本不值得继续投。

---

## 5. 插件类型兼容矩阵

### 5.1 按类型评估

| 插件类型 | 代表插件 | 价值 | 兼容难度 | 风险 | 优先级 | 建议 |
|---|---|---:|---:|---:|---|---|
| 知识管理 / 元数据 | Dataview, Tasks, Templater, Tag Wrangler | 极高 | 中 | 中 | P0/P1 | 核心目标 |
| 命令 / 自动化 | QuickAdd, Homepage | 高 | 低 | 低 | P0 | 最适合首批验证 |
| 设置 / 外观 | Style Settings, Minimal Theme Settings | 高 | 低中 | 低 | P0 | 很适合首批支持 |
| 搜索 / 导航 | Omnisearch, Recent Files, Breadcrumbs | 高 | 中 | 中 | P1 | 值得支持 |
| 自定义 View / 集成 | Calendar, Kanban, Excalidraw | 高 | 中高 | 高 | P1/P2 | 先挑轻量，不碰最重 |
| AI / 自动化 | Copilot, Smart Connections | 中高 | 中高 | 中 | P2 | 与 MindOS 原生能力重叠 |
| 编辑器增强 | Advanced Tables, Outliner, Linter | 中高 | 高 | 高 | P2/P3 | 有限支持 |
| 同步 / Git / 导入导出 | Git, Remotely Save, Importer | 中 | 高 | 高 | P3 | 多数不适合首阶段 |
| Node/Electron 重依赖 | Git 类、系统集成类 | 中 | 很高 | 极高 | P3 | 不建议兼容 |

### 5.2 最值得先做的类型

#### 第一名：命令 / 自动化类

原因：

- 用户价值高
- 结构简单
- 主要依赖 `Plugin + Command + Vault + Modal`
- 很适合验证最小 shim 的有效性

代表：
- QuickAdd
- Homepage

#### 第二名：设置 / 外观类

原因：

- 容易看到成效
- 宿主改动相对局部
- 不容易拖进 Workspace / Editor 深坑

代表：
- Style Settings
- Minimal Theme Settings

#### 第三名：知识管理 / 元数据类

原因：

- 这是 Obsidian 最核心的一类价值插件
- 与 MindOS 产品方向高度一致
- 但对 MetadataCache 的要求更高

代表：
- Tag Wrangler
- Tasks
- Dataview（后置）

### 5.3 不建议首批支持的类型

#### 编辑器增强类

原因：

- 与 CodeMirror 6 高耦合
- 常依赖 `registerEditorExtension()`
- 容易让项目偏离“插件兼容”而变成“编辑器重构”

#### Node/Electron 类

原因：

- Web 宿主天然不具备等价环境
- 兼容它们往往不是 Obsidian API 的问题，而是运行时环境的问题

---

## 6. 热门插件优先级矩阵

### 6.1 Top 插件评估

| 插件 | 类型 | 主要依赖 | 生态价值 | 难度 | 优先级 | 结论 |
|---|---|---|---:|---:|---|---|
| Excalidraw | 自定义 View | registerView, ItemView, 文件扩展 | 极高 | 很高 | P3 | 先不做 |
| Templater | 自动化 / 编辑器 | Vault, Editor, Command | 极高 | 高 | P2 | 后置 |
| Dataview | 元数据 / 渲染 | MetadataCache, codeblock processor | 极高 | 高 | P1 | 第二阶段重点 |
| Tasks | 元数据 / 渲染 | MetadataCache, post processor | 极高 | 中高 | P1 | 第二阶段重点 |
| Advanced Tables | 编辑器增强 | Editor, CM6 | 高 | 很高 | P3 | 不首批做 |
| Calendar | 自定义 View | registerView, Workspace | 高 | 中高 | P1 | 第二阶段可做 |
| Git | 同步 / Node | Node/Electron, fs, git | 高 | 很高 | P3 | 不建议做 |
| Style Settings | 设置 / 外观 | SettingTab, CSS | 高 | 低 | P0 | 首批样例 |
| Kanban | 自定义 View | registerView, Vault | 高 | 中高 | P1 | 第二阶段 |
| QuickAdd | 命令 / 自动化 | Command, Modal, Vault | 高 | 低中 | P0 | 首批样例 |
| Omnisearch | 搜索 | MetadataCache, modal, search index | 高 | 中 | P1 | 第二阶段 |
| Tag Wrangler | 元数据 | MetadataCache, Vault | 中高 | 中 | P0 | 首批样例 |
| Homepage | 导航 / 启动 | Command, Workspace | 中高 | 低 | P0 | 首批样例 |
| Copilot | AI / 编辑器 | Editor, View, 外部 API | 高 | 高 | P2 | 不首批 |
| Remotely Save | 同步 | Vault 事件, 配置, 网络 | 中高 | 高 | P2/P3 | 谨慎 |

### 6.2 首批样例推荐

建议把首批真实插件样例固定为：

#### P0 样例集
1. **Style Settings**
2. **QuickAdd**
3. **Tag Wrangler**
4. **Homepage**

这组的优点是：

- 覆盖 Setting / Command / Vault / Metadata / 基础 Workspace
- 难度相对可控
- 不是玩具插件，具有真实生态代表性

#### P1 样例集
5. **Tasks**
6. **Dataview**
7. **Calendar**
8. **Kanban**

这组用来验证第二阶段的边界。

---

## 7. API × 插件类型交叉矩阵

### 7.1 总体交叉关系

| API / 类型 | 命令自动化 | 设置外观 | 知识管理 | 搜索导航 | 自定义 View | 编辑器增强 | 同步导出 |
|---|---|---|---|---|---|---|---|
| Plugin 生命周期 | 高 | 高 | 高 | 高 | 高 | 高 | 高 |
| loadData/saveData | 高 | 高 | 中 | 中 | 中 | 中 | 高 |
| Vault | 高 | 低 | 高 | 中 | 高 | 中 | 高 |
| Command | 高 | 中 | 中 | 高 | 低 | 中 | 中 |
| MetadataCache | 低 | 低 | 极高 | 高 | 中 | 中 | 低 |
| SettingTab | 中 | 极高 | 中 | 低 | 中 | 中 | 高 |
| Notice / Modal | 高 | 中 | 低 | 中 | 中 | 低 | 中 |
| MarkdownPostProcessor | 低 | 低 | 高 | 中 | 低 | 中 | 低 |
| ItemView | 低 | 低 | 低 | 中 | 极高 | 低 | 低 |
| Workspace 布局 | 低 | 低 | 低 | 中 | 高 | 中 | 低 |
| Editor API | 中 | 低 | 中 | 低 | 低 | 极高 | 低 |
| Node/Electron | 低 | 低 | 低 | 低 | 低 | 中 | 极高 |

### 7.2 结论

这张表说明：

1. **L1-L7 可以先吃掉“命令自动化 + 设置外观 + 一部分知识管理”**
2. 一旦进入 `ItemView + Workspace + Editor`，复杂度会明显上升
3. `Node/Electron` 不是 API shim 能解决的问题，应单独排除

---

## 8. 对 MindOS 的收益矩阵

### 8.1 如果支持成功，分别能带来什么

| 兼容层 | 对用户的收益 | 对产品的收益 |
|---|---|---|
| Plugin + Vault + Command | Obsidian 用户能迁移一批工具链 | 形成“不是孤岛”的认知 |
| Setting + UI 基础件 | 插件可配置，可见度更高 | 形成插件生态雏形 |
| MetadataCache | 承接知识管理类插件 | 对齐 MindOS 的知识库产品心智 |
| Markdown 渲染扩展 | 支持 Dataview / Tasks 类能力 | 明显增强文档可编程性 |
| 自定义 View | 支持 Calendar / Kanban / Excalidraw 类体验 | 提升平台感 |
| Editor 扩展 | 支持高级编辑器插件 | 提升专业用户粘性 |

### 8.2 成本收益拐点

大致拐点在这里：

- **L1-L7**：投入合理，收益大
- **L8-L10**：投入显著增加，但依然可能值得
- **L11+**：非常容易掉进复杂度陷阱

所以最合理的产品策略是：

> **先把高价值低复杂度的前半段吃下来，再用真实插件验证后半段是否值得做。**

---

## 9. 最终优先级清单

### 9.1 P0：立刻做

#### API
- Plugin 生命周期
- loadData/saveData
- Vault CRUD + 事件
- Command system
- SettingTab / Setting
- Notice / Modal
- MetadataCache 基础版

#### 样例插件
- Style Settings
- QuickAdd
- Tag Wrangler
- Homepage

### 9.2 P1：第二阶段重点

#### API
- MarkdownPostProcessor
- registerMarkdownCodeBlockProcessor
- registerView / ItemView
- FuzzySuggestModal
- 更完整的 Workspace 支持

#### 样例插件
- Tasks
- Dataview
- Calendar
- Kanban

### 9.3 P2：有限支持

#### API / 类型
- Editor 基础操作
- file-menu / editor-menu
- AI 类插件
- 部分搜索导航插件

#### 插件
- Copilot
- Omnisearch
- Recent Files

### 9.4 P3：暂不做

#### API / 类型
- 完整 WorkspaceLeaf / split 布局系统
- registerEditorExtension 深度支持
- Node/Electron 运行时兼容
- Git / 系统同步类插件

#### 插件
- Excalidraw（首阶段不做）
- Git
- Advanced Tables
- Outliner

---

## 10. 结论

这份兼容性矩阵给出的最终判断很明确：

### 10.1 值得先做的，不是“最炫的插件”

首批应该做的是：

- 命令自动化类
- 设置外观类
- 基础知识管理类

因为它们最能验证 Shim 路线，而且不会立刻把项目拖进深层宿主复杂度。

### 10.2 最重的头部插件不应作为首批目标

Excalidraw、Git、重度编辑器增强类插件虽然声量大，但会极大扭曲架构优先级。它们不适合作为判断路线是否可行的第一批样本。

### 10.3 正确的验证顺序

正确顺序应该是：

1. 跑通 **Style Settings / QuickAdd / Tag Wrangler / Homepage**
2. 再评估 **Tasks / Dataview / Calendar / Kanban**
3. 最后才决定是否要碰 **Editor / Workspace / Excalidraw**

一句话总结：

> **先拿“最值、最广、最不危险”的那层插件吃下来，再决定要不要继续向 Obsidian 更深的宿主模型推进。**
