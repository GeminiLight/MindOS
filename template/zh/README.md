# My Mind

个人知识操作系统入口。用于索引你的核心目录，让 Agent 先理解结构再执行。

## 📁 目录结构

```bash
my-mind/
├── INSTRUCTION.md   # 全局规则（最高优先级）
├── README.md        # 根索引（本文件）
├── TODO.md          # 待办事项
├── CHANGELOG.md     # 完成记录（按日期倒序）
├── Profile/         # 个人身份、偏好、目标与当前状态
├── Notes/           # 快速记录与临时笔记
├── Connections/     # 人际关系上下文
├── Configurations/  # 环境配置与工具 SOP
├── Workflows/       # 工作流 SOP
├── Resources/       # 外部资源收藏（CSV）
└── Projects/        # 项目文档
```

## 💡 使用说明

- 启动时优先读取：`INSTRUCTION.md` -> `README.md`
- 新内容先记在 `Notes/`，稳定后归档到对应目录
- 需要持续更新的目录：`Profile/`、`Connections/`、`Projects/`

## 📐 更新规则

- 新增/删除/重命名一级目录后，必须同步更新本文件目录树
- 删除或重命名文件后，需同步更新所有引用路径
