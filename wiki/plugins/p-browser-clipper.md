# Browser Clipper — 浏览器剪藏插件

> 浏览器扩展，将网页内容、选中文本、标注一键保存到 MindOS 暂存台。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `browser-clipper` |
| 类型 | 转换器（Converter） |
| 来源 | Chrome / Firefox / Edge 扩展 |
| 依赖 | 浏览器扩展 + MindOS 本地服务 |
| 状态 | 计划中 |

## 解决什么问题

现有 URL clip 功能是服务端抓取，无法处理：
- 需要登录才能访问的页面（付费文章、内部文档、邮件）
- 只选中页面的一部分内容
- 在页面上做高亮标注后保存

浏览器扩展在客户端渲染后的 DOM 上操作，可以解决这些问题。

## 功能

- **整页剪藏**：一键保存当前页面为 Markdown
- **选中剪藏**：选中文本 → 右键 → 保存到 MindOS
- **高亮标注**：在页面上高亮文本 → 批量保存
- **自动元数据**：标题、URL、日期、作者自动提取到 frontmatter
- **快捷键**：`Cmd+Shift+S` 快速剪藏

## 架构

```
浏览器扩展
    │
    ├─ Content Script: 提取 DOM / 选中文本 / 高亮
    ├─ Popup: 预览 + 编辑 + 选择目标目录
    └─ Background: 调用 MindOS API
          │
          ▼
    POST /api/inbox { files: [...] }
          │
          ▼
    MindOS 暂存台
```

## 输出格式

```markdown
---
title: "How to Build a Second Brain"
url: https://example.com/article
clipped_at: 2026-04-12
author: Tiago Forte
---

# How to Build a Second Brain

> [!highlight]
> The value of a note is not in writing it down, but in finding it again.

The article discusses four key principles...
```

## 实施要点

- 浏览器扩展使用 Manifest V3
- 通信方式：直接调用 `localhost:<port>/api/inbox`
- 需要处理 MindOS 未运行时的优雅降级（队列 + 下次启动时导入）
- 支持 Readability 模式（去除广告/导航，只保留正文）
