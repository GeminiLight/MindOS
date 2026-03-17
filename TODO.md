## PENDING

GUI Onboard 界面

1. 如果目录下有其他文件，应当提示用户如果继续选择模版将会覆盖，另外允许用户跳过选择模版，不进行覆盖。



2. 在最后complete step后，下方有Saving，还没结束呢，但上方的Restart Now已经可以点了，这肯定不行。

### UX Heuristics 评估发现（6.5/10）

**P0 — Major (Severity 3)** ✅
- [x] Step 5 Agent 列表认知过载 → 已改为 detected/other 分组，未检测到的默认折叠
- [x] Step 6 Review 信息密度过高 → 已改为 4 阶段 progress stepper + 配置摘要精简为 3 行
- [x] Port 输入缺即时反馈 → 已加 500ms debounce 自动检测 + blur 立即触发 + suggestion 可点击 chip

**P1 — Minor (Severity 2)** ✅
- [x] StepDots 导航无标签 → 已有 stepTitles i18n + `hidden sm:inline` 桌面端显示（此前已实现）
- [x] McpTab 三区块视觉权重相同 → ServerStatus 突出卡片 + Agent/Skills 折叠面板
- [x] Transport/Scope selector 术语不透明 → 隐藏到"高级选项"折叠，Scope 用"为所有项目安装"/"仅当前项目"
- [x] "Skip, I'll do this later" 措辞模糊 → 改为 "Skip — install agents later in Settings > MCP"
- [x] Agent badge 状态无图例 → 列表顶部加三色圆点图例（Installed/Detected/Not found）

**P2 — Cosmetic (Severity 1)** ✅
- [x] McpTab "Select Detected" / "Clear" 按钮样式过弱 → 改为 ghost button（border + hover bg）
- [x] Step 1 KB 路径无推荐默认值提示 → 加 "Use ~/MindOS/mind" 一键填入按钮
- [x] Skills 区域缺上下文说明 → 加一句话 "Skills teach AI agents how to use your knowledge base"

沉淀交互模式
11

模块解耦化，

我经常开多个Terminal端口怎么办

你再核查下然后开启下一个阶段

如何管理开源版本和闭源版本

- 支持用户有多个mindos
- wiki 使用指南，比如roadmap到stage

## ADDRESSED

CLI有没有可能进来之后 检查系统语言选择展示的语言

2. GUI 模式下文件路径改成可以可以类似打开文件目录选择的，你觉得怎么样？对服务器优化吗
1. 知识库的存放目录，/data/home/geminitwang/.mindos/~/MindOS/ 这个肯定不对吧，预期是用户目录下的 MindOS，而不是隐藏目录，GUI和CLI都更新下

~/MindOS/ -> ~/MindOS/my-mind

CLI 和 GUI 都更新下

允许用户在GUI配置 MCP 和 Skill，需要注意本地和云端

  ⎿  · 你想要的 'CLI or GUI 配置' 具体是哪种形态？ → 
     CLI 入口分流                                      
     · GUI 配置需要覆盖哪些内容？ → 全部配置项

我插件如何保持灵活性和可扩展性？比如 最小化侵入主代码文件？

优化UX
- sync在GUI的操作方式应该是输入框 按钮，而不是文字提示
- 如果联网，GUI自动弹出更新
- ~~CLI 更新提示~~ ✅ (v0.3.0+ update-check.js)


- 其实现在用户对这个sync功能感知还挺弱的，你有什么建议，从文档到cli到gui到...
mindos onboard 允许用户选择 cli or gui 进行配置

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

