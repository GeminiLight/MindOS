---
name: project-wiki
description: "组织和维护 Vibe Coding 项目的 wiki 文档体系。当用户要求初始化/重构 wiki 结构、进入新项目且 wiki/ 不存在、需要诊断和修复文档腐化、或需要管理 specs/refs/reviews 子目录的生命周期时触发。"
---

# Project Wiki Skill

为 Vibe Coding 项目（人类描述意图，Agent 写代码）生成和维护结构化 wiki。wiki 是 Agent 的输入物料，直接决定输出质量。

---

## 执行流程

### 初始化（wiki/ 不存在或为空）

1. **扫描** `wiki/` 目录，列出已有文件
2. **对照必要文件清单**（见下方"文件体系"），识别缺失项
3. **与用户确认**将要创建的文件列表
4. **生成骨架**：从本 Skill 的 `assets/` 目录读取对应模板，填入用户上下文（不确定的部分留 `<!-- TODO: ... -->` 占位）
5. **更新导航**：如已有 `01-project-roadmap.md`，追加新阶段索引行
6. **标记新鲜度**：每个生成的文件头部加 `<!-- Last verified: YYYY-MM-DD | Current stage: X -->`
7. **注入维护规则**：将下方"日常维护规则"章节的内容追加到项目 `CLAUDE.md`（已有则合并差异，不替换整个文件）。这一步不能跳过——wiki 的日常同步依赖这些规则写入 CLAUDE.md

### 重构 / 更新（wiki/ 已有文件）

1. **扫描** `wiki/` 下所有文件和子目录，检查编号方案（紧凑 or 展开）、新鲜度标记
2. **诊断**：
   - 缺编号前缀？信息重叠？已完结 stage 未归档？内容与代码不一致？
   - **膨胀检测**：stage 文件超 300 行、其他文件超 500 行 → 建议拆分
   - **散落文件**：wiki 根目录中不属于任何编号区段的文件（如 `ui-audit-*.md`）→ 建议归入合适的子目录（`reviews/`）或运维区段（`8x`）
   - **命名一致性**：`specs/` 下混有 `task-spec-*` 和 `spec-*` → 不强制迁移，但新建一律用 `spec-*`；spec 散落在 wiki 根目录 → 建议迁入 `specs/`
   - **自定义子目录**：识别 `plugins/`、`images/` 等项目特有目录，标记为已知自定义目录，不报为异常
3. **生成改动清单**（重命名 / 合并 / 拆分 / 归档 / 迁移 / 更新内容），与用户确认
4. **执行改动**
5. **验证一致性**：文件间引用链接有效、roadmap 索引与实际文件对应
6. **检查维护规则**：确认项目 `CLAUDE.md` 中已有 wiki 维护规则，缺失则追加（不替换整个文件）

---

## 文件体系

### 编号体系

编号按**"战略 → 架构 → 规范 → 阶段 → 运维 → 日志"**分层。根据项目规模选择紧凑或展开方案：

**紧凑方案**（≤5 个 stage，适合多数项目）：

```
wiki/
├── 00-product-proposal.md
├── 01-project-roadmap.md
├── 02-system-architecture.md       # 紧凑方案用 0x 统一放战略+架构
├── 03-design-principle.md
├── 04-api-reference.md
├── 1x  阶段 Stages
│   ├── 10-stage-a.md
│   ├── 11-stage-b.md ...
├── 80-known-pitfalls.md
├── 85-backlog.md
├── 90-changelog.md
├── specs/ · refs/ · reviews/ · archive/
```

**展开方案**（>5 个 stage 或需要更多分层空间）：

```
wiki/
├── 0x  战略 Strategy       — 全局视角
│   ├── 00-product-proposal.md
│   ├── 01-project-roadmap.md
│   ├── 02-business-model.md
│   └── 03-technical-pillars.md
├── 2x  架构 Architecture   — 系统是怎么建的
│   ├── 20-system-architecture.md
│   └── 21-design-principle.md
├── 3x  接口 API
│   └── 30-api-reference.md
├── 4x  规范 Conventions
│   ├── 40-conventions.md
│   └── 41-dev-pitfall-patterns.md
├── 6x  阶段 Stages         — 各阶段详细 spec
│   ├── 60-stage-a.md ...
├── 8x  运维 Operations
│   ├── 80-known-pitfalls.md
│   ├── 81-postmortem-*.md
│   ├── 84-design-exploration.md
│   └── 85-backlog.md
├── 9x  日志 Log
│   └── 90-changelog.md
├── specs/ · refs/ · reviews/ · archive/
```

**选择规则：** 初始化时问用户，或根据已有文件自动识别。两种方案的文件内容和模板完全相同，只是编号前缀不同。关键是**一个项目内保持一致**，不混用。

**项目特有子目录：** wiki 可能出现 skill 未预设的子目录（如 `plugins/`、`images/`），这是正常的项目演化。扫描时将它们识别为"自定义目录"，不报为异常，不强制重命名。

### 核心模型：Why / What / How / Look × 全局 / 阶段

| | 全局（稳定，新阶段才改） | 阶段（增量更新） |
|---|---|---|
| **Why** | `product-proposal` | — |
| **What** | `project-roadmap` — 功能索引 | `stage-X` — 设计决策 |
| **How** | `system-architecture` — 架构 + 类型 | `stage-X` — API、数据模型、受影响文件 |
| **Look** | `design-principle` — 视觉语言 | — |

**关键规则：** stage 文件同时包含 What 和 How。一个功能的设计决策、API 契约、数据模型放在一个文件里。全局文件只做索引和导航，不重复 stage 的细节。

### 规划层级

| | Roadmap (`01`) | Backlog (`85`) |
|---|---|---|
| 时间跨度 | 月 / 季度级 | 周 / 迭代级 |
| 粒度 | 方向、里程碑、大功能 | 具体任务、bug、小需求 |
| 回答 | 我们要去哪里？ | 下一步做什么？ |

**使用时机：** 开始任务前先对照 roadmap 确认阶段匹配，再从 backlog 取具体任务执行。任务完成后在 backlog 打勾，发版时从已完成条目整理写入 changelog。

### 必要文件（第一梯队）

| 编号 | 文件 | 写给谁 | 核心内容 |
|------|------|--------|---------|
| 00 | `product-proposal.md` | Agent + 你 | 产品愿景、产品定位、**不做什么**、目标用户、功能矩阵、路线图叙事 |
| 01 | `project-roadmap.md` | Agent + 你 | 阶段总览表、全量功能索引（功能×状态×stage链接）、里程碑 |
| 20 | `system-architecture.md` | Agent | 技术栈、目录结构、数据流、核心类型、环境变量（300-500 行） |

### 按需文件（第二梯队）

| 编号 | 文件 | 何时需要 |
|------|------|---------|
| 02 | `business-model.md` | 有商业化/变现需求时 |
| 03 | `technical-pillars.md` | 有明确的技术壁垒或研究方向时 |
| 21 | `design-principle.md` | 有自定义视觉语言时（非默认 UI 库样式） |
| 30 | `api-reference.md` | API 超过 5 条路由，或 stage 归档后仍需查 API 细节 |
| 40 | `conventions.md` | 有明确的编码偏好/约束（库选择、命名、错误处理模式等） |
| 41 | `dev-pitfall-patterns.md` | 踩坑积累到需要系统性记录时 |
| 6X | `stage-X.md` | 功能复杂度超过一句话能说清（150-300 行） |
| — | `specs/spec-{name}.md` | 小功能 / 改进点的 spec；完成后移入 `archive/specs/` |
| — | `refs/ref-{topic}.md` | 外部机制调研、技术选型对比、第三方 API 文档摘要 |
| — | `reviews/review-{date}-{subject}.md` | 代码审查、spec 评审、设计评审的结论与 action items |
| 80 | `known-pitfalls.md` | 踩坑即记，不等阶段结束 |
| 81 | `postmortem-*.md` | 多个 bug 互相关联、暴露系统性问题时（单点问题用 pitfalls，系统性问题用 postmortem） |
| 84 | `design-exploration.md` | 有 UI 设计探索、原型记录等创意过程产物时 |
| 85 | `backlog.md` | 有临时 bug、技术债、改进想法需要追踪时 |
| 90 | `changelog.md` | 发版时从 `85-backlog.md` 已完成条目整理写入，面向用户描述变更，不记内部实现细节 |

> 每个文件的详细说明和"为什么需要"的论证见 `references/file-reference.md`。

### Stage 文件生命周期

阶段完全交付且后续阶段不再引用其 API/数据模型时 → 移入 `wiki/archive/`，`01-project-roadmap.md` 中保留索引行并标注 `[archived]`。

**归档判断标准：** 同时满足以下两条才归档：① 该 stage 已完结超过一个阶段；② 当前及未来 stage 文件中无对它的跨引用。不确定时保留，宁可冗余不要断链。

### 子目录管理

四个子目录各有独立的命名规范、生命周期和归档规则。

#### specs/ — 任务规格

活跃的功能 spec，是比 stage 文件更细粒度的任务描述。

| 项目 | 规则 |
|------|------|
| 命名 | `spec-{feature-name}.md`（推荐）。历史遗留的 `task-spec-*.md` 也可接受，不强制迁移 |
| 位置 | 放在 `wiki/specs/` 下。发现散落在 wiki 根目录的 spec → 重构时提示迁入 `specs/` |
| 创建时机 | 功能复杂度介于"backlog 一行"和"stage 文件一整章"之间 |
| 内容 | 背景、目标、边界、验收标准、受影响文件列表 |
| 归档 | 实现完成 → 移入 `archive/specs/`，backlog 对应项打勾 |
| 状态追踪 | **位置即状态**：在 `specs/` = 活跃，在 `archive/specs/` = 完成。无需维护 Status 头标记 |

#### refs/ — 参考资料

外部知识的内部镜像——第三方 API 行为、协议格式、技术选型调研等。

| 项目 | 规则 |
|------|------|
| 命名 | 描述性文件名即可（如 `git-sync-workflow.md`、`npx-skills-mechanism.md`）。`ref-` 前缀可选 |
| 创建时机 | 外部知识在 2+ 个文件/对话中被重复查阅 |
| 内容 | 机制说明、关键 API 摘要、与本项目的集成点、踩坑备注 |
| 归档 | 不主动归档；集成方案废弃时标记 `<!-- Deprecated: YYYY-MM-DD | Reason -->` |
| 引用 | stage/spec 中通过 `→ 详见 [refs/xxx.md](./refs/xxx.md)` 链接，不复制内容 |

#### reviews/ — 评审记录

代码审查、spec 评审、设计评审的结论存档。

| 项目 | 规则 |
|------|------|
| 命名 | `review-{YYYY-MM-DD}-{subject}.md`（如 `review-2026-03-18-auth-spec.md`） |
| 创建时机 | spec 评审完成后、重大代码变更 review 后、设计方案评审后 |
| 内容 | 评审对象（链接到 spec/PR）、结论（通过/修改/拒绝）、action items、遗留讨论点 |
| 归档 | action items 全部完成 → 移入 `archive/reviews/` |
| 联动 | 创建 review 后，在对应 spec 头部追加 `<!-- Reviewed: YYYY-MM-DD → reviews/review-xxx.md -->` |

#### archive/ — 归档目录

已完结文档的长期存储。保留完整历史以便溯源，但不污染活跃目录。

```
archive/
├── specs/      — 已完成的 spec（保留原文件名）
├── reviews/    — 历史评审
└── stages/     — 已归档的 stage 文件
```

| 规则 | 说明 |
|------|------|
| 归档操作 | `git mv wiki/specs/spec-xxx.md wiki/archive/specs/` |
| 原位留痕 | 在 `01-project-roadmap.md` 或 `85-backlog.md` 中标注 `[archived → archive/specs/spec-xxx.md]` |
| 引用不断链 | 归档后全文搜索旧路径（`grep -r "specs/spec-xxx" wiki/`），更新所有引用指向 `archive/` 下的新路径 |
| 不删除 | archive 目录下的文件只做追加和查阅，不删除 |

---

### 渐进式披露

wiki 文件按三层加载，避免 Agent 一次读入全部内容导致上下文浪费。

#### 第一层：索引（始终可用）

Agent 进入项目时只读两个文件，建立全局心智模型：

```
00-product-proposal.md  → 知道"做什么、不做什么"
01-project-roadmap.md   → 知道"当前在哪个阶段、有哪些功能"
```

roadmap 中每行功能附带链接，Agent 根据当前任务决定是否深入。

#### 第二层：结构（按场景加载）

根据任务类型，Agent 按需加载对应的结构文件：

| 任务类型 | 加载文件 | 不加载 |
|---------|---------|--------|
| 新功能开发 | `system-architecture` → 当前 stage → 相关 `specs/` | 其他 stage、refs、reviews |
| 修 Bug | `system-architecture` → `known-pitfalls` → 相关 stage | 战略文件、无关 stage |
| UI 调整 | `design-principle` → `system-architecture`（目录部分） | stage 文件（除非涉及功能逻辑） |
| 技术调研 | `refs/{topic}` → `system-architecture`（集成点） | spec、review |
| 评审 | 对应 `specs/` → 相关 `refs/` → `conventions` | 不相关的 stage |

#### 第三层：细节（按需钻取）

Agent 只在以下信号出现时才读取更深层文件：

- stage 文件中写了 `→ 详见 refs/ref-xxx.md` → 加载该 ref
- spec 头部有 `<!-- Reviewed: ... -->` → 加载该 review 查看历史决策
- pitfalls 中提到 `→ 复盘见 81-postmortem-xxx.md` → 加载该 postmortem
- backlog 中有 `[archived → archive/specs/spec-xxx.md]` → 需要溯源时加载

**关键原则：** 不主动扫描子目录。索引文件（roadmap、backlog）中的链接是唯一的"入口导航"。

---

### 关联管理

wiki 文件之间存在引用依赖。一个文件变更后，引用它的文件可能需要同步更新。这套规则帮助 Agent 追踪和维护这些关联。

#### 引用语法

文件间引用统一使用相对路径 + 锚点：

```markdown
→ 详见 [20-system-architecture.md](./20-system-architecture.md#数据流)
→ 详见 [refs/ref-stripe-webhook.md](./refs/ref-stripe-webhook.md)
→ 归档于 [archive/specs/spec-auth.md](./archive/specs/spec-auth.md)
```

#### 依赖图（哪些文件引用谁）

| 被引用文件 | 典型引用者 | 变更时需检查 |
|-----------|-----------|------------|
| `00-product-proposal` | roadmap、stage 文件 | 产品方向变更 → 检查所有 stage 的"背景"段 |
| `20-system-architecture` | 所有 stage、所有 spec | 架构变更 → `grep -r "system-architecture" wiki/` 检查引用 |
| `21-design-principle` | 前端相关 stage、spec | 新增 token → 检查现有组件是否需要适配 |
| `refs/ref-*` | 引用该外部系统的 stage/spec | 外部 API 更新 → 沿引用链更新所有消费方 |
| `specs/spec-*` | backlog（索引）、reviews（评审） | spec 完成 → 更新 backlog 状态、归档 spec |

#### 变更联动 Checklist

Agent 修改 wiki 文件时，执行以下检查：

```
修改文件 X
  → grep -r "X" wiki/        # 找到所有引用 X 的文件
  → 逐一检查：引用的信息是否仍然准确
  → 不准确 → 更新引用方（或在引用旁加 <!-- May be outdated -->）
```

**特别注意的高频联动：**
- 重命名/移动文件 → 全文搜索旧路径，更新所有引用
- stage 归档 → 更新 roadmap 索引行、更新 backlog 对应条目
- spec 完成 → 更新 backlog 打勾、移入 archive、检查 review 中的 action items

#### 腐化检测

每个阶段开始时（或触发重构流程时），Agent 执行一次完整性扫描：

1. **断链检测**：`grep -rn '\./[a-z].*\.md' wiki/` 检查所有相对路径引用目标是否存在
2. **新鲜度检查**：扫描所有 `<!-- Last verified: YYYY-MM-DD -->` 标记，超过 30 天未验证的标记为 `<!-- May be outdated -->`
3. **孤立文件检测**：`refs/` 和 `specs/` 下的文件如果没有被任何其他 wiki 文件引用 → 提示用户：是否需要归档或删除？
4. **重复信息检测**：同一概念在两个文件中都有段落级展开 → 提示合并，保留一个权威源，另一个改为引用链接
5. **膨胀检测**：`wc -l wiki/*.md wiki/**/*.md` → stage >300 行、其他 >500 行的文件列出，建议拆分
6. **散落文件**：wiki 根目录中不匹配编号体系的 `.md` 文件（如审计报告、临时笔记）→ 建议迁入合适子目录
7. **命名迁移**：`specs/` 中 `task-spec-*` 和 `spec-*` 混用 → 提示但不强制（新建一律用 `spec-*`）

检测完成后，输出**汇总表**（检查项 × 严重程度 × 发现数）和**优先建议**（按严重程度排序，每条含具体操作步骤）。用户看完报告应清楚"先做哪个、怎么做"。

---

## Agent 阅读顺序（渐进式）

第一层（必读）：`00-product-proposal` → `01-project-roadmap`（定位当前阶段）

第二层（按任务加载）：

| 场景 | 路径 |
|------|------|
| 新对话 / 新功能 | `system-architecture` → 当前 stage → 相关 `specs/` |
| 修 Bug | `system-architecture` → `known-pitfalls` → 相关 stage |
| 修 Bug（反复出现） | `postmortem-*` → `system-architecture` → `known-pitfalls` → 相关 stage |
| UI 调整 | `design-principle` → `system-architecture`（目录结构）→ 相关组件 |
| 了解全貌 | `product-proposal` → `project-roadmap` → `system-architecture` |
| 技术调研 | 相关 `refs/*` → `system-architecture`（集成点部分） |
| 评审任务 | 对应 `specs/*` → `conventions` → 相关 `refs/` |

第三层（按引用钻取）：文件中出现 `→ 详见 xxx` 链接时才加载目标文件。不主动扫描子目录。

---

## 文档编写规范

1. **写给 Agent 的文档用结构化格式。** 表格 > 段落，代码块 > 文字描述，类型定义 > 自然语言。
2. **写给自己的文档记决策不记细节。** "为什么选 X 不选 Y" > "X 的安装命令"。
3. **一个信息只在一个地方维护。** 两处记录同一信息必然不一致。
4. **Stage 文件是功能的唯一权威来源。** 全局文件只做索引。
5. **标记新鲜度：** `<!-- Last verified: YYYY-MM-DD | Current stage: X | May be outdated after Stage Y -->`
6. **宁可不写，不要写了不维护。** 过时文档比没文档更危险。
7. **文件间引用用相对路径。** wiki 文件之间互引用 `./XX-filename.md#锚点` 格式，引用源码用 `../server/src/xxx.ts` 格式。
8. **追求信息密度，不追求篇幅。** 具体标准：

**内容取舍——写什么、不写什么：**
- 写决策和约束（"用 dayjs，因为 moment 已废弃"），不写 Agent 能从源码读到的事实（"LoginForm 接受 onSubmit prop"）
- 写跨模块关系（"A 通过 WebSocket 推送给 B"），不写模块内部显而易见的逻辑
- 写"为什么不"（"不用 SSR，因为纯内网工具"），当"为什么是"显而易见时不写

**表达密度——同一信息用最少字数传达：**
- 一行表格能说清的，不展开成一段话
- 不写铺垫句（"在这一节中我们将讨论..."）、不写总结句（"综上所述..."）、不复述上下文
- 每句话删到"再删就丢信息"为止

**膨胀信号——出现以下情况说明写多了：**
- Stage 文件超过 300 行（如 `65-stage-knowledge-api` 696 行 → 应拆分出独立的 API spec 或 ref）
- 非 stage 文件超过 500 行（如 `82-external-*` 1057 行 → 应拆入 `refs/`）
- 一个 section 超过 20 行却没有代码块或表格
- 同一个概念在两个文件中都有段落级展开
- 读完一段话后能概括成一行表格而不丢失关键信息

**拆分策略：** 膨胀文件中识别独立主题块 → 提取为 `refs/` 或新 stage → 原位替换为一行引用链接。拆分后原文件应缩至建议行数内。

> 文档维护的投入信号和时机指南见 `references/writing-guide.md`。

---

## 日常维护规则

Skill 触发时生成 wiki 结构，但 wiki 的日常同步发生在每次开发对话中。以下规则应在初始化完成后写入项目 `CLAUDE.md`，使 Agent 在正常开发流程中自动维护 wiki，无需反复触发本 skill。

写入 CLAUDE.md 的内容（根据项目实际存在的 wiki 文件裁剪，只保留已创建的文件对应的行）：

```markdown
## Wiki 维护

开发过程中，以下操作需要同步更新对应 wiki 文件：

| 当你做了这件事 | 更新哪个文件 |
|--------------|------------|
| 新增/修改 API 路由 | `wiki/30-api-reference.md` 追加或修改对应条目 |
| 完成一个 stage 的功能 | `wiki/01-project-roadmap.md` 对应行状态改为 ✅ |
| 遇到非显而易见的坑 | `wiki/80-known-pitfalls.md` 追加一条（现象、原因、解法） |
| 多个 bug 互相关联、暴露系统性问题 | 新建 `wiki/81-postmortem-*.md`（单点问题用 pitfalls，系统性问题用 postmortem） |
| 架构变更（新模块、新数据流） | `wiki/20-system-architecture.md` 更新对应章节 |
| 阶段全部交付 | `wiki/90-changelog.md` 补一笔（从 backlog 已完成条目整理） |
| 发现 bug / 技术债 / 改进想法 | `wiki/85-backlog.md` 追加一条 |
| 新增设计 token / 动效 | `wiki/21-design-principle.md` 追加对应条目 |
| 出现新领域术语 | `wiki/05-glossary.md` 追加定义，防止 Agent 后续用词混乱 |
| 重命名 / 移动 wiki 文件 | 同步更新所有引用该文件的链接 |

**新建文件时机：**
- 新功能复杂度超过一句话说清 → 新建 `wiki/6X-stage-X.md`
- 小功能 / 改进点需要 spec → 新建 `wiki/specs/spec-{name}.md`（完成后移入 `archive/specs/`）
- 外部机制调研 → 新建 `wiki/refs/ref-{topic}.md`
- Spec / 代码 / 设计评审完成 → 新建 `wiki/reviews/review-{date}-{subject}.md`

**归档时机：**
- Spec 完成且 review 通过 → `git mv wiki/specs/spec-xxx.md wiki/archive/specs/`，backlog 打勾
- Review 的 action items 全部完成 → `git mv wiki/reviews/review-xxx.md wiki/archive/reviews/`
- Stage 归档 → `git mv wiki/6X-stage-X.md wiki/archive/stages/`，roadmap 标注 `[archived]`

**关联维护（每次修改 wiki 文件时）：**
- `grep -r "{被修改文件名}" wiki/` → 检查引用方是否需要同步更新
- 重命名/移动文件 → 全文搜索旧路径，更新所有引用

**定期检查（每个阶段开始时）：**
- 扫描 wiki/ 下所有文件，更新 `Last verified` 日期
- 标出内容可能已过时的章节（加 `<!-- May be outdated -->` 注释）

不需要在每次 commit 时都更新——在功能完成、API 变更、架构调整这些"节点"时同步即可。
```

---

## 模板

所有模板位于本 Skill 的 `assets/` 目录。生成文件时读取对应模板，填入项目上下文。

| 模板文件 | 对应 wiki 文件 |
|---------|---------------|
| `product-proposal.tmpl.md` | `00-product-proposal.md` |
| `project-roadmap.tmpl.md` | `01-project-roadmap.md` |
| `business-model.tmpl.md` | `02-business-model.md` |
| `technical-pillars.tmpl.md` | `03-technical-pillars.md` |
| `system-architecture.tmpl.md` | `20-system-architecture.md` |
| `design-principle.tmpl.md` | `21-design-principle.md` |
| `api-reference.tmpl.md` | `30-api-reference.md` |
| `conventions.tmpl.md` | `40-conventions.md` |
| `stage-x.tmpl.md` | `6X-stage-X.md` |
| `known-pitfalls.tmpl.md` | `80-known-pitfalls.md` |
| `postmortem.tmpl.md` | `81-postmortem-*.md` |
| `design-exploration.tmpl.md` | `84-design-exploration.md` |
| `backlog.tmpl.md` | `85-backlog.md` |
| `changelog.tmpl.md` | `90-changelog.md` |
| `spec.tmpl.md` | `specs/spec-{name}.md` |
| `ref.tmpl.md` | `refs/ref-{topic}.md` |
| `review.tmpl.md` | `reviews/review-{date}-{subject}.md` |
