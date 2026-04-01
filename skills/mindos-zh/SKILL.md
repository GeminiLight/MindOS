---
name: mindos-zh
description: >
  操作 MindOS 知识库：更新笔记, 搜索知识库, 整理文件, 执行SOP/工作流, 复盘, 追加CSV, 跨Agent交接,
  路由非结构化输入到对应文件, 提炼经验, 同步关联文档.
  update notes, search knowledge base, organize, SOP, retrospective, CSV, handoff, route notes, distill experience.
  仅 mindRoot 知识库内任务。不用于：改代码仓库/项目文档/KB 外路径。
  核心概念：空间、指令(INSTRUCTION.md)、技能(SKILL.md)；笔记可承载指令与技能。
---

# MindOS Skill

<!-- version: 1.3.1 -->

**每次任务前，内化这 5 条规则：**

1. **bootstrap 目录树是首要索引** — 先从目录名和层级推断，再搜索。大多数定位不需要工具调用。
2. **默认只读。** 只有用户明确要求保存、记录、整理、修改时才调写入工具。查阅/总结/引用 = 不写。
3. **规则优先级**（越上越优先）：用户当轮指令 → `user-skill-rules.md` → 就近目录 `INSTRUCTION.md` → 根 `INSTRUCTION.md` → 本 SKILL 默认。
4. **多文件编辑必须先出计划。** 展示完整变更清单，确认后再执行。
5. 增删/移动/重命名后 → **自动同步受影响 README**。

---

## 绝对不要（踩坑清单）

- **绝不写入 KB 根目录**，除非用户明确要求。根目录只放治理文件（`README.md`、`INSTRUCTION.md`、`CONFIG`）。新内容放语义最合适的子目录。
- **绝不假设目录名。** 不要写死 `Workflows/`、`Projects/`、`Contacts/` — 必须从实际收到的 bootstrap 目录树推断。用户可能用中文名、扁平结构或独特层级。
- **绝不用 `mindos_write_file` 做小修改。** 用 `update_section`、`update_lines` 或 `insert_after_heading` — 整文件覆写破坏 git diff，变更无法审计。
- **绝不单关键词搜索。** 必须并行 2-4 条搜索（同义词、缩写、中英文变体）。单条命中率太低。
- **绝不未经确认就改 `INSTRUCTION.md` 或 `README.md`。** 它们是治理文档，即使看起来只是修个错别字。
- **绝不在没看过邻居文件的情况下创建新文件。** 至少读 1-2 个同目录文件，学习本地命名/标题/CSV 格式。自创新规是不一致的常见根源。
- **绝不留孤链。** 重命名/移动后必须 `get_backlinks` 并更新每一个引用方。这是知识库断链的首因。
- **绝不跳过多文件写入的路由确认。** 即使目标看起来很明显——用户的心智模型可能和你不同。

---

## MindOS 核心概念

- **空间（Space）** — 按你的思维方式组织的知识分区。Agent 遵循同样的结构。
- **指令（Instruction）** — 所有接入 Agent 都遵守的规则文件。写一次，全局生效。
- **技能（Skill）** — 教 Agent 如何读写、整理知识库。Agent 按安装的 Skill 执行，不是瞎猜。

**笔记即指令 / 技能** — `INSTRUCTION.md` 和 `SKILL.md` 就是目录树里的 Markdown 文件。笔记可以是随笔，也可以是 Agent 必须遵守的治理规则，或 Agent 按步骤执行的程序包。

---

## 思维框架

动手前，问自己：

1. **用户意图属于哪类？** → 只读查阅 | 单文件编辑 | 多文件路由 | 结构变更 | SOP 执行。决定走下面哪条路径。
2. **这个内容该放哪？** → 扫目录树。如果看名字 5 秒内定不下来，大概率要问用户确认。
3. **附近有什么？** → 写之前读 1-2 个同级文件，照它们的风格。
4. **改这里会打断什么？** → 重命名/移动：`get_backlinks`。内容修改：想想谁引用了这个事实。
5. **用户让我写了吗，还是我自作主张？** → 没让你写就别写。

---

## 任务路由决策树

```
用户请求
  │
  ├─ 只是查找 / 总结 / 引用？
  │   └─ 是 → [只读路径]：搜索 + 读取 + 标注来源。不写入。跳过 Hooks。
  │
  ├─ 要求保存 / 记录 / 更新 / 整理具体内容？
  │   ├─ 单文件目标？ → [单文件编辑]
  │   └─ 多文件或目标不明？ → [多文件路由]
  │
  ├─ 结构变更（重命名 / 移动 / 删除 / 重组）？
  │   └─ [结构路径]
  │
  ├─ 流程性 / 可重复的任务？
  │   └─ [SOP 路径]
  │
  ├─ 复盘 / 提炼 / 交接？
  │   └─ [复盘路径]
  │
  └─ 模糊或范围过大？
      └─ 先问清楚。基于 KB 状态提出 2-3 个具体选项。不要开始编辑。
```

**以上任何写入 / SOP / 结构路径 → 先读 [references/write-supplement.md](./references/write-supplement.md)。**
包含：启动协议、写工具选型、各路径详细执行步骤。

---

## 工具选型

| 意图 | 推荐工具 | 避免 |
|------|----------|------|
| 启动时加载上下文 | `mindos_bootstrap` | 不 bootstrap 就随机读文件 |
| 列出顶层心智空间 | `mindos_list_spaces` | 只需分区概览却拉整棵 `list_files` |
| 找文件 | `mindos_search_notes`（2-4 条并行关键词变体）| 单关键词搜索 |
| 读内容 | `mindos_read_file` 或 `mindos_read_lines`（大文件） | 只需 10 行却读整文件 |
| 小范围文字修改 | `mindos_update_section` / `update_lines` / `insert_after_heading` | 小修改用 `write_file` |
| 追加到末尾 | `mindos_append_to_file` | 为了加一行重写整文件 |
| 整文件替换 | `mindos_write_file` | 用它做章节级编辑 |
| 新建文件 | `mindos_create_file` | 自动创建父目录，但不会生成空间脚手架文件 |
| 新建心智空间（目录 + README + INSTRUCTION）| `mindos_create_space` | 创建空间的唯一方式。`create_file` 只创建普通目录 |
| 重命名空间目录 | `mindos_rename_space` | `rename_file`（仅文件，不能重命名文件夹）|
| 追加 CSV | `mindos_append_csv`（校验表头）| 手动拼字符串不校验 |
| 重命名前查影响 | `mindos_get_backlinks` | 不查引用就重命名 |
| 查看近期变动 | `mindos_get_recent` | 猜最近改了什么 |
| 恢复历史版本 | `mindos_get_file_at_version` | 让用户回忆之前内容 |

### 回退

- `mindos_bootstrap` 不可用 → 手动读根 `INSTRUCTION.md` + `README.md`。
- 行级/章节级工具不可用 → 读 + 受限 `mindos_write_file`（模拟最小修改）。
- 搜索无结果 → 不放弃：(1) 扫上下文中的树；(2) 直接读候选文件；(3) `mindos_list_files` 细化子目录；(4) 用同义词/中英文变体重试。

---

## 执行模式

| 模式 | 适用场景 | 关键步骤 |
|------|----------|----------|
| **只读问答** | 查找 / 总结 / 引用 | 目录树推断 → 搜索 → 读取 → 标注来源 → 明确说信息缺口 |
| **单文件编辑** | 目标文件明确 | 启动协议 → 读目标 + 局部约定 → 最小修改 → 验证 → 总结 |
| **多文件路由** | 非结构化输入，多个目的地 | 解析为语义单元 → 路由表 → 确认 → 编辑 → 汇总 |
| **对话复盘** | 提炼 / 沉淀会话 | 确认范围 → 抽取决策/踩坑/下一步 → 路由 → 记录变更 |
| **SOP 执行** | 可重复流程 | 完整读 SOP → 分步执行 → 更新过时段落 → 偏差则提议更新 |
| **结构变更** | 重命名 / 移动 / 删除 | `get_backlinks` → 影响报告 → 确认 → 执行 → 更新引用 → 同步 README |
| **CSV 追加** | 追加表格行 | 读表头 → 校验字段 → `mindos_append_csv` |
| **跨 Agent 接力** | 继续其他 Agent 的工作 | 读任务状态+决策 → 无需重新探索直接接续 → 回写进度 |
| **周期性回顾** | 汇总近期变动 | `get_recent`/`get_history` → 读变动文件 → 结构化总结 |
| **交接文档** | 创建简报 | 读来源 → 合成（背景、决策、状态、待办）→ 放项目目录 |

写入模式详细执行步骤 → [references/write-supplement.md](./references/write-supplement.md)。

---

## 交互规则

- **模糊请求？** 先问。基于 KB 现状提出 2-3 个选项。不要在没理解范围前开始编辑。
- **标注来源。** KB 中的事实附带文件路径，便于验证。
- **简洁优先。** 展示最可能的匹配，不列全部。

---

## 任务后 Hooks

**写入任务**完成后（简单单文件修改或只读查阅跳过），扫描下表。命中则发起一句话提议，最多 1 条，选优先级最高项。先查 `user-skill-rules.md` 的抑制区；用户要求安静模式时全部跳过。

| Hook | 优先级 | 触发条件 |
|------|--------|---------|
| 经验沉淀 | 高 | 调试、排错、踩坑，或多轮才解决 |
| 一致性同步 | 高 | 编辑了有反链的文件（查 `get_backlinks`） |
| SOP 偏差 | 中 | 按 SOP 执行但实际步骤与文档不符 |
| 联动更新 | 中 | 改了 CSV/TODO 状态且存在关联文档 |
| 结构归类 | 中 | 在临时目录或收件箱新建了文件 |
| 模式提炼 | 低 | 本会话 3+ 次结构相似操作 |
| 对话复盘 | 低 | 会话 >10 轮且涉及决策或权衡 |

有 hook 命中 → 读 [references/post-task-hooks.md](./references/post-task-hooks.md) 获取提议措辞和用户自定义 hooks。都不命中则安静结束，不读此文件。

## 偏好捕获

用户表达要长期记住的偏好（「以后不要…」「这个该放在…」）时，读 [references/preference-capture.md](./references/preference-capture.md) 并按确认后写入流程存入 `user-skill-rules.md`。
**不要读** preference-capture 除非用户真的表达了要持久化的偏好。

## SOP 编写

创建或改写工作流 SOP 时，**必须 — 读 [references/sop-template.md](./references/sop-template.md)**（前置条件、分支步骤、退出条件、踩坑记录）。
**不要读** sop-template 用于 SOP 执行（仅用于 SOP 创建/编辑）。
