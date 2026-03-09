 开始构建
  GitHub下面有个词，是MCP-native
  ，这个应该更名成Agent-native。并且将移动
  作为第一个，三个排序依次是Agent-native、L
  ocal-first
  、Open Source
   






[] 支持ACP（Agent Coding Protocol）：调用其他Agent如 Claude Code 以辅助编程接





  2.3 评论/批注机制

  Notion 有 create-a-comment /
  retrieve-a-comment，这对 Human-AI
  协作很关键——Agent
  可以在文件上留批注，而不是直接修改内容。

  我们的 Audit Log（Agent-Audit.md）是单向日
  志，用户很难对具体操作回复。可以考虑：

  mindos_add_comment(path, line, content)  →
  在文件旁添加 Agent 批注
  mindos_get_comments(path)                →
  读取批注

  实现上可以用 {filename}.comments.md
  或统一的 Agent-Comments.md 存储。

1. 更新文件夹目录为MindOS


  │ P3  │ Comment 机制  │ Human-AI       │
  │     │               │ 异步协作       │
  └─────┴───────────────┴────────────────┘