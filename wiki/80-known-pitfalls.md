<!-- Last verified: 2026-04-28 | Current stage: v1 release-candidate -->

# 踩坑记录 (Known Pitfalls)

本文件是已知问题入口索引。原 4000+ 行内容已按主题拆到 `wiki/known-pitfalls/`，避免单文件过大；引用本入口的 AGENTS / wiki / code comment 仍然有效。

## 使用方式

- Code review 时先从下表进入相关主题文件；不确定归属时用 `rg "关键词" wiki/known-pitfalls wiki/80-known-pitfalls.md`。
- 新增具体坑优先写入对应主题文件，并在本索引的表格说明里保持主题覆盖准确。
- 本入口只放导航和维护规则，避免重新膨胀成超长单文件。

## 主题分卷

| 主题 | 文件 | 覆盖章节 |
| --- | --- | --- |
| 平台路径 / 迁移 / API | [01-platform-migration-api.md](known-pitfalls/01-platform-migration-api.md) | `Cross-platform path safety` / `v1 Monorepo Migration` / `Git / 双仓同步` / `Agent / LLM API` / `CLI` |
| 前端 / MCP / Ask / 进程 | [02-frontend-mcp-ask-process.md](known-pitfalls/02-frontend-mcp-ask-process.md) | `前端` / `MCP` / `Agent (Ask Modal)` / `架构 & 设计模式` / `进程生命周期` |
| 构建 / Desktop / Sync / 依赖 | [03-build-desktop-sync-deps.md](known-pitfalls/03-build-desktop-sync-deps.md) | `构建 / 部署` / `Desktop / Tauri` / `变更质量 checklist（通用）` / `云同步 (Sync)` / `依赖版本` / `架构 & 设计模式` / `Electron / 桌面端` / `Ask AI / @ Mention` / `构建优化 / Bundle Size` |
| UI / 性能 / 安全硬化 | [04-ui-performance-security.md](known-pitfalls/04-ui-performance-security.md) | `UI / 前端交互` / `Agent 重试 / Retry` / `性能 / Performance` |
| 发布 / CI / 平台打包 | [05-release-ci-platform-packaging.md](known-pitfalls/05-release-ci-platform-packaging.md) | `npm 发布流程安全加固（长期方案）` / `Desktop / Electron` / `性能优化` / `CI / Release` |
| Echo / 人机共演化 | [06-echo-coevolution.md](known-pitfalls/06-echo-coevolution.md) | 只读画布交互、手机可见边界、任务标准覆盖、撤销与证据、隔离验证 |

## 维护规则

- 具体 bug/pitfall 条目继续使用原格式：症状、根因、修复、防回归。
- 单个主题文件接近 1000 行时优先继续按子域拆分；源码、测试、脚本和文档文件不得超过 3000 行（生成物、lockfile、自动生成快照除外）。
- 如果同一个坑跨多个主题，只在最主要主题落正文，其他主题用短链接指向，避免重复维护。
