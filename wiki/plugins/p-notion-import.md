# Notion Import — Notion 数据迁移插件

> 将 Notion 数据库和页面批量导入为 Markdown 文件。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `notion-import` |
| 类型 | 转换器（Converter） |
| 来源 | Notion Export ZIP / Notion API |
| 依赖 | 无额外依赖 |
| 状态 | 计划中 |

## 解决什么问题

从 Notion 迁移到本地知识库是常见需求。但 Notion 导出的 ZIP 格式有很多问题：文件名含 UUID 后缀、嵌套目录结构混乱、图片路径断裂、数据库导出为 CSV 而非 Markdown 表格。需要清洗和重组。

## 功能

- 支持 Notion 导出的 ZIP 文件直接拖入暂存台
- 自动清理文件名（去除 UUID 后缀如 `Meeting Notes abc123def.md` → `Meeting Notes.md`）
- 修复内部链接（Notion 的相对链接 → MindOS WikiLink）
- 数据库 CSV → Markdown 表格或独立 `.csv` 文件
- 图片提取并存放到 `assets/` 目录
- 保留 Notion 的层级结构映射为目录

## 处理流程

```
Notion Export.zip
    │
    ▼
解压 → 遍历文件
    │
    ├─ .md → 清理文件名 + 修复链接 + 提取 frontmatter
    ├─ .csv → 转为 Markdown 表格或保留 CSV
    ├─ 图片 → 移到 assets/ + 更新引用路径
    └─ 其他 → 保留原样
    │
    ▼
写入知识库目录
```

## 实施要点

- P0：ZIP 文件解析 + 文件名清洗 + 基本导入
- P1：内部链接修复 + 图片处理
- P2：Notion API 直连（无需手动导出）
