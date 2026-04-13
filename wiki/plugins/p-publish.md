# Publish — 笔记发布为静态网站插件

> 选定笔记一键发布为博客或文档站。

## 基本信息

| 字段 | 值 |
|------|---|
| ID | `publish` |
| 类型 | 集成（Integration） |
| 来源 | 内置静态生成 + 部署 |
| 依赖 | 无额外依赖（可选 Vercel/Netlify CLI） |
| 状态 | 计划中 |

## 解决什么问题

用户在知识库中积累了大量内容，其中一部分希望公开分享（技术博客、学习笔记、项目文档）。目前需要手动复制到博客平台或维护另一个仓库。一键发布直接把知识库的子集变成网站。

## 功能

- **选择性发布**：通过 frontmatter `publish: true` 或选择目录来标记哪些笔记公开
- **静态生成**：Markdown → HTML，保留 WikiLink 为超链接
- **主题**：内置 2-3 个简洁主题（文档风、博客风、极简风）
- **自动部署**：生成后推送到 GitHub Pages / Vercel / Netlify
- **增量构建**：只重新生成变更的页面
- **元数据**：frontmatter 中的 `title`, `date`, `tags`, `description` 映射为 SEO meta

## 发布标记

```markdown
---
title: "如何搭建个人知识库"
publish: true
date: 2026-04-12
tags: [productivity, knowledge]
slug: how-to-build-pkm
---
```

## 部署方式

| 方式 | 成本 | 适合 |
|------|------|------|
| GitHub Pages | 免费 | 已有 GitHub 的开发者 |
| Vercel | 免费 | 需要自定义域名 |
| Netlify | 免费 | 需要自定义域名 |
| 本地导出 | 免费 | 自行部署 |

## 实施要点

- 生成到 `.mindos/publish/` 目录
- WikiLink 解析：`[[Page]]` → `<a href="/page">Page</a>`（仅已发布的页面）
- 图片处理：复制引用的图片到输出目录
- RSS 生成：可选输出 `feed.xml`
