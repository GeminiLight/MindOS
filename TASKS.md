template重命名为templates

- 历史对话的问题。

1. 优化模版

1. 优化Skill

1. 加上Agent沉淀到笔记。

2. 开放MCP公开API

n. 优化REAMDE.md
- 优化VISION文本，独立出一个product-vision.md放在wiki
- 提示用户端口应该开放才可以外部访问GUI和MCP

n. 文件改动版本历史
通过git管理？如何记录agent操作历史？

Landing Page
1. 移动端Landing页面Topbar显示问题
创造者故事

- 前端密码验证

首页下
- search files应当和Ask AI调换位置和大小来显示AI-nature的特性
- Plugins应该放在Recently Modified的上面
-  New note按钮应该更名为New Notes，而且点击后进入的是404

LANDING page 节日祝福的例子

别人share模版，或者md


[Auth] Token for MCP

<!--  -->

Skill Creator，我现在要给我们这个MindOS创建一个极其好的Skills，请你也关联起来MCP的能力，帮我写一个极其好的，你觉得叫 mindos-mcp 怎么样？


Landing的
即刻开启 Shared Mind
应该体现下安装Skill


git add landing/ && git commit -m "update landing page" || true
git subtree push --prefix landing origin gh-pages

有一些零散的想法agent 就可以自主执行，然后人机literally 共享第二大脑了是吗

如果再反问agent，它会有意识的帮人复盘，哪些可以SOP；然后通过mcp存到MindOS，所有agent都可以用了



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