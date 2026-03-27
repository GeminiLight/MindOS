## PENDING

有没有可能直接在这里展示给用户改了哪些文件的列表，并且允许他们查看呢

一键清理 examples

支持一键整理至空间

Agent 对比视图

对话框 一堆bug。

文件树刷新不及时，当有文件增删的时候，未及时显示。


skill 面板，点开查看详情。

webpage wording skill写个技能

ACP for call
Agent as Workflow

模版优化 - 中英文，勾选 空间

MindOS Agent的时间感知问题

Editer for skill & agent & file

Agents 面板开发

- Agents SideBar，点击每个 Agent，应该直接弹出Content页，而不是右侧边栏，包括你检查出来这个agent有哪些skill、mcp、usage等等信息
- 允许自定义 Agent 


1. Desktop APP 首次打开直接默认了本地模式，而不是让用户选择本地还是remote。你看看有没有这个问题，有的话fix
2. Desktop APP 能否内置一个build固定版本的mindos，如果用户没安装也能直接打开了；另外如果用户更新了npm mindos 发现版本更高，则回到更高版本build的页面，你觉得合理吗？



● 还没发布到 0.5.1，CI 还在跑。你可以稍后手动执行：

  npm install -g @geminilight/mindos@latest

  或者直接用本地版本（已经是最新代码）：

  cd /data/home/geminitwang/code/mindos && npm link

避免硬编码，比如json里面的变量

你觉得用户还会有哪些觉得很模糊 或者 不友好的地方

- 历史对话的问题。

1. 优化模版

1. 优化Skill

n. 优化REAMDE.md
- 优化VISION文本，独立出一个product-vision.md放在wiki
- 提示用户端口应该开放才可以外部访问GUI和MCP

n. 文件改动版本历史
通过git管理？如何记录agent操作历史？

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

### 高优先级 - 用户体验改进

#### 界面和交互优化
1. **File Panel层级管理** - File Panel应该支持一键折叠/扩展层级
4. **Agent对话框按钮问题** - MindOS Agent的对话框上有很多按钮好像有问题，比如删除历史对话之类的

#### 功能增强
11. **模板管理改进** - 现在模版下面有很多一级目录，其实是用户的一些Space，需要INTRUCTION.md来自动管理

### 中优先级 - 功能开发

#### 新功能规划
18. **Discover功能** - Rail的智能体下方，加一个新的icon，叫做探索 Discover，包括使用案例、插件市场、技能市场
19. **审计功能** - MindOS 审计文件更改的功能（Review change）
20. **模块解耦** - 模块解耦化

#### 技术优化
21. **多终端管理** - 我经常开多个Terminal端口怎么办
23. **插件架构** - 我插件如何保持灵活性和可扩展性？最小化侵入主代码文件

### 低优先级 - 长期规划

29. **使用案例完善** - 使用案例的完善

### 命令行和下载
- curl -L -o ~/Downloads/MindOS-0.1.0-arm64-mac.zip 'http://21.6.243.108:8080/desktop/dist/MindOS-0.1.0-arm64-mac.zip'
- cd ~/Downloads && unzip MindOS-0.1.0-arm64-mac.zip && open MindOS-0.1.0-arm64.dmg

## ADDRESSED



1. 合并插件到主程序
2. Diff


### 已解决的界面和交互问题

#### 文件树和Ask AI面板 ✅
- [x] **文件树和Ask AI面板冲突** - 现在有个很大的问题，文件树和Ask AI不能同时打开
- [x] **Ask AI Panel文字大小** - Ask AI Panel里面的AI的回答文字太大了

#### GUI更新体验 ✅
- [x] **GUI更新体验** - 网页端的更新虽然有这个四步骤，但是重新构建新应用的时候，这个网页就直接关闭了
- [x] **版本更新提示** - 现在版本更新导致的小红点会出现，但正确更新后，好像不会消失

#### 配置和连接 ✅
- [x] **CLI/GUI配置选择** - mindos onboard 允许用户选择 cli or gui 进行配置
- [x] **知识库目录修正** - 知识库的存放目录，/data/home/geminitwang/.mindos/~/MindOS/ 这个肯定不对，预期是用户目录下的 MindOS
- [x] **MCP配置体验** - MCP页面下，现在用户想要再去配置新的Agent工具很不方便，因为他们不知道给新agent提供什么信息

#### 同步和Agent管理 ✅
- [x] **同步功能可见性** - sync功能感知弱，需要增强：首页状态指示器、侧栏同步图标、Settings同步tab
- [x] **Agent添加界面** - mindos mcp 添加agent的时候，不要让用户输入数字，要可以多选的选择框

#### 智能体设计 ✅
- [x] **智能体侧边栏设计** - 精心设计智能体的slidebar，类似探索页面，有Overview、MCP、Skill、Usage等按钮
- [x] **探索页面扩展** - Rail的探索下面加个空间模版，放在插件市场下面

#### 版本和网络 ✅
- [x] **版本管理策略** - 如何管理开源版本和闭源版本
- [x] **PR处理机制** - 这种同步的方式，如何处理对于 MindOS 的 PR
- [x] **网络连接优化** - 为什么很多时候，只有Network能work旁听在本地呢

#### Wiki和设计系统 ✅
- [x] **Wiki使用指南** - wiki 使用指南，比如roadmap到stage
- [x] **设计系统更新** - 设计系统更新！
- [x] **贡献者更新** - 更新 Contributor

### 已完成的CLI功能
- [x] CLI 更新提示 ✅ (v0.3.0+ update-check.js)

### 已解决的其他问题
- [x] **智能体侧边栏设计** - 精心设计智能体的slidebar，类似探索页面，有Overview、MCP、Skill、Usage等按钮
- [x] **探索页面扩展** - Rail的探索下面加个空间模版，放在插件市场下面
- [x] **版本管理策略** - 如何管理开源版本和闭源版本
- [x] **PR处理机制** - 这种同步的方式，如何处理对于 MindOS 的 PR
- [x] **网络连接优化** - 为什么很多时候，只有Network能work旁听在本地呢

### 已解决的同步问题
**Sync "Remote not reachable" — credential 静默吞错 ✅**
- 原报错：`initSync` credential approve 失败被空 catch 吞掉 → `ls-remote` 无凭证 → 泛泛的 "Remote not reachable"
- 修复：credential catch 记日志 + fallback URL token；`ls-remote` 提取 stderr 详细信息；sync.js 全量 `execSync` → `execFileSync`；route.ts `exec` → `execFile`（防注入）；context.ts null guard + Anthropic 消息格式兼容

### 已完成的UX优化
**UX Heuristics 评估发现（6.5/10）**

**P0 — Major (Severity 3) ✅**
- [x] Step 5 Agent 列表认知过载 → 已改为 detected/other 分组，未检测到的默认折叠
- [x] Step 6 Review 信息密度过高 → 已改为 4 阶段 progress stepper + 配置摘要精简为 3 行
- [x] Port 输入缺即时反馈 → 已加 500ms debounce 自动检测 + blur 立即触发 + suggestion 可点击 chip

**P1 — Minor (Severity 2) ✅**
- [x] StepDots 导航无标签 → 已有 stepTitles i18n + `hidden sm:inline` 桌面端显示（此前已实现）
- [x] McpTab 三区块视觉权重相同 → ServerStatus 突出卡片 + Agent/Skills 折叠面板
- [x] Transport/Scope selector 术语不透明 → 隐藏到"高级选项"折叠，Scope 用"为所有项目安装"/"仅当前项目"
- [x] "Skip, I'll do this later" 措辞模糊 → 改为 "Skip — install agents later in Settings > MCP"
- [x] Agent badge 状态无图例 → 列表顶部加三色圆点图例（Installed/Detected/Not found）

**P2 — Cosmetic (Severity 1) ✅**
- [x] McpTab "Select Detected" / "Clear" 按钮样式过弱 → 改为 ghost button（border + hover bg）
- [x] Step 1 KB 路径无推荐默认值提示 → 加 "Use ~/MindOS/mind" 一键填入按钮
- [x] Skills 区域缺上下文说明 → 加一句话 "Skills teach AI agents how to use your knowledge base"
