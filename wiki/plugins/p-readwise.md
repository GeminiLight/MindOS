# Readwise Sync — 阅读标注同步插件

> 将 Readwise / Reader 中的高亮、笔记、书签同步到 MindOS 知识库。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `readwise` |
| 类型 | 转换器（Converter） |
| 来源 | Readwise Official API |
| 依赖 | 无额外依赖（HTTP API 调用） |
| 状态 | 计划中 |

## 解决什么问题

开发者大量使用 Readwise / Reader 做阅读标注。这些高亮和笔记散落在 Readwise 云端，无法与本地知识库关联。同步后，阅读笔记可以被 AI Agent 检索、整理、引用。

## 功能

- 首次同步：全量拉取所有高亮和笔记
- 增量同步：基于 `lastUpdated` 只拉新增/修改
- 按书籍/文章分文件：每个来源生成一个 `.md`，包含元数据 frontmatter + 高亮列表
- 存放路径：`<Space>/Readwise/` 或用户自定义

## 输出格式

```markdown
---
title: "Thinking, Fast and Slow"
author: "Daniel Kahneman"
source: readwise
category: book
last_synced: 2026-04-12
---

# Thinking, Fast and Slow

## Highlights

> System 1 operates automatically and quickly, with little or no effort and no sense of voluntary control.
> — Location 142

**Note:** This is the core distinction of the whole book.

> Nothing in life is as important as you think it is, while you are thinking about it.
> — Location 4021
```

## API

- Readwise API: `https://readwise.io/api/v2/`
- 需要用户提供 API Token（Settings 面板配置）
- Rate limit: 240 req/min

## 实施要点

- 在 Settings 中新增 Readwise Token 配置项
- 提供手动同步按钮 + 可选定时同步（每日）
- 冲突处理：以 Readwise 为源，本地修改不回写
