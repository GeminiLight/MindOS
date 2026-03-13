## PENDING


mindos onboard 允许用户选择 cli or gui 进行配置
- 其实现在用户对这个sync功能感知还挺弱的，你有什么建议，从文档到cli到gui到...
- 支持用户有多个mindos
- wiki 使用指南，比如roadmap到stage

允许用户在GUI配置 MCP 和 Skill，需要注意本地和云端


## ADDRESS

  1. Sync 可见性增强                 

  TODO 里提到"用户对 sync 功能感知弱"。目前
  sync 只有 CLI，GUI 零感知。

  - 首页加 sync 状态指示器（最后同步时间 +
  push/pull 状态）
  - 侧栏底部加一个同步图标，点击手动触发 sync
  - Settings → Sync tab 展示 remote
  URL、最后同步时间、冲突文件列表


- sync 的 功能也得放在前端展示
- mindos mcp 添加agent的时候，不要让用户输入数字，要可以多选的那种选择框，每一个选项一行，可多选
- Agent Inspector的logo为什么不直接json呢？另外也可以反思下其他插件或者功能模块有没有类似的问题，Json GUI再友好的渲染就好


同模版应该包括文件
模版应该云安装

点击后，我的电脑会自动在浏览器打开，很多时候，Local完全打不开，但Network可以，这是什么原因

为什么很多时候，只有Network                           
  http://21.6.243.108能work旁听在本地呢  

  1. CLi要不要不展示local

