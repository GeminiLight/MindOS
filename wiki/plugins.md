# MindOS 插件系统 (Plugin System)

MindOS 内置一套渲染器插件体系，每个插件匹配特定文件名或格式，将原始 Markdown/CSV 渲染为专属交互视图。所有插件通过 `registerRenderer()` 注册，用户可在 Settings 中单独禁用。

当前已实现 **10 个**内置渲染器（`app/components/renderers/`）。

---

## 面向人类的插件 (Human-Facing)

### ✅ TODO Board — `TodoRenderer`
- **触发：** `TODO.md` / `TODO.csv`
- **功能：** 将 Markdown checkbox 列表渲染为交互式看板，按 `##` 分区分列。支持直接勾选、重命名、删除、添加任务，变更即时写回源文件。

### 📊 CSV Views — `CsvRenderer`
- **触发：** 任意 `.csv` 文件（非 TODO）
- **功能：** 三种视图切换——**Table**（可排序、分组、隐藏列）、**Gallery**（卡片瓦片）、**Board**（拖拽看板）。视图配置持久化到 localStorage。

### 🕸️ Wiki Graph — `GraphRenderer`
- **触发：** 任意 `.md` 文件
- **功能：** 全库 WikiLink / Markdown Link 引用解析，渲染为 force-directed 节点图。支持 **Local**（当前文件 2-hop 邻居）/ **Global**（全库）两种范围。点击节点跳转对应文件。

### 📅 Timeline — `TimelineRenderer`
- **触发：** `CHANGELOG.md`, `TIMELINE.md`, `journal.md` 等
- **功能：** 将 `## 2025-01-15` 格式的日期标题渲染为竖向时间轴卡片流，自动提取 `#tag`，支持 inline Markdown 渲染。

### 🔗 Backlinks — `BacklinksRenderer`
- **触发：** `BACKLINKS.md`, `index.md`, `MOC.md` 等
- **功能：** 扫描全库，找出所有引用当前文件的来源，每条来源展示上下文 snippet，高亮 WikiLink 语法，点击跳转。

### ✨ AI Briefing — `SummaryRenderer`
- **触发：** `DAILY.md`, `SUMMARY.md`, `BRIEFING.md` 等
- **功能：** 拉取最近修改的文件列表，将其作为上下文流式发给 AI，生成包含关键变更 / 主题模式 / 下一步行动的每日简报。支持 Regenerate。

### ⚙️ Config View — `ConfigRenderer`
- **触发：** `CONFIG.json`, `CONFIG.md`
- **功能：** 配置文件的结构化展示与编辑界面。

---

## 面向 Agent 的插件 (Agent-Facing)

这类插件的核心目标是**让人类看见并控制 Agent 的行为**。

### 🤖 Agent Inspector — `AgentInspectorRenderer`
- **触发：** `Agent-Audit.md`
- **数据来源：** MCP Server 在每次写操作后自动 append 操作日志。
- **功能：** 将操作日志渲染为可过滤时间轴——按 read / write / create / delete / search 分类，展开查看完整参数，文件路径可点击跳转。

### 🔀 Agent Diff Viewer — `DiffRenderer`
- **触发：** `Agent-Diff.md`
- **数据来源：** MCP Server 的写操作前后自动记录 diff。
- **功能：** LCS 行级 diff，绿色新增 / 红色删除，相同行自动折叠。每条变更支持 **✓ Approve**（保留）或 **✕ Reject**（一键回滚）。

### ⚙️ Workflow Runner — `WorkflowRenderer`
- **触发：** `Workflow.md`, `SOP.md`, `Runbook.md` 等
- **功能：** 将 `## Step N: 标题` 结构的文档渲染为可执行步骤卡片。每步可单独 **Run**（触发 AI 执行并流式输出）或 **Skip**。包含进度条、Run Next、Reset 控件。

---

## 插件注册机制

所有插件通过 `registerRenderer()` 注册到全局 registry（`lib/renderers/registry.ts`）：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | `string` | 唯一标识符 |
| `name` | `string` | 显示名称 |
| `description` | `string` | 功能描述 |
| `icon` | `string` | emoji 图标 |
| `tags` | `string[]` | 分类标签 |
| `builtin` | `boolean` | `true` = 内置，`false` = 用户安装（未来） |
| `match` | `(ctx) => boolean` | 触发条件（基于 filePath + extension） |
| `component` | React 组件 | 接收 `{ filePath, content, extension, saveAction }` |

用户可通过 Settings 面板单独禁用任意插件，状态持久化到 localStorage。

---
*Last Updated: 2026-03-11*
