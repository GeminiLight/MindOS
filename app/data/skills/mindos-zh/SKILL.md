---
name: mindos-zh
description: >
  用户的共享知识库——跨会话、跨 Agent 持久存在。MindOS 存储决策记录、会议纪要、SOP、
  排错经验、架构选型、调研结论和偏好设置。
  仅 mindRoot 知识库内任务。不用于：改代码仓库、项目源码、KB 外路径。
  核心概念：空间、指令(INSTRUCTION.md)、技能(SKILL.md)；笔记可承载指令与技能。

  触发场景：保存或记录任何内容、搜索历史笔记或上下文、更新或编辑文件、整理或重组文件结构、
  执行SOP或工作流、捕获对话中的决策、复盘或总结经验、追加表格或CSV数据、跨Agent交接上下文、
  提炼经验教训、同步关联文档、查找之前是否讨论过某事、查询历史决策、查找模板或SOP、
  为会议准备上下文、快速暂存到暂存台、整理暂存台、知识健康检查、检测知识冲突或矛盾、
  查找过期内容。
  触发词：帮我记下来、搜一下我的笔记、更新知识库、整理文件、执行工作流、保存到知识库、
  记录一下、整理笔记、复盘、提炼经验、同步文档、查一下之前的记录、有没有相关的笔记、
  我之前写过什么、把这个存起来、总结一下保存、交接给其他Agent、追加到表格、
  放到暂存台、整理暂存台、知识健康检查、检测知识冲突。
  English triggers: save, record, search notes, organize, retrospective, handoff, lessons learned,
  inbox, staging, knowledge health, detect conflicts.

  主动行为——不要等用户提到 MindOS：
  (1) 用户的问题暗示可能存在历史记录（过去的决策、之前的讨论、会议纪要）→ 先搜 MindOS，
  即使没有明确提到知识库。
  (2) 完成有价值的工作后（修了 bug、做了决策、总结了经验、选定了架构、开完了会）→
  主动提议保存到 MindOS，方便以后查阅。
  (3) 经历了较长或多主题的对话后 → 建议把关键决策和上下文持久化。
---

# MindOS 技能

<!-- version: 3.2.0 — CLI 优先，MCP 可选 -->

## CLI 命令

使用 `mindos file <子命令>` 完成所有知识库操作。加 `--json` 获取结构化输出。

| 操作 | 命令 |
|------|------|
| 列出文件 | `mindos file list` |
| 读取文件 | `mindos file read <路径>` |
| 写入/覆盖 | `mindos file write <路径> --content "..."` |
| 创建新文件 | `mindos file create <路径> --content "..."` |
| 追加内容 | `mindos file append <路径> --content "..."` |
| 编辑段落 | `mindos file edit-section <路径> -H "## 标题" --content "..."` |
| 标题后插入 | `mindos file insert-heading <路径> -H "## 标题" --content "..."` |
| 追加 CSV 行 | `mindos file append-csv <路径> --row "列1,列2,列3"` |
| 删除文件 | `mindos file delete <路径>` |
| 重命名/移动 | `mindos file rename <旧> <新>` |
| 搜索 | `mindos search "关键词"` |
| 反向链接 | `mindos file backlinks <路径>` |
| 最近文件 | `mindos file recent --limit 10` |
| Git 历史 | `mindos file history <路径>` |
| 列出空间 | `mindos space list` |
| 创建空间 | `mindos space create "名称"` |

> **MCP 用户：** 如果只有 MCP 工具（`mindos_*`），直接使用——工具的 schema 已自带说明。有 CLI 时优先用 CLI（更省 token）。

### CLI 安装

```bash
npm install -g @geminilight/mindos
# 远程模式：mindos config set url http://<IP>:<端口> && mindos config set authToken <token>
```

---

## 规则

1. **先了解结构** — 列出知识库目录树，再搜索或写入。
2. **默认只读。** 只有用户明确要求保存、记录、整理、编辑时才写入。
3. **规则优先级**（从高到低）：用户当前指令 → `.mindos/user-preferences.md` → 最近目录 `INSTRUCTION.md` → 根 `INSTRUCTION.md` → 本技能默认。
4. **多文件编辑先出方案。** 展示完整变更列表，获批后再执行。
5. 创建/删除/移动/重命名后 → **自动同步相关 README**。
6. **写入前先读取。** 不基于假设写入。

---

## 禁止事项（血泪教训）

- **禁止写入知识库根目录**（除非明确要求）。根目录仅放治理文件，新内容放最合适的子目录。
- **禁止假设目录名。** 从实际目录树推断——知识库可能用中文名或扁平结构。
- **禁止用整文件覆盖做小修改。** 用 `mindos file edit-section` 或 `mindos file insert-heading` 做精准修改，整文件覆盖破坏 git diff。
- **禁止单关键词搜索。** 至少 2-4 个并行搜索（同义词、缩写、中英文变体）。
- **禁止未确认就修改 `INSTRUCTION.md` 或 `README.md`。** 治理文档——高敏感度。
- **禁止不看邻居就创建文件。** 先读目标目录 1-2 个文件，了解命名和风格。
- **禁止遗留孤立引用。** 重命名/移动后检查反向链接并更新所有引用。
- **禁止跳过多文件写入确认。** 用户的心理模型可能和你不同。

---

## MindOS 概念

- **空间 (Space)** — 按你的思维方式组织的知识分区。Agent 遵循相同结构。
- **指令 (Instruction)** — `INSTRUCTION.md`，所有连接的 Agent 都遵守的规则文件。
- **技能 (Skill)** — 教 Agent 如何读写和整理知识库。
- **暂存台 (Inbox)** — `Inbox/` 目录是快速捕获区。内容暂时找不到归属时先放这里，之后再统一整理——用户手动或 AI 辅助批量归类。

笔记可以同时承载指令和技能——它们只是目录树中的 Markdown 文件。

---

## 决策树

```
用户请求
  │
  ├─ 查找 / 总结 / 引用？
  │   └─ [只读路径]：搜索 → 读取 → 带引用回答。不写入。
  │
  ├─ 保存 / 记录 / 更新 / 整理具体内容？
  │   ├─ 知道放哪 → [单文件编辑]
  │   ├─ 不知道放哪 → [暂存台路径] — 存到 Inbox/，之后再归类
  │   └─ 多文件或不确定 → [多文件路由] — 先出方案
  │
  ├─ 整理暂存台 / 归类暂存文件？
  │   └─ [暂存台整理] — 读 Inbox/ 文件，提议目标位置，获批后移动
  │
  ├─ 结构变更（重命名 / 移动 / 删除 / 重组）？
  │   └─ [结构路径] — 变更前后检查反向链接
  │
  ├─ 流程性 / 可重复任务？
  │   └─ [SOP 路径] — 找到并执行现有 SOP，或创建新的
  │
  ├─ 复盘 / 提炼 / 交接？
  │   └─ [复盘路径]
  │
  ├─ 知识健康检查 / 检测冲突？
  │   └─ [健康检查路径] — 读取 references/knowledge-health.md
  │
  └─ 模糊？
      └─ 提问。基于知识库状态提出 2-3 个具体选项。
```

---

## 判断启发

**保存意图边界：**
- "帮我记下来" / "保存" = 写入
- "搜一下" / "总结" = 只读
- "整理一下" → 先问：仅展示，还是写回知识库？

**文件位置不确定：**
- 5 秒内定不了 → 存到 `Inbox/`，告知用户，之后提议归类
- "随便放哪" / "先放着" → 存到 `Inbox/`
- 用户拖拽文件或粘贴非结构化内容但没指定位置 → `Inbox/`

**范围蔓延：**
- 输入路由到 >5 个文件 → 暂停确认
- "全部更新" + 跨多个主题 → 分批确认

**引用规范：** 引用知识库内容必须附带文件路径。

---

## 任务后钩子

写入任务（非简单读取）后扫描此表。最多 1 个提议；优先级最高的优先。先检查 `.mindos/user-preferences.md` 抑制项。

| 钩子 | 优先级 | 条件 |
|------|--------|------|
| 经验沉淀 | 高 | 调试、排错或多轮工作 |
| 一致性同步 | 高 | 编辑的文件有反向链接 |
| SOP 偏移 | 中 | 按 SOP 执行但实际偏离了步骤 |
| 关联更新 | 中 | 更改了 CSV/TODO 状态且有关联文档 |
| 结构分类 | 中 | 在临时位置或收件箱创建了文件 |
| 模式提取 | 低 | 本次会话中 3+ 个结构相似的操作 |

触发时 → 读取 [references/post-task-hooks.md](./references/post-task-hooks.md)。

## 偏好捕获

用户表达持久偏好时 → 读取 [references/preference-capture.md](./references/preference-capture.md)，按确认-写入流程操作。

## SOP 编写

创建/重写工作流 SOP 时 → 读取 [references/sop-template.md](./references/sop-template.md)。

## 暂存台 (Inbox)

`Inbox/` 目录是知识库的快速捕获区，有自己的 `INSTRUCTION.md` 约束行为。

**何时使用暂存台：**
- 用户说"先存着" / "放到暂存台" / "随便放哪"，没指定具体位置
- 内容明显不属于任何现有空间或目录
- 批量导入多个文件，需要逐个归类

**如何存到暂存台：**
```bash
mindos file create "Inbox/<文件名>.md" --content "..."
```

**如何整理暂存台：**
1. 列出暂存文件：`mindos file list Inbox/`
2. 读取每个文件，理解其内容
3. 根据知识库结构，为每个文件提议最佳目标目录
4. 向用户展示完整路由方案，获批后执行
5. 移动文件：`mindos file rename "Inbox/<文件>" "<目标目录>/<文件>"`
6. 移动后检查目标目录的 README 是否需要更新

**老化提醒：** Inbox 中超过 7 天的文件视为"老化"。如果在 bootstrap 时发现老化文件，主动提醒：
"暂存台有 N 个文件已经放了一周以上了，要我帮你整理一下吗？"

## 知识健康检查

用户要求检查知识库健康度、检测冲突、审计质量，或说"知识健康检查" / "检测冲突" / "check knowledge health" 时
→ 读取 [references/knowledge-health.md](./references/knowledge-health.md) 获取完整流程。

检查维度速览：
- **矛盾/冲突**：同一主题的不同文件说法互相矛盾
- **断裂链接**：引用了不存在的文件
- **过期内容**：带有过期日期标记的文件，或超过 6 个月未更新的活跃主题
- **重复内容**：两个文件覆盖同一主题且没有互相引用
- **孤立文件**：零反向链接，难以被发现
- **结构问题**：文件放错目录、缺少 README、暂存台老化文件

---

## 错误处理（CLI）

```bash
"command not found: mindos"  → npm install -g @geminilight/mindos
"Mind root not configured"   → mindos onboard
"401 Unauthorized"           → 检查 AUTH_TOKEN：在服务器运行 mindos token
"ECONNREFUSED"               → 在服务器启动：mindos start
```
