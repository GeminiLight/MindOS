---
name: mindos-zh
description: >
  MindOS 知识库中文操作指南，仅用于 MindOS 知识库内的 Agent 任务。
  仅当操作目标是 MindOS 知识库目录下的文件时触发，典型请求包括"更新笔记""搜索知识库"
  "整理文件""执行 SOP""按团队标准 review""把任务交接给另一个 Agent""同步决策"
  "追加 CSV""复盘这段对话""提炼关键经验""把复盘结果自适应更新到对应文档"
  "把这些信息路由到对应文件""同步更新所有相关文档"等。
  不触发：操作目标是本地代码仓库文件（如 /code/xxx/wiki/*.md）、
  用户给出的是绝对路径且不在 MindOS mindRoot 下、或任务是修改项目源码/文档。
---

# MindOS Skill

从知识库加载操作规则，然后执行用户任务。

## 协议

1. 读取 `.agents/skills/mindos-zh/skill-rules.md` — 操作规则。
   - 若文件不存在：退化到 `mindos_bootstrap`（或手动读取根 INSTRUCTION.md
     + README.md）。提示用户："运行 `mindos init-skills` 启用完整 skill 规则。"
2. 若 `.agents/skills/mindos-zh/user-rules.md` 存在且非空：
   读取。用户规则在冲突时覆盖默认规则。
3. 按加载的规则执行任务。完成后评估任务后 hooks。
