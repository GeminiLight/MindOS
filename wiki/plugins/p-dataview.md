# Dataview — 元数据查询视图插件

> 基于 frontmatter 元数据的查询、聚合、表格展示。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `dataview` |
| 类型 | 渲染器（Renderer） |
| 触发文件 | Markdown 中的 ` ```dataview ` 代码块 |
| 依赖 | 无额外依赖 |
| 状态 | 计划中 |

## 解决什么问题

知识库到达 100+ 文件后，用户需要跨文件查询和聚合信息。比如"所有标记为 #project 且 status 为 active 的笔记"、"按创建时间排序的阅读笔记"。Obsidian Dataview 是最热门的插件之一（10M+ 下载），说明这是真实的强需求。

## 功能

- 查询语言：简化版 SQL-like 语法
- 数据源：frontmatter YAML + 文件元数据（创建时间、修改时间、文件大小、标签）
- 输出格式：表格 / 列表 / 任务列表
- 实时更新：文件变更后查询结果自动刷新

## 查询语法

```dataview
TABLE title, status, tags
FROM "Projects"
WHERE status = "active"
SORT modified DESC
LIMIT 10
```

```dataview
LIST
FROM #reading
WHERE rating >= 4
SORT date DESC
```

```dataview
TASK
FROM "Work"
WHERE !completed
GROUP BY priority
```

## 支持的字段

| 字段 | 来源 | 示例 |
|------|------|------|
| frontmatter 字段 | YAML | `title`, `status`, `rating`, `tags` |
| `file.name` | 文件系统 | 文件名 |
| `file.path` | 文件系统 | 完整路径 |
| `file.ctime` | 文件系统 | 创建时间 |
| `file.mtime` | 文件系统 | 修改时间 |
| `file.size` | 文件系统 | 文件大小 |
| `file.tags` | 内容解析 | 正文中的 `#tag` |

## 与 Obsidian Dataview 的关系

- 语法子集兼容：支持 `TABLE`, `LIST`, `TASK`, `FROM`, `WHERE`, `SORT`, `LIMIT`, `GROUP BY`
- 不支持 DataviewJS（安全考虑，不执行任意 JS）
- 不支持 inline fields（`key:: value` 语法），只用标准 frontmatter

## 实施要点

- 解析器：简单的 PEG 语法解析，不需要完整 SQL engine
- 索引：复用 MindOS 已有的文件元数据索引
- 性能：查询结果缓存 + 增量更新
