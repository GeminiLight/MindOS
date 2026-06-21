# Wiki 文档状态摘要

> Last verified: 2026-05-12 | Current version: v1.0.5

本文档汇总 wiki 文档的健康状态和清理记录。

---

## 文档健康总览

| 文档 | 状态 | 最后更新 | 说明 |
|------|------|----------|------|
| `20-system-architecture.md` | ✅ 准确 | 2026-05-10 | OpenCode 架构、78 个 API routes、65 个已迁移为 thin-adapter |
| `01-project-roadmap.md` | ✅ 准确 | 2026-05-10 | v0.1-v0.6 完成，v0.7+ 规划 |
| `85-backlog.md` | ✅ 准确 | 2026-05-10 | 所有条目已验证完成 |
| `90-changelog.md` | ✅ 准确 | 2026-05-10 | 完整变更记录 |
| `80-known-pitfalls.md` | ✅ 准确 | 2026-05-12 | 最新路径安全陷阱已记录 |
| `wiki/reviews/migration-completion-audit-2026-05-09.md` | ✅ 准确 | 2026-05-09 | v1/OpenCode 迁移完成审计 |
| `wiki/reviews/opencode-architecture-boundary-audit-2026-05-09.md` | ✅ 准确 | 2026-05-09 | 架构边界契约 |
| `wiki/specs/spec-opencode-remaining-alignment.md` | ✅ 准确 | 2026-04-30 | 剩余对齐工作 |
| `wiki/specs/spec-product-server-extraction.md` | ✅ 准确 | 2026-05-09 | Product Server 提取 |
| `wiki/specs/spec-bun-single-binary-runtime.md` | ✅ 准确 | 2026-05-12 | Bun 单二进制运行时 |
| `wiki/specs/spec-tauri-desktop-workflow.md` | ✅ 准确 | 2026-05-10 | Tauri Desktop 工作流 |

---

## 归档文档 (archive/)

以下文档已归档，保留历史参考：

| 原路径 | 归档路径 | 原因 |
|--------|----------|------|
| `wiki/archive/pi-migration-completed-v0.6.0.md` | `wiki/archive/pi-migration-completed-v0.6.0.md` | ✅ 已在 changelog v0.6.0 记录 |
| `wiki/archive/architecture-improvement-proposals.md` | `wiki/archive/architecture-improvement-proposals.md` | 所有 AIP 已完成或废弃 |
| `wiki/archive/architecture-summary-and-recommendations.md` | `wiki/archive/architecture-summary-and-recommendations.md` | 已被 `20-system-architecture.md` 替代 |
| `wiki/archive/implementation-roadmap.md` | `wiki/archive/implementation-roadmap.md` | 已被 `01-project-roadmap.md` 替代 |
| `wiki/archive/project-status-report.md` | `wiki/archive/project-status-report.md` | 旧状态报告，已过时 |
| `wiki/archive/task-spec-cli-ux.md` | `wiki/archive/task-spec-cli-ux.md` | CLI UX 已完成，规格已实现 |
| `wiki/archive/task-spec-mcp-skill-gui.md` | `wiki/archive/task-spec-mcp-skill-gui.md` | MCP Skill GUI 已完成 |
| `wiki/archive/wiki-audit-report-2026-03-22.md` | `wiki/archive/wiki-audit-report-2026-03-22.md` | 已被新的 audit 替代 |
| `wiki/refs/🤖\ pi\ coding\ agent.md` | `wiki/archive/pi-coding-agent-deprecated.md` | pi coding agent 已整合到主架构 |

---

## 已清理的过时文档

| 文档 | 清理原因 |
|------|----------|
| `wiki/99-wiki-update-summary-2026-03-26.md` | 已被 `wiki/reviews/v1-migration-status-2026-04-27.md` 和本次更新替代 |
| `wiki/WIKI-UPDATE-2026-03-26.md` | 已整合到本文档 |
| `wiki/WIKI-UPDATE-2026-03-30.md` | 已整合到本文档 |

---

## 当前架构要点 (快速参考)

### Package 结构
```
packages/
├── mindos/          # @geminilight/mindos 产品主包 (OpenCode-style)
│   ├── bin/        # CLI 入口
│   └── src/        # server/client/plugin/tool/session/agent + foundation/knowledge/protocols
├── web/            # Next.js 16 前端 (thin adapter over @geminilight/mindos/server)
├── desktop/        # Electron 桌面客户端
├── mobile/         # Expo 移动端
├── browser-extension/
├── desktop-tauri/  # Tauri spike
├── retrieval/      # MeiliSearch/LanceDB adapter (可选)
└── protocols/      # acp/mcp-server 外部协议
```

### API Route 状态 (78 总数)
- **65** 个已迁移为 Product Server thin-adapter
- **1** 个 canonical agent turn stream adapter (`/api/agent/sessions/:sessionId/turns`)
- **9** 个 optional-capability (import/export/extract/Obsidian/lint/inbox-clip)
- **3** 个 host-owned (auth, raw inbound IM/webhook)

### 关键已完成项
- ✅ OpenCode-style package 架构收敛
- ✅ Product Server route ownership 契约测试
- ✅ Desktop runtime 安全加固 (tar extraction, path safety)
- ✅ Bun single-binary runtime 安全加固
- ✅ Windows ARM64 + Linux deb 发布支持
- ✅ Optional local embedding runtime 分离

---

## 维护指南

### 更新文档时
1. 更新 `wiki/85-backlog.md` 记录新完成项
2. 更新 `wiki/90-changelog.md` 记录版本变更
3. 如有重大架构变更，更新 `wiki/20-system-architecture.md`
4. 如有过时文档，放到 `wiki/archive/` 并更新本摘要

### 新增规格文档时
- 放到 `wiki/specs/spec-*.md`
- 确保包含 Spec 模板的所有段落（目标、现状分析、数据流、方案、影响范围、边界 case、验收标准）
- 完成后将状态改为 ✅ 并移到 archive 或保留（取决于是否仍有参考价值）

---

*本文档由 wiki 清理流程生成，下次审查：2026-06-12*
