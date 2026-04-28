# Kanban — 通用看板插件

> 将 Markdown 列表渲染为可拖拽的看板视图，变更实时写回文件。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `kanban` |
| 类型 | 渲染器（Renderer） |
| 触发文件 | `*kanban*.md`, `*board*.md` |
| 依赖 | 无额外依赖 |
| 状态 | 计划中 |

## 与现有 TODO Board 的区别

| | TODO Board | Kanban |
|--|-----------|--------|
| 触发 | `TODO.md` / `TODO.csv` | 任意 `*kanban*` / `*board*` 文件 |
| 列定义 | `## heading` 固定分列 | 自定义列名 + 颜色 |
| 拖拽 | 无 | 跨列拖拽 + 排序 |
| 元数据 | checkbox 状态 | 标签、截止日期、指派人 |
| 定位 | 任务管理 | 通用看板（项目管理、内容规划、CRM） |

## 文件格式

```markdown
---
kanban-plugin: true
columns:
  - name: Backlog
    color: gray
  - name: In Progress
    color: amber
  - name: Done
    color: green
---

## Backlog

- [ ] 调研竞品定价策略 #research @alice due:2026-04-15
- [ ] 写 landing page 文案

## In Progress

- [ ] 实现用户注册流程 #dev @bob

## Done

- [x] 设计数据库 schema #dev
- [x] 部署 staging 环境 #ops
```

## 交互

- 拖拽卡片跨列移动 → 自动更新 `## heading` 归属
- 拖拽排序 → 更新列表顺序
- 点击卡片 → 展开编辑（标题、描述、标签、日期）
- 新建卡片 → 追加到列末尾
- 所有变更实时写回 `.md` 文件
