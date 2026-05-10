# Wiki 文档审查报告

> 日期：2026-05-10
> 审查范围：`wiki/`、`docs/`、`README.md`、`README_zh.md`
> 当前代码库版本：**v1.0.3**（git tag `v1.0.3`，2026-05-10）

---

## 一、版本号断代问题

### 问题 1.1：大量 wiki 文档仍使用旧版本号（v0.6.x 系列）

项目已升级到 **v1.0.3**，但以下文档 header 仍标注旧版本：

| 文件 | Header 版本 | 与当前差距 |
|------|------------|-----------|
| `wiki/90-changelog.md` | `v0.6.82` | 落后于 v1.0.3 |
| `wiki/01-project-roadmap.md` | `v0.6.39` | 落后于 v1.0.3 |
| `wiki/20-system-architecture.md` | `v0.6.39` | 落后于 v1.0.3 |

**根本原因**：项目在 v0.6.x 后切换到了 v1.x 语义版本，但这些文档从未更新过 header。

### 问题 1.2：CHANGELOG 版本断档

`wiki/90-changelog.md` 标注：

> **未发布 (v0.6.8 - v0.6.65)**
> **注**：v0.6.8 ~ v0.6.65 的 58 个版本需要补充详细 changelog。当前文档涵盖关键改动，完整历史见 git tags。

**建议**：更新 `wiki/90-changelog.md` 的 header 为 `v1.0.3`，并补充 v0.6.82 到 v1.0.3 之间的 changelog，或者明确标注自哪个版本开始记录。

---

## 二、API Route 数量不一致

### 问题 2.1：Route 计数统计有误

| 来源 | 数字 | 说明 |
|------|------|------|
| `wiki/20-system-architecture.md` | 65 | "API Routes (65)" |
| `wiki/reviews/migration-completion-audit-2026-05-09.md` | 78 | "Current `packages/web/app/api/**/route.ts` count: 78" |

**分析**：审计文档明确指出总 route 数为 78，其中 65 个已迁移为 thin adapters。架构文档的 65 应为"已迁移 thin adapter"数量，不是总数量。

**建议**：更新 `wiki/20-system-architecture.md` 的 API Routes 表头或说明，区分"总 route 数"与"已迁移 Product Server 路由数"。

---

## 三、Agent 数量不一致

### 问题 3.1：多处文档 Agent 计数不同

| 来源 | 数字 | 说明 |
|------|------|------|
| `wiki/20-system-architecture.md` | 26 | "当前支持 26 个 Agent" |
| `wiki/85-backlog.md` | 31+ | ACP 注册表 "31+ 个 ACP Agent 可用" |
| `docs/en/supported-agents.md` | 26 | 总计 26 个（含 Early Support） |
| `docs/zh/supported-agents.md` | 26 | 同上 |

**分析**：
- 26 是 MCP Agent 列表的总数
- 31+ 是 ACP 协议注册表的 Agent 数量（两个独立计数）
- `wiki/20-system-architecture.md` 说 "31+ 个 ACP Agent 可用" 但前文说 "26 个 Agent"——两个数字混用导致歧义

**建议**：在 `wiki/20-system-architecture.md` 中明确区分：
- MCP Agent 支持数：26 个
- ACP 注册表 Agent 数：31+ 个

---

## 四、Renderer 插件数量过时

### 问题 4.1：Plugin 渲染器数量说法不一

| 来源 | 数量 | 说明 |
|------|------|------|
| `wiki/20-system-architecture.md` | 14 | change-log、workflow-yaml 等已列入 |
| `wiki/01-project-roadmap.md` | 11 | 仍停留在 v0.6 阶段 |
| `wiki/60-stage-plugins.md` | 11 | 同上 |

**分析**：架构文档已更新到 14 个渲染器，但路线图和插件架构文档仍停留在 11 个（v0.6 阶段）。

**建议**：更新 `wiki/01-project-roadmap.md` 和 `wiki/60-stage-plugins.md` 的渲染器数量至 14。

---

## 六、Backlog "Next" 区混淆

### 问题 6.1：Backlog 的 "Next" 段落实际已全部完成

`wiki/85-backlog.md` 结构为：

```
## Completed
- [x] ... (2026-05-10 最新完成项)

## Next
- [x] 设置页 Obsidian 插件迁移向导...
```

"Next" 段落下的所有条目都标记为 `[x]`（已完成），没有任何 `[-]` 或空标记表示真正的待办项。

**分析**：这是 backlog 文件的正常状态（历史积累），不是错误，但需注意"Next"标题具有误导性。

**建议**：考虑将 "## Next" 重命名为 "## Also Completed" 或按时间分组，避免用户误以为还有未完成项。

---

## 七、过 spec 引用已移除的 Package

### 问题 7.1：旧 spec 仍引用 transitional package 路径

| 文件 | 问题 |
|------|------|
| `wiki/specs/spec-rn-phase0-monorepo-shared-packages.md` | 引用 `packages/foundation/shared`（已在 v1 内聚中移除） |
| `wiki/specs/spec-knowledge-operation-kernel-permissions.md` | 引用 `packages/foundation/permissions`、`packages/knowledge/audit`（已内聚） |

**分析**：这两个 spec 都有"2026-04-28 状态更新"声明 transitional 状态，内容已过时但文件本身有存档价值（记录迁移决策过程）。

**建议**：无需修改内容（文件已有自标识 transitional 说明），在 `wiki/specs/` 列表或 README 中可考虑标注"已归档/过时"标记。

---

## 八、OpenCode 架构边界文档一致性 ✅

`wiki/reviews/opencode-architecture-boundary-audit-2026-05-09.md` 与 `wiki/reviews/migration-completion-audit-2026-05-09.md` 保持一致，两个文件互相印证，架构描述无冲突。

---

## 九、README 与 README_zh.md 一致性 ✅

两文件内容结构完全一致，功能列表、Agent 数量（26）、项目架构描述均对齐，未发现冲突。

---

## 十、docs/ 文档验证

### 10.1 CLI Commands — `packages/mindos/bin/` 路径说明

`docs/en/cli-commands.md` 第 55 行说明：

> The MCP server source of truth is `packages/mindos/src/protocols/mcp-server`; packaged installs use the prebuilt `dist/protocols/mcp-server/index.cjs` bundle inside the MindOS runtime package.

**状态**：正确，与当前架构一致。

### 10.2 Supported Agents — Agent 数量

`docs/en/supported-agents.md` 和 `docs/zh/supported-agents.md` 列出 26 个 Agent，与 `wiki/20-system-architecture.md` 的 "26 个 Agent" 数字一致。

**注意**：但 `wiki/20-system-architecture.md` 表格列出的是 26 个 MCP Agent 分类（MindOS、Claude Code、...、Hermes），而 `docs/supported-agents.md` 分类方式不同（CLI/Terminal、IDE/Editor、VS Code Extension、Early Support），两者的分类结果数量一致但分组不同，无冲突。

---

## 总结

| 优先级 | 问题 | 建议操作 |
|--------|------|----------|
| **高** | 大量 wiki 文档版本号停留在 v0.6.x（当前 v1.0.3） | 更新 `wiki/01-project-roadmap.md`、`wiki/20-system-architecture.md`、`wiki/90-changelog.md` 的 header |
| **高** | API Route 数量歧义（65 vs 78） | 架构文档区分"总 route 数"与"已迁移数" |
| **中** | 渲染器数量（路线图/插件文档 11 vs 架构 14） | 更新 `wiki/01-project-roadmap.md` 和 `wiki/60-stage-plugins.md` |
| **中** | Changelog v0.6.8~v0.6.65 版本断档 | 添加明确说明 |
| **低** | Backlog "Next" 标题误导 | 重命名为 "Also Completed" |
| **低** | 过 spec 自标识不明确 | 考虑在 wiki/specs 列表加"已归档"标注 |

**整体评价**：Wiki 文档质量较高，主要问题是版本号追踪不够严格（多次发版后未同步更新所有文档 header），以及个别统计数字在引用时未加说明导致歧义。无发现严重的逻辑冲突或错误信息。
