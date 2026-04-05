---
name: mindos-zh
description: >
  操作 MindOS 知识库：更新笔记, 搜索知识库, 整理文件, 执行SOP/工作流, 复盘, 追加CSV, 跨Agent交接,
  路由非结构化输入到对应文件, 提炼经验, 同步关联文档. update notes, search knowledge base, organize,
  SOP, retrospective, CSV, handoff, route notes, distill experience.
  仅 mindRoot 知识库内任务。不用于：改代码仓库/项目文档/KB 外路径。
  核心概念：空间、指令(INSTRUCTION.md)、技能(SKILL.md)；笔记可承载指令与技能。
---

# MindOS 技能

<!-- version: 2.0.0 — CLI + MCP 统一技能 -->

## 执行方式选择

**能执行 bash 命令**（Claude Code、Gemini CLI、Codex、pi-coding-agent）→ 用 **CLI 列**。
**只有 MCP 工具**（`mindos_*` 开头）→ 用 **MCP 列**。
**两者都有** → 优先 CLI（更省 token）。

| 操作 | CLI (bash) | MCP (tool call) |
|------|-----------|-----------------|
| 加载上下文 | `mindos file list` | `mindos_bootstrap` |
| 列出空间 | `mindos space list` | `mindos_list_spaces` |
| 列出文件 | `mindos file list [目录]` | `mindos_list_files` |
| 搜索 | `mindos search "关键词"` | `mindos_search_notes(query)` ×2-4 变体 |
| 读取文件 | `mindos file read <路径>` | `mindos_read_file(path)` |
| 读取行 | `mindos file read <路径> --lines 10:20` | `mindos_read_lines(path, start, end)` |
| 创建文件 | `mindos file create <路径> --content "..."` | `mindos_create_file(path, content)` |
| 覆盖文件 | `mindos file create <路径> --content "..." --force` | `mindos_write_file(path, content)` |
| 编辑段落 | *(读取 → 修改 → 覆盖写回)* | `mindos_update_section(path, heading, content)` |
| 标题后插入 | *(读取 → 修改 → 覆盖写回)* | `mindos_insert_after_heading(path, heading, content)` |
| 追加内容 | `echo "text" >> <完整路径>` | `mindos_append_to_file(path, content)` |
| 删除文件 | `mindos file delete <路径>` | `mindos_delete_file(path)` |
| 重命名 | `mindos file rename <旧> <新>` | `mindos_rename_file(path, newName)` |
| 移动文件 | `mindos file move <源> <目标>` | `mindos_move_file(path, destination)` |
| 创建空间 | `mindos space create "名称"` | `mindos_create_space(name)` |
| 反向链接 | `mindos api GET /api/backlinks?path=<path>` | `mindos_get_backlinks(path)` |
| 历史记录 | `mindos api GET /api/git?op=log&path=<path>` | `mindos_get_history(path)` |
| 追加 CSV 行 | *(读取 → 追加 → 覆盖写回)* | `mindos_append_csv(path, values)` |
| Raw API | `mindos api <METHOD> <path>` | *(用上面的具体工具)* |

### CLI 安装（MCP 用户跳过）

```bash
# 安装
npm install -g @geminilight/mindos

# 远程模式（MindOS 运行在另一台机器上）
mindos config set url http://<IP>:<端口>
mindos config set authToken <token>
# 在服务器上获取 token：mindos token
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
- **禁止用整文件覆盖做小修改。** 用 `update_section` / `update_lines`（MCP）或精确读-改-写（CLI），整文件覆盖破坏 git diff。
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
  │   ├─ 单文件 → [单文件编辑]
  │   └─ 多文件或不确定 → [多文件路由] — 先出方案
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
- 5 秒内定不了 → 用最近的现有目录，告知用户
- "随便放哪" → 收件箱，之后提议分类

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

---

## 错误处理（CLI）

```bash
"command not found: mindos"  → npm install -g @geminilight/mindos
"Mind root not configured"   → mindos onboard
"401 Unauthorized"           → 检查 AUTH_TOKEN：在服务器运行 mindos token
"ECONNREFUSED"               → 在服务器启动：mindos start
```
