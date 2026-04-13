# Mermaid Editor — Mermaid 图表编辑插件

> Mermaid 代码块的实时预览编辑器，支持导出 SVG/PNG。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `mermaid` |
| 类型 | 渲染器（Renderer） |
| 触发文件 | `*.mermaid`, `*.mmd`；Markdown 中的 ` ```mermaid ` 代码块 |
| 依赖 | `mermaid` (npm, 已有) |
| 状态 | 计划中 |

## 解决什么问题

MindOS 的 Markdown 渲染已经支持 Mermaid 代码块预览。但编辑体验不够好——需要在文本和预览之间来回切换。独立的 Mermaid 编辑器提供分屏实时预览、语法提示、一键导出。

## 功能

- 分屏编辑器：左侧代码 + 右侧实时预览
- 语法高亮 + 基础自动补全
- 支持所有 Mermaid 图表类型：flowchart、sequence、class、state、ER、gantt、pie、git graph 等
- 导出：SVG / PNG / 复制 Mermaid 代码
- 从 Markdown 中的 mermaid 代码块直接打开编辑器
- 主题适配（light / dark）

## 与现有能力的关系

| | 现有 | 插件 |
|--|------|------|
| Markdown 中的 mermaid 块 | 只读渲染 | 点击可进入编辑器 |
| `.mermaid` 独立文件 | 不支持 | 完整编辑器体验 |
| 导出 | 无 | SVG / PNG |

## 实施要点

- `mermaid` npm 包已在项目中，无额外依赖
- 编辑器用 CodeMirror 或简单 textarea，不需要重型 IDE
- 保存时写回 Markdown 的 mermaid 代码块或独立 `.mermaid` 文件
