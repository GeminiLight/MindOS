<!-- Last verified: 2026-03-22 | Current stage: P1 -->

# 插件系统 (Stage: Plugins)

> 详见 [./02-system-architecture.md](./20-system-architecture.md) 的渲染器部分。

MindOS 内置渲染器插件体系，通过 `registerRenderer()` 注册，用户可在 Settings 中单独禁用。

---

## 面向人类的插件 (Human-Facing)

| 插件 | 触发文件 | 功能 |
|------|---------|------|
| TODO Board | `TODO.md/csv` | checkbox → 交互看板，按 `##` 分列，变更即时写回 |
| Wiki Graph | 任意 `.md` | WikiLink + Markdown Link → force-directed 图谱，Local/Global 范围 |
| Timeline | `CHANGELOG.md`, `TIMELINE.md` | 日期标题 → 竖向时间轴卡片，`#tag` 提取 |
| Backlinks | `BACKLINKS.md`, `index.md`, `MOC.md` | 全库扫描引用来源 + 上下文 snippet |
| AI Briefing | `DAILY.md`, `SUMMARY.md` | 最近修改 → AI 流式生成每日简报 |

## 面向 Agent 的插件 (Agent-Facing)

| 插件 | 触发文件 | 功能 |
|------|---------|------|
| Workflow Runner | `Workflow.md`, `SOP.md` | `## Step N` → 可执行步骤卡片，单步 Run/Skip |

## 应用内建能力（非插件面板）

| 能力 | 触发文件 | 功能 |
|------|---------|------|
| CSV Views | 任意 `.csv`（排除 TODO） | Table/Gallery/Board 视图；作为 MindOS 内建能力，不在插件面板管理 |
| Agent Inspector | `*.agent-log.json` | Agent 工具调用日志可视化；作为 MindOS 内建能力，不在插件面板管理 |
| Config Panel | `CONFIG.json` | 配置编辑面板；作为 MindOS 内建能力，不在插件面板管理 |

## 注册机制

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `name` | string | 显示名称 |
| `match` | `(ctx) => boolean` | 触发条件（filePath + extension） |
| `component` | React | 接收 `{ filePath, content, extension, saveAction }` |
| `builtin` | boolean | true = 内置 |
