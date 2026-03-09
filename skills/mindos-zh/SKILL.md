---
name: mindos-zh
description: >
  MindOS 知识库中文操作指南。当用户用中文与 MindOS 知识库交互时使用此 Skill——
  包括读写笔记、搜索文件、管理 SOP、维护 Profile、操作 CSV 数据表、
  执行工作流、审查 Agent 输出等。当用户提到"知识库"、"笔记"、"MindOS"、
  "我的文件"、"SOP"、"Profile"、"记录一下"、"帮我整理"、"更新知识库"、
  "查一下我的笔记"，或任何涉及 my-mind/ 目录操作的中文请求时，均应触发此 Skill。
  即使用户没有明确提到 MindOS，只要任务涉及个人知识管理、文件组织、
  工作流执行或 Agent 协作上下文，也应主动使用。
---

# MindOS 知识库操作指南

MindOS 是一个**人机协同心智系统**——本地优先的协作知识库，让笔记、工作流、个人上下文既对人类阅读友好，也能直接被 AI Agent 调用和执行。

本 Skill 定义了你（Agent）在 MindOS 知识库中操作的完整协议。

---

## 核心理念

**人类在此思考，Agent 依此行动。**

三大支柱：
1. **全局同步** — 一处记录，所有 Agent 复用。通过 MCP 协议，任何 Agent 零配置接入你的 Profile、SOP 与经验。
2. **透明可控** — Agent 的每次检索、反思与执行均沉淀为本地纯文本。人类拥有绝对的审查与修正权。
3. **共生演进** — Prompt-Driven 的记录范式让日常笔记天然成为 Agent 执行指令。人机在同一个 Shared Mind 中共同成长。

> **底层基石：本地优先。** 所有数据以 Markdown/CSV 纯文本存储在本地，彻底消除隐私顾虑。

---

## 启动协议

进入知识库时，按以下顺序加载上下文：

1. **读取 `INSTRUCTION.md`** — 系统规则（必须）
2. **读取 `README.md`** — 目录索引与职责表（必须）
3. 根据任务类型，路由到目标目录，读取其 `README.md`（建议）
4. 若目标目录含 `INSTRUCTION.md`，读取其局部规则（建议）
5. 开始执行

步骤 1-2 不可跳过。没有上下文的盲目执行会导致规则被绕过。

---

## 知识库结构

```
my-mind/
├── INSTRUCTION.md          # 系统规则（本文件的源头）
├── README.md               # 根索引——目录结构与职责表
├── TODO.md                 # 待办事项
├── CHANGELOG.md            # 已完成事项（按日期倒序）
├── Profile/                # 身份、偏好、风格、目标、人脉
├── Configurations/         # Agent 工具配置（MCP、Skill、Claude Code 等）
├── Workflows/              # SOP 与工作流（可直接执行的指令文档）
├── Projects/               # 产品项目（计划书、PRD、竞品分析）
├── Resources/              # 产品库、AI Scholars、Github Projects
├── Research/               # 研究资料与笔记
└── Reference/              # 参考文档与模板
```

---

## 可用工具集（20 个 MCP 工具）

你可以使用以下工具操作知识库：

### 文件操作

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_list_files` | 文件树 | 了解知识库全貌，寻找目标文件 |
| `mindos_read_file` | 读取文件（支持分页） | 阅读任何 .md/.csv 文件 |
| `mindos_write_file` | 覆写文件 | 大幅重写文件内容（受保护文件被拦截） |
| `mindos_create_file` | 创建新文件 | 新建 .md 或 .csv 文件 |
| `mindos_delete_file` | 删除文件 | 移除不再需要的文件（受保护文件被拦截） |
| `mindos_rename_file` | 重命名文件 | 原地重命名 |
| `mindos_move_file` | 移动文件 | 移动文件并报告受影响的反向链接 |

### 搜索与发现

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_search_notes` | 全文搜索 | 按关键词、范围、类型、日期筛选 |
| `mindos_get_recent` | 最近修改 | 了解最近的工作状态 |
| `mindos_get_backlinks` | 反向链接 | 查找所有引用指定文件的文件 |

### 版本历史

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_get_history` | Git 提交历史 | 查看文件的修改轨迹 |
| `mindos_get_file_at_version` | 读取历史版本 | 回溯到特定 Git 提交的文件内容 |

### 精确编辑

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_read_lines` | 按行号读取 | 定位精确行号，为后续编辑做准备 |
| `mindos_insert_lines` | 插入行 | 在指定位置插入新内容 |
| `mindos_update_lines` | 替换行范围 | 精确替换特定行 |
| `mindos_append_to_file` | 追加内容 | 在文件末尾添加内容 |
| `mindos_insert_after_heading` | 标题后插入 | 在指定 Markdown 标题后添加内容 |
| `mindos_update_section` | 替换章节 | 替换整个 Markdown 章节内容 |

### 数据表操作

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_append_csv` | 追加 CSV 行 | 向数据表添加新记录 |

### 启动上下文

| 工具 | 用途 | 使用场景 |
|------|------|----------|
| `mindos_bootstrap` | 一次性加载启动上下文 | 同时读取 INSTRUCTION.md + README.md |

---

## 操作规则

### 读写纪律

- **写入前必须先读取。** 不基于假设覆盖已有内容。这是硬性规则。
- CSV 追加前先读取表头，确保字段对齐。
- 优先使用精确编辑工具（`insert_lines`、`update_section`），避免不必要的全文覆写。

### 文件命名

| 类型 | 规则 | 示例 |
|------|------|------|
| 内容文件 | emoji + 中文名，专有名词保留英文 | `👤 Identity.md` |
| 目录名 | 英文，首字母大写 | `Workflows/` |
| 系统文件 | 全大写英文，不带 emoji | `README.md`、`TODO.md` |

### 引用与同步

文件间通过相对路径引用：
```markdown
参见 `Profile/👤 Identity.md`
详见 `Workflows/Research/README.md`
```

**必须同步的操作**（结构变更）：
- 新增/删除/重命名一级子目录 → 更新根 `README.md`
- 删除/重命名文件 → 更新所有引用该文件的 `README.md`

**建议同步的操作**（内容变更）：
- 新增文件 → 更新所属目录的 `README.md`

### TODO 与 CHANGELOG

- `TODO.md`：待办唯一入口。格式 `- [ ] 任务描述`
- `CHANGELOG.md`：按日期倒序记录已完成事项。完成项从 TODO 迁移到 CHANGELOG

### 安全边界

- 不删除用户未明确指定的文件
- 不在知识库中存储密钥、Token、密码
- 修改 `INSTRUCTION.md` 前获得用户确认
- 批量删除或目录重组前获得确认

---

## 常见任务模式

### 对话后知识沉淀

这是 MindOS 最核心的使用场景之一。用户在其他 Agent（Cursor、Claude Desktop、Copilot 等）中完成了一段长对话后，想把收获沉淀回知识库。关键在于：不是简单地"记录对话"，而是**提炼、结构化、归位**。

**场景 A：总结经验 / 踩坑记录**

用户说类似"刚调了两小时的 bug，帮我记录下经验"或"把这次的解决方案存下来"：

```
1. 向用户确认要沉淀的核心内容（关键决策、解决方案、踩坑点）
2. mindos_search_notes — 检查是否已有相关主题的笔记
3. 若有 → mindos_read_file → 理解已有内容的结构
   → mindos_insert_after_heading 或 mindos_append_to_file — 追加新经验，避免重复
4. 若无 → mindos_create_file — 在合适目录创建新笔记
5. 内容应精炼为可复用的 pattern，而非对话流水账
```

**场景 B：反向更新 SOP / 工作流**

用户说类似"这个 SOP 有几步不对，帮我更新"或"我发现了更好的流程"：

```
1. mindos_search_notes — 找到对应的 SOP 文件
2. mindos_read_file — 读取完整 SOP 内容
3. 与用户对齐哪些步骤需要修改（新增步骤？删除过时步骤？调整顺序？）
4. mindos_update_section — 精确替换变更的章节
5. 若 SOP 引用了其他文件，检查引用是否仍有效
```

**场景 C：从对话中萃取 Pattern**

用户说类似"我们刚讨论的那套方法论，帮我整理成文档"：

```
1. 请用户提供或确认关键要点（不要假设你知道完整对话内容）
2. mindos_search_notes — 查找是否有相关的现有文档可扩展
3. 将 pattern 结构化为：问题 → 方案 → 适用场景 → 注意事项
4. mindos_create_file 或 mindos_update_section — 归入合适的目录
```

**场景 D：跨 Agent 上下文同步**

用户说类似"我在 Cursor 里做了一些架构决策，同步到知识库"：

```
1. 向用户确认决策要点（你无法读取其他 Agent 的对话历史）
2. mindos_search_notes — 找到对应的项目文档
3. mindos_read_file — 读取当前状态
4. mindos_update_section 或 mindos_insert_after_heading — 追加决策记录
5. 若涉及多个文件的关联变更，逐一更新并保持引用一致
```

> **核心原则：你不在那个对话里。** 当用户说"帮我总结刚才的讨论"时，你必须先向用户确认要沉淀的内容。不要假装你知道其他 Agent 的对话历史。主动询问、精准提炼、结构化归档。

### 记录新想法

```
1. mindos_search_notes — 检查是否已有相关笔记
2. 若有 → mindos_read_file → mindos_insert_after_heading 或 mindos_append_to_file
3. 若无 → mindos_create_file 在合适目录创建
```

### 执行 SOP / 工作流

```
1. mindos_read_file — 读取 Workflows/ 下的 SOP 文档
2. 按步骤执行，每步结果沉淀回知识库
3. mindos_update_section — 更新执行状态
4. 若执行过程中发现 SOP 步骤有误或可优化 → 反向更新 SOP（见上方场景 B）
```

### 录入新产品/资源

```
1. mindos_read_file — 读取对应 CSV 表头
2. 收集必要信息
3. mindos_append_csv — 追加一行
```

### 更新 Profile

```
1. mindos_read_file — 读取当前 Profile 文件
2. mindos_update_section 或 mindos_insert_after_heading — 精确修改
```

### 整理与回顾

```
1. mindos_get_recent — 查看最近修改
2. mindos_search_notes — 搜索相关内容
3. mindos_get_backlinks — 理解文件在知识网络中的位置
```

---

## Markdown 书写规范

- 章节标题适当添加 emoji
- 命令用 code 格式：独立命令用 code block，行内用 `` `行内代码` ``
- 内容精炼，面向执行而非解释
- 列表优先于段落，表格优先于列表（当有多维度对比时）

## CSV 书写规范

- 首行为表头，逗号分隔
- 含逗号、引号、换行的单元格用双引号包裹
- 追加行时字段顺序与数量必须与表头一致

---

## 扩展知识库

### 新增域（一级子目录）

1. 创建目录
2. 在目录内创建 `README.md`，包含：一句话说明、目录结构、使用说明、更新规则
3. 更新根 `README.md` 的目录结构与职责表

### 外部资源录入

1. 读取对应 CSV 表头
2. 收集必要信息
3. 追加一行到 CSV
4. 不创建新文件，除非 CSV 不存在（此时先建含表头的 CSV）
