# MindOS Plugins

MindOS 的插件分为三类：**转换器**（导入外部知识）、**渲染器**（交互式展示）、**集成**（连接外部工具）。

---

## 已实现 — 渲染器插件

匹配到特定文件名/扩展名时自动激活。

| 插件 | 触发文件 | 类型 | Core |
|------|---------|------|------|
| [Timeline](timeline.md) | `*CHANGELOG*`, `*timeline*`, `*journal*`, `*diary*` `.md` | 时间线 | No |
| [Workflow Runner](workflow-runner.md) | `*Workflow*.md` | AI 自动化 | No |
| [AI Briefing](ai-briefing.md) | `*DAILY*`, `*SUMMARY*`, `*BRIEFING*` `.md` | AI 摘要 | No |
| [Wiki Graph](wiki-graph.md) | 全局切换（不自动匹配） | 可视化 | No |
| [Backlinks Explorer](backlinks-explorer.md) | `*BACKLINKS*.md` | 引用分析 | No |

---

## 计划中 — 转换器插件（导入知识）

将外部文件/平台的内容转为 Markdown 导入知识库。

| 插件 | 说明 | 依赖 | 优先级 |
|------|------|------|--------|
| [MarkItDown](p-markitdown.md) | Word/PPT/Excel/EPUB 等 20+ 格式 → MD | Python `markitdown` | P0 |
| [Readwise Sync](p-readwise.md) | 阅读高亮和笔记同步 | Readwise API Token | P0 |
| [Notion Import](p-notion-import.md) | Notion 页面/数据库批量迁移 | 无 | P1 |
| [Obsidian Import](p-obsidian-import.md) | Obsidian vault 平滑迁移 | 无（compat 层部分完成） | P1 |
| [Browser Clipper](p-browser-clipper.md) | 浏览器扩展剪藏网页/选中文本 | Chrome/Firefox 扩展 | P1 |
| [Voice Memo](p-voice-memo.md) | 录音 → Whisper 转录 → MD | OpenAI API 或本地 whisper | P2 |

## 计划中 — 渲染器插件（展示和组织）

为特定文件格式提供交互式视图。

| 插件 | 说明 | 依赖 | 优先级 |
|------|------|------|--------|
| [Excalidraw](p-excalidraw.md) | 内嵌 `.excalidraw` 白板编辑 | `@excalidraw/excalidraw` npm | P0 |
| [Kanban](p-kanban.md) | Markdown 看板，拖拽排序写回文件 | 无 | P1 |
| [Calendar](p-calendar.md) | 日期文件名 → 月历视图 | 无 | P1 |
| [Mermaid Editor](p-mermaid.md) | Mermaid 分屏实时编辑器 | `mermaid` npm（已有） | P2 |
| [Dataview](p-dataview.md) | frontmatter 查询聚合视图 | 无 | P2 |

## 计划中 — 集成插件（连接外部工具）

将知识库与外部服务打通。

| 插件 | 说明 | 依赖 | 优先级 |
|------|------|------|--------|
| [Git Sync](p-git-sync.md) | 自动 commit + push 备份 | `git` CLI | P0 |
| [Publish](p-publish.md) | 笔记一键发布为静态网站 | 可选 Vercel/Netlify CLI | P1 |
| [Raycast](p-raycast.md) | macOS 全局快速搜索笔记 | Raycast | P2 |
| [Webhook](p-webhook.md) | 文件变更事件推送 | 无 | P2 |

---

## 概念

- **Core 插件**：不可被用户禁用，是文件类型的默认渲染器
- **App 内建能力**：同样由 renderer 实现，但不出现在插件管理面板（当前：TODO Board、CSV Views、Agent Inspector、Config Panel）
- **触发规则**：基于文件路径正则匹配，详见各插件 spec 的 `match` 字段
- **切换**：非 Core 插件可在 UI 中通过插件按钮切换为原始文本视图
- **入口文件**：`entryPath` 定义的文件会出现在首页快捷入口
- **转换器插件**：外部可选依赖，检测到已安装时自动启用，未安装时回退到内置转换逻辑，不影响 App 体积
- **集成插件**：通过 API/CLI 与外部服务通信，配置存储在 Settings 中

## 文件命名规范

- 已实现的渲染器插件：`<name>.md`（如 `timeline.md`）
- 计划中的新插件：`p-<name>.md`（如 `p-markitdown.md`）
