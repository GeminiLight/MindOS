# TODO Board

> 将 TODO.md / TODO.csv 渲染为交互式看板。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `todo` |
| 图标 | ✅ |
| Core | Yes（不可禁用） |
| 入口文件 | `TODO.md` |
| 匹配规则 | `/\bTODO\b.*\.(md\|csv)$/i` |

## 文件格式

### Markdown 格式（TODO.md）

```markdown
# TODAY
- [x] 已完成的任务
- [ ] 待办任务
  - [ ] 子任务（缩进表示层级）

# BACKLOG
- [ ] 未来要做的事
- [ ] 另一个任务
```

- **H1 / H2 标题** → 看板的分组（section）
- **`- [ ]`** → 未完成项
- **`- [x]`** → 已完成项
- **缩进** → 子任务（层级嵌套）

### CSV 格式（TODO.csv）

标准 CSV，列名自由定义，插件会检测 `status` / `done` 等列。

## 交互功能

- ☑️ 点击 checkbox 切换完成状态（自动回写文件）
- ✏️ 双击任务文本 → 内联编辑
- ➕ "+ Add item" 按钮添加新任务
- 🗑️ 删除按钮移除任务
- 📊 每个 section 显示进度条（完成/总数）
- 📁 section 可折叠/展开

## 适用场景

- 项目 backlog 管理
- 每日 TODO 追踪
- 阶段性里程碑 checklist
