# MindOS 竞品分析

*最后更新：2026-04-12*

---

## 核心论点

笔记工具的读者是人。AI 记忆的读者是 AI。MindOS 的读者是人和 AI。

"Obsidian 是第二大脑，MindOS 是共享大脑。"

---

## 竞品矩阵

| 维度 | Obsidian | Notion | MemOS | OpenAI Memory | MindOS |
|------|----------|--------|-------|---------------|--------|
| 核心定位 | 个人知识管理 | 团队协作 | AI 记忆基础设施 | 单 Agent 记忆 | 跨 Agent 判断沉淀 |
| 读者 | 人 | 人 | AI | AI | 人 + AI |
| 存储 | 本地 Markdown | 云端 | 向量数据库 | 云端黑箱 | 本地 Markdown |
| 多 Agent | 无 | 无 | API 级 | 仅 ChatGPT | MCP + ACP |
| 人可审计 | 是 | 是 | 否 | 否 | 是 |
| 透明度 | 高 | 中 | 低 | 低 | 高 |
| 判断沉淀 | 手动 | 手动 | 自动黑箱 | 自动黑箱 | 半自动可审计 |

---

## 逐个深度分析

### vs Obsidian

**关系：** 不替代，共存。

Obsidian 是优秀的个人知识管理工具，但它的设计假设是"读者是人"。插件生态丰富，但没有原生的 Agent 连接能力。

MindOS 的差异点：
- Agent 是一等公民，不是后加的插件
- MCP 协议原生支持，不是通过社区插件桥接
- 内置 Agent Inspector 审计日志

**一句话：** 用 Obsidian 管自己的笔记，用 MindOS 管和 AI 的共享上下文。

### vs MemOS

**关系：** 最接近的竞品，可能互补也可能直接竞争。

MemOS 是基础设施层（Python SDK），MindOS 是应用层（GUI + 终端用户）。MemOS 用向量数据库存储记忆，MindOS 用纯 Markdown。

关键区别：
- MemOS 的记忆是黑箱（embedding），用户看不懂也改不了
- MindOS 的规则是透明的（Markdown），用户随时审查修正
- MemOS 面向开发者集成，MindOS 面向终端用户使用

### vs OpenAI Memory

**关系：** 不正面打。服务不同用户群。

OpenAI Memory 服务的是只用一个 AI 的用户。MindOS 服务的是同时用 3+ AI 的用户。

只用 ChatGPT 的人不需要 MindOS。同时用 Claude Code + Cursor + Windsurf 的人，OpenAI Memory 帮不了他。

### vs Notion AI

Notion 的方向是"团队协作 + AI 增强"。MindOS 的方向是"个人认知 + 多 Agent 共享"。重叠度低。

---

## 竞品象限

```
            人可审计
               |
    Obsidian   |   MindOS
               |
  -------------|---------------
               |
    Notion     |   MemOS / OpenAI Memory
               |
            AI 黑箱

  单 Agent ←----------→ 多 Agent
```

MindOS 占据右上角：多 Agent + 人可审计。这个位置目前空白。

---

## 四个独占优势

1. **判断沉淀为规则** — 不是存对话历史，是提取判断变成可执行规则
2. **跨 Agent 人可治理** — 所有 Agent 读同一套规则，人随时修改
3. **纠正 -> 规则 -> 复用闭环** — 纠正不浪费，自动变成下次的标准
4. **方向与大厂相反** — 大厂做 AI 的记忆（锁定用户），MindOS 做人的记忆（自由切换）

---

## 竞争策略

- **不和 Obsidian 打** — 共存，互补
- **不和 OpenAI Memory 打** — 不同用户群
- **警惕 MemOS** — 如果 MemOS 加 GUI 层，会直接竞争
- **占位"跨 Agent 判断沉淀"** — 品类先占者优势

**一句话：** Cursor 让你写得更快，MindOS 让你想得更深。
