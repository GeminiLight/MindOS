# Excalidraw — 白板绘图插件

> 在 MindOS 中内嵌渲染和编辑 `.excalidraw` 文件。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `excalidraw` |
| 类型 | 渲染器（Renderer） |
| 触发文件 | `*.excalidraw`, `*.excalidraw.md`, `*.excalidraw.json` |
| 依赖 | `@excalidraw/excalidraw` (npm) |
| 状态 | 计划中 |

## 解决什么问题

架构图、流程图、系统设计图是开发者知识库的核心资产。Excalidraw 是开发者最常用的白板工具（手绘风格、轻量、本地优先）。在 MindOS 中直接渲染和编辑 `.excalidraw` 文件，避免在工具间切换。

## 功能

- 只读预览：文件列表中直接显示缩略图
- 内嵌编辑：点击进入全功能 Excalidraw 编辑器
- 新建画布：在任意目录新建 `.excalidraw` 文件
- 导出：PNG / SVG / 复制到剪贴板
- 暗色模式适配

## 文件格式

标准 Excalidraw JSON 格式，与 excalidraw.com 和 Obsidian Excalidraw 插件完全兼容。

## 空间成本

| 依赖 | 大小 |
|------|------|
| `@excalidraw/excalidraw` | ~800KB gzipped |
| 总计 | ~800KB（仅在使用时 lazy load） |

## 实施要点

- Lazy load：只在打开 `.excalidraw` 文件时加载 Excalidraw 包
- 存储：直接读写 JSON 文件，不做格式转换
- 协作：本地优先，不需要 WebSocket（未来可考虑 CRDT）
- 嵌入 Markdown：支持 `![[diagram.excalidraw]]` 在 Markdown 中内嵌显示
