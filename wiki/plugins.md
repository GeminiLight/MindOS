# MindOS 插件系统 (Plugin System)

MindOS 内置一套渲染器插件体系，每个插件匹配特定文件名或格式，将原始 Markdown/CSV 渲染为专属交互视图。插件分为两类：**面向人类 (For Human)** 和 **面向 Agent (For Agent)**。

---

## 面向人类的插件 (Human-Facing)

### ✅ TODO Board
- **触发：** `TODO.md` / `TODO.csv`
- **功能：** 将 Markdown checkbox 列表渲染为交互式看板，按 `##` 分区分列。支持直接勾选、重命名、删除、添加任务，变更即时写回源文件。

### 📊 CSV Views
- **触发：** 任意 `.csv` 文件（非 TODO）
- **功能：** 三种视图切换——**Table**（可排序、分组、隐藏列）、**Gallery**（卡片瓦片）、**Board**（拖拽看板）。视图配置持久化到 localStorage。

### 🕸️ Wiki Graph
- **触发：** 任意 `.md` 文件
- **功能：** 全库 Wikilink / Markdown 链接解析，渲染为 force-directed 节点图。支持 **Local**（当前文件 2-hop 邻居）/ **Global**（全库）两种范围。点击节点跳转对应文件。

### 📅 Timeline
- **触发：** `CHANGELOG.md`, `TIMELINE.md`, `journal.md` 等
- **功能：** 将 `## 2025-01-15` 格式的日期标题渲染为竖向时间轴卡片流，自动提取 `#tag`，支持 inline Markdown 渲染。

### 🔗 Backlinks
- **触发：** `BACKLINKS.md`, `index.md`, `MOC.md` 等
- **功能：** 扫描全库，找出所有引用当前文件的来源，每条来源展示最多 3 段上下文 snippet，高亮 WikiLink 语法，点击跳转。

### ✨ AI Briefing
- **触发：** `DAILY.md`, `SUMMARY.md`, `BRIEFING.md` 等
- **功能：** 拉取最近修改的文件列表，将其作为上下文流式发给 AI，生成包含**关键变更 / 主题模式 / 下一步行动**的每日简报。支持 Regenerate。

---

## 面向 Agent 的插件 (Agent-Facing)

这类插件的核心目标是**让人类看见并控制 Agent 的行为**，而非让 Agent 使用插件。

### 🤖 Agent Inspector
- **触发：** `Agent-Audit.md`
- **数据来源：** MCP Server 在每次写操作后自动 append ` ```agent-op ` JSON 块（含 tool、params、result、timestamp）。
- **功能：** 将操作日志渲染为可过滤时间轴——按 read / write / create / delete / search 分类，展开查看完整参数，文件路径可点击跳转。

### ⚙️ Workflow Runner
- **触发：** `Workflow.md`, `SOP.md`, `Runbook.md` 等
- **功能：** 将 `## Step N: 标题` 结构的文档渲染为可执行步骤卡片。每步可单独 **Run**（触发 AI 执行并流式输出）或 **Skip**。包含进度条、Run Next、Reset 控件。

### 🔀 Agent Diff Viewer
- **触发：** `Agent-Diff.md`
- **数据来源：** MCP Server 的 `mindos_write_file` / `mindos_update_section` 在写入前后自动 append ` ```agent-diff ` 块（含 before/after 全文）。
- **功能：** LCS 行级 diff，绿色新增 / 红色删除，相同行自动折叠。每条变更支持 **✓ Approve**（保留）或 **✕ Reject**（自动调用 API 将 before 写回目标文件，实现一键回滚）。

---

## 插件注册机制

所有插件通过 `registerRenderer()` 注册，核心字段：

| 字段 | 说明 |
| :--- | :--- |
| `id` | 唯一标识符 |
| `match` | `({ filePath, extension }) => boolean`，决定触发条件 |
| `component` | React 组件，接收 `{ filePath, content, extension, saveAction }` |
| `priority` | 注册顺序即优先级，先注册者优先匹配 |

用户可通过 Settings 面板单独禁用任意插件，状态持久化到 localStorage。
