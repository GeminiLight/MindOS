---
name: project-wiki
description: "组织和维护 Vibe Coding 项目的 wiki 文档体系，让 AI Agent 输出质量最高。当用户要求初始化 wiki、整理文档结构、更新过时文档、新建阶段文件，或进入新产品项目且 wiki/ 目录不存在时，使用此 Skill。也适用于「文档和代码对不上」「梳理下文档」「建个 wiki」「项目文档结构」「文档过时了」等场景。即使用户没有明确提到 wiki，只要涉及项目文档的创建、组织或维护，都应该使用此 Skill。"
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
7. **注入维护规则**：在项目 `CLAUDE.md` 中追加 wiki 日常维护规则（见下方"日常维护规则"），使 Agent 在后续开发中自动同步 wiki，无需再次触发本 skill

### 重构 / 更新（wiki/ 已有文件）

1. **扫描** `wiki/` 下所有文件，检查编号前缀、新鲜度标记
2. **诊断**：缺编号前缀？信息重叠？文件过大需拆分？已完结 stage 未归档？内容与代码不一致？
3. **生成改动清单**（重命名 / 合并 / 拆分 / 归档 / 更新内容），与用户确认
4. **执行改动**
5. **验证一致性**：文件间引用链接有效、roadmap 索引与实际文件对应
6. **检查维护规则**：确认项目 `CLAUDE.md` 中已有 wiki 维护规则，缺失则补上

---

## 文件体系

### 核心模型：Why / What / How / Look × 全局 / 阶段

| | 全局（稳定，新阶段才改） | 阶段（增量更新） |
|---|---|---|
| **Why** | `00-product-proposal.md` | — |
| **What** | `01-project-roadmap.md` — 功能索引 | `1X-stage-X.md` — 设计决策 |
| **How** | `02-system-architecture.md` — 架构 + 类型 | `1X-stage-X.md` — API、数据模型、受影响文件 |
| **API** | `04-api-reference.md` — 完整 API 参考 | `1X-stage-X.md` — 新增 API 的设计决策 |
| **Look** | `03-design-principle.md` — 视觉语言 | — |

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
| 02 | `system-architecture.md` | Agent | 技术栈、目录结构、数据流、核心类型、环境变量（300-500 行） |

### 按需文件（第二梯队）

| 编号 | 文件 | 何时需要 |
|------|------|---------|
| 03 | `design-principle.md` | 有自定义视觉语言时（非默认 UI 库样式） |
| 04 | `api-reference.md` | API 超过 5 条路由，或 stage 归档后仍需查 API 细节 |
| 05 | `glossary.md` | 项目有领域术语，Agent 容易用错词或混用近义词 |
| 06 | `conventions.md` | 有明确的编码偏好/约束（库选择、命名、错误处理模式等） |
| 1X | `stage-X.md` | 功能复杂度超过一句话能说清（150-300 行） |
| — | `task-spec-xxx.md` | 小功能 / 改进点的 spec，包含需求描述和验收标准；实现完成后归档或合并进对应 stage 文件 |
| 80 | `known-pitfalls.md` | 踩坑即记，不等阶段结束 |
| 81 | `development-guide.md` | 有非显而易见的配置要求时 |
| 84 | `design-exploration.md` | 有 UI 设计探索、原型记录等创意过程产物时 |
| 85 | `backlog.md` | 有临时 bug、技术债、改进想法需要追踪时 |
| 8X | `external-*.md` | 依赖外部系统私有数据格式时 |
| 90 | `changelog.md` | 发版时从 `85-backlog.md` 已完成条目整理写入，面向用户描述变更，不记内部实现细节 |

> 每个文件的详细说明和"为什么需要"的论证见 `references/file-reference.md`。

### 目录结构与编号规范

```
wiki/
├── 00-product-proposal.md        # Why
├── 01-project-roadmap.md         # What（全局索引）
├── 02-system-architecture.md     # How（全局）
├── 03-design-principle.md        # Look（全局）
├── 04-api-reference.md           # API（全局）
├── 05-glossary.md                # 术语表（有领域术语时）
├── 06-conventions.md             # 编码约定（有明确偏好时）
├── 10-stage-a.md                 # 阶段文件
├── 11-stage-b.md
├── ...
├── 80-known-pitfalls.md          # 辅助参考
├── 81-development-guide.md
├── 84-design-exploration.md      # 设计探索/原型记录（有 UI 探索时）
├── 85-backlog.md                 # Bug、技术债、改进想法
├── 90-changelog.md               # 日志
└── archive/                      # 已完结阶段归档
```

| 区段 | 用途 |
|------|------|
| `00-09` | 全局文件，按阅读优先级排列 |
| `10-79` | 阶段文件，按时间递增 |
| `80-89` | 辅助参考文件 |
| `90-99` | 日志类文件 |

### Stage 文件生命周期

阶段完全交付且后续阶段不再引用其 API/数据模型时 → 移入 `wiki/archive/`，`01-project-roadmap.md` 中保留索引行并标注 `[archived]`。

**归档判断标准：** 同时满足以下两条才归档：① 该 stage 已完结超过一个阶段；② 当前及未来 stage 文件中无对它的跨引用。不确定时保留，宁可冗余不要断链。

---

## Agent 阅读顺序

| 场景 | 路径 |
|------|------|
| 新对话 / 新功能 | `00-product-proposal` → `02-system-architecture` → 当前 `stage-X` |
| 修 Bug | `02-system-architecture` → `80-known-pitfalls` → 相关 `stage-X` |
| UI 调整 | `03-design-principle` → `02-system-architecture`（目录结构）→ 相关组件 |
| 了解全貌 | `00-product-proposal` → `01-project-roadmap` → `02-system-architecture` |

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
- 一个 section 超过 20 行却没有代码块或表格
- 同一个概念在两个文件中都有段落级展开
- 读完一段话后能概括成一行表格而不丢失关键信息

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
| 新增/修改 API 路由 | `wiki/04-api-reference.md` 追加或修改对应条目 |
| 完成一个 stage 的功能 | `wiki/01-project-roadmap.md` 对应行状态改为 ✅ |
| 遇到非显而易见的坑 | `wiki/80-known-pitfalls.md` 追加一条（现象、原因、解法） |
| 架构变更（新模块、新数据流） | `wiki/02-system-architecture.md` 更新对应章节 |
| 阶段全部交付 | `wiki/90-changelog.md` 补一笔（从 backlog 已完成条目整理） |
| 发现 bug / 技术债 / 改进想法 | `wiki/85-backlog.md` 追加一条 |
| 新增设计 token / 动效 | `wiki/03-design-principle.md` 追加对应条目 |
| 出现新领域术语 | `wiki/05-glossary.md` 追加定义，防止 Agent 后续用词混乱 |
| 重命名 / 移动 wiki 文件 | 同步更新所有引用该文件的链接 |

**新建文件时机：**
- 新功能复杂度超过一句话说清 → 新建 `wiki/1X-stage-X.md`
- 小功能 / 改进点需要 spec → 新建 `wiki/task-spec-xxx.md`（实现完成后归档或合并进 stage 文件）

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
| `system-architecture.tmpl.md` | `02-system-architecture.md` |
| `design-principle.tmpl.md` | `03-design-principle.md` |
| `api-reference.tmpl.md` | `04-api-reference.md` |
| `glossary.tmpl.md` | `05-glossary.md` |
| `conventions.tmpl.md` | `06-conventions.md` |
| `stage-x.tmpl.md` | `1X-stage-X.md` |
| `known-pitfalls.tmpl.md` | `80-known-pitfalls.md` |
| `development-guide.tmpl.md` | `81-development-guide.md` |
| `backlog.tmpl.md` | `85-backlog.md` |
| `changelog.tmpl.md` | `90-changelog.md` |
