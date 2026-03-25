# MindOS Plugins

MindOS 内置 6 个可管理渲染器插件，每个插件在匹配到特定文件名/扩展名时自动激活，将纯文本/JSON 渲染为交互式 UI。

## 插件列表

| 插件 | 触发文件 | 类型 | Core |
|------|---------|------|------|
| [TODO Board](todo-board.md) | `*TODO*.md`, `*TODO*.csv` | 任务管理 | Yes |
| [Timeline](timeline.md) | `*CHANGELOG*`, `*timeline*`, `*journal*`, `*diary*` `.md` | 时间线 | No |
| [Workflow Runner](workflow-runner.md) | `*Workflow*.md` | AI 自动化 | No |
| [AI Briefing](ai-briefing.md) | `*DAILY*`, `*SUMMARY*`, `*BRIEFING*` `.md` | AI 摘要 | No |
| [Wiki Graph](wiki-graph.md) | 全局切换（不自动匹配） | 可视化 | No |
| [Backlinks Explorer](backlinks-explorer.md) | `*BACKLINKS*.md` | 引用分析 | No |

## 概念

- **Core 插件**：不可被用户禁用，是文件类型的默认渲染器
- **App 内建能力**：同样由 renderer 实现，但不出现在插件管理面板（当前：CSV Views、Agent Inspector、Config Panel）
- **触发规则**：基于文件路径正则匹配，详见各插件 spec 的 `match` 字段
- **切换**：非 Core 插件可在 UI 中通过插件按钮切换为原始文本视图
- **入口文件**：`entryPath` 定义的文件会出现在首页快捷入口
