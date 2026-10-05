# MindOS 界面参考研究

> 日期：2026-10-03。对话分类：产品定位 / 竞品与界面研究。
> Workflow：官方来源检索 → 七个产品筛选 → 界面图鉴 → 四特性对照 → 最小改动建议。
> 状态：研究与提案；不是已批准的功能规格。

**后续扩展：** 用户要求继续到 Product Hunt 寻找参考。已新增六个 UI 研究、九张官方示例及三个定位观察项，详见 [Product Hunt 精选材料](product-hunt-report.md)。网页新增精选章节与分组导航，两轮累计 13 个图鉴产品、22 张界面材料。下面保留第一轮基础研究。

## 核心判断

MindOS 的主线仍是个人上下文管理、跨 Agent 接续、经验沉淀与成长、生成式工作视图。保留现有树、文件夹、项目与导航；把一次真实协作从找回、核对、保存到再次使用做顺。

这组产品存在能力重叠：Pieces 提供跨工具工作记忆和 MCP；Readwise 提供面向助手的资料连接；Claude Artifacts 已支持跨会话存储。不能用“只有我们有记忆 / 只有我们能连接 Agent / 生成界面只是一次性预览”建立定位。依据分别见 [Pieces](https://pieces.app/)、[Reader](https://readwise.io/read)、[Artifacts 官方帮助](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)。

候选差异化：本地资料可检查和修改，自己的判断有原始出处、范围与修订记录，用户能选择它们接续到不同 Agent，再用实际结果更新判断。这是需要实际使用验证的产品假设。

## 选取范围与方法

选取七个产品，分别看文件与视图、工作事件与接续、阅读与批注、人物记录、生成工作成果以及列表连续操作。这里的“优秀”是设计参考的取舍判断，不代表全行业排名。

图片来自官方公开产品页或帮助文档。Claude 的两张结构参考图来自 2024 年发布材料，已单独标注；其余为研究时官方页面提供的界面材料。图像未标版本时不能认定是最新账户界面的逐像素记录。本轮未登录测试竞品；操作行为根据官方帮助核对，界面分析属于解读，MindOS 方案属于提案。

## 七个产品

### Obsidian · 资料与视图

参考关系：相邻竞品。对应特性：个人上下文管理 / 生成式工作视图。

最贴近 MindOS 本地文件基础的参考。尤其值得看 Bases：整理方式可以变，原始资料仍有稳定归属。

**官方能力：**Bases 可以查看、编辑、筛选笔记及其属性；同一个 Base 可以有多个视图。资料保存在本地 Markdown 文件中，视图定义可以保存为 .base 文件。 [Bases 官方帮助](https://obsidian.md/help/bases)；[官方截图源文件](https://github.com/obsidianmd/obsidian-help/blob/master/en/Attachments/bases-noshadow.png)。

**观察与解读：**

- **以内容为中心**：书籍以行呈现，标题和属性直接进入工作面，用户先处理内容，再考虑组织方式。
- **视图有名字**：不同呈现可以作为可回到的视图存在。“再打开刚才的视图”比“再生成一次界面”更容易形成日常习惯。
- **文件与视图各有归属**：这是数据模型带来的体验优势：用户可以更换呈现方式，同时保持原文件的可读性。

**MindOS 借鉴位置：心智 / 工作台。**保留文件树；在人脉 CSV 或关联项目上增加可命名的视图。始终提供“打开原文件”，视图筛选和布局单独保存。

可验证场景：打开关系总览 → 切到“待跟进” → 维护一个人物 → 在原文件中看到同一项更新。

借鉴边界：借鉴文件与视图的关系。先用模板提供默认字段，避免让初次使用的人先学习查询语法和属性体系。

**界面材料：**

- [Bases · 书籍表格](https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Attachments/bases-noshadow.png)。官方帮助示例；截图版本未标注。 [原页面](https://obsidian.md/help/bases)。

### Pieces · 工作记忆与接续

参考关系：接近定位的竞品。对应特性：个人上下文管理 / 跨 Agent 接续 / 经验沉淀与成长。

在这组产品中最接近“跨工具工作记忆”的方向，值得认真比较定位，而不只是看视觉。

**官方能力：**Pieces 用时间线呈现捕获的工作事件，支持按类型、来源筛选和查看事件内容。官网说明其 MCP 可将工作历史带入兼容助手，并提供暂停捕获及按来源删除的控制。 [Pieces 官方产品页](https://pieces.app/)；[Timeline 官方帮助](https://docs.pieces.app/products/desktop/timeline)；[对话检索官方帮助](https://docs.pieces.app/products/desktop/conversational-search)。

**观察与解读：**

- **时间成为入口**：左侧按天组织事件，主区阅读选中的内容。用户可以从“上周做过什么”进入，而不必先记住文件名。
- **来源帮助辨认**：工具、时间和事件类型让相似记录更容易区分，也帮助核对回忆的出处。
- **记忆需要管理面**：暂停与删除的可见控制提醒我们：接入越方便，用户越需要知道正在收集什么。

**MindOS 借鉴位置：协作记录 / 回响。**给已有会话列表补足时间、来源和项目；选中后在主区看原文，再挑选值得保留的判断。接续前预览确切材料。

可验证场景：找到上次 Codex 的讨论 → 定位那条取舍 → 加入本次上下文 → 为另一个 Agent 准备材料。

借鉴边界：自动捕获是 Pieces 的产品选择。MindOS 近期可以聚焦明确接入的会话和资料；候选经验须能核对、修订和停止使用。

**界面材料：**

- [Desktop · 事件与主区](https://ik.imagekit.io/pieces/images/home/pieces-desktop-timeline.png?tr=w-1880%2Ch-1436&v=1782488482084849)。当前官网展示图；截图版本未标注。 [原页面](https://pieces.app/)。
- [Timeline · 按时间找回](https://ik.imagekit.io/pieces/images/home/pieces-desktop-timeline-feature.png?tr=w-1360&v=1784581911806178)。当前官网功能展示图；截图版本未标注。 [原页面](https://pieces.app/)。

### Readwise Reader · 原文、批注与回看

参考关系：相邻竞品。对应特性：个人上下文管理 / 跨 Agent 接续 / 经验沉淀与成长。

为“经验沉淀与成长”提供具体的界面参考：阅读、标注和再次回看可以衔接成日常行为。

**官方能力：**Reader 支持高亮和批注，内容可同步到 Readwise 供回看；其 Filtered Views 可保存筛选后的资料集合。当前官网也提供 MCP 连接助手读取资料的说明。 [Reader 官方产品页](https://readwise.io/read)；[高亮与批注官方帮助](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)；[Filtered Views 官方帮助](https://docs.readwise.io/reader/docs/faqs/filtered-views)。

**观察与解读：**

- **阅读占据主区**：界面的重点是正在读的内容；批注靠近原文，比单独跳去“成长中心”更能保留理解的语境。
- **小动作能积累**：标记一段、写一句自己的解释，是一次可完成的操作；积累价值来自以后还能找到它。
- **按需要回到内容**：保存的筛选视图可成为固定入口。对 MindOS 来说，“待核对”“最近复用”比泛化总览更接近实际任务。

**MindOS 借鉴位置：回响 / 印迹。**将“原话”和“我的判断”放在同一阅读流程中；保留来源定位。回看时补充“后来发生了什么”，支持修改适用范围。

可验证场景：读原会话 → 保留自己的判断 → 下次复用 → 在同一条记录里补充结果与修订。

借鉴边界：Readwise 的复习机制不能直接证明用户成长。MindOS 先把经验与实际结果连起来，再决定提醒频率；不以打卡或分数替代判断。

**界面材料：**

- [Reader · 资料与阅读](https://d34adp677peecb.cloudfront.net/static/images/reader/Hero-Screen%401x.72ad6bf1deaa.webp)。当前官网展示图；截图版本未标注。 [原页面](https://readwise.io/read)。
- [Highlight · 就地标注](https://d34adp677peecb.cloudfront.net/static/images/reader/Highlight-Alpha-No-Note%401x.28c2c4cc2706.webp)。当前官网高亮功能展示图；截图版本未标注。 [原页面](https://readwise.io/read)。

### Notion · 一份资料，多种视图

参考关系：相邻竞品。对应特性：个人上下文管理 / 生成式工作视图。

值得借鉴的是数据、页面与视图之间的组织方式，尤其适合研究内置模板的用户心智。

**官方能力：**Notion 数据库可用表格、列表、看板等视图呈现同一份内容。每个视图可有自己的布局和筛选设置；数据库页面支持侧边预览。 [数据库视图官方帮助](https://www.notion.com/help/views-filters-and-sorts)；[项目官方产品页](https://www.notion.com/product/projects)。

**观察与解读：**

- **视图围绕任务**：看板适合状态推进，列表适合快速查找。切换表达的是“现在要怎样处理资料”。
- **详情可以靠近列表**：侧边预览保留左侧数据库的操作空间，减少查看一个条目后再找回列表的往返。
- **配置按需出现**：布局、字段和筛选放在视图设置里。默认工作面可以简洁，定制能力仍可被找到。

**MindOS 借鉴位置：工作台 / 我的视图。**模板先带一个可立即使用的默认视图；用户可以重命名、筛选和另存视图。人脉、项目和研究资料继续绑定原文件。

可验证场景：从“人脉管理”模板开始 → 绑定已有 CSV → 保存“本周待跟进” → 以后从项目直接打开。

借鉴边界：多视图本身不等于 Generative UI。MindOS 需要另外完成自然语言定制、稳定保存和写回原资料；也应控制字段与配置的初始复杂度。

**界面材料：**

- [Projects · 筛选后的看板](https://images.ctfassets.net/spoqsaf9291f/6rIlyH477Pd7UHscCYMz2s/5fa0c3b7809ab984e085b4cf01965a7b/feature-filter-kanban.png)。当前项目产品页展示图；截图版本未标注。 [原页面](https://www.notion.com/product/projects)。
- [Views · 在视图间切换](https://images.ctfassets.net/spoqsaf9291f/2KRCKUbMb1AYfqJUWafwSr/03dfbdd1149dfbc3525543d373925722/Group_158.png)。官方帮助截图；截图版本未标注。 [原页面](https://www.notion.com/help/views-filters-and-sorts)。

### Attio · 人物、互动与跟进

参考关系：垂直场景参考。对应特性：个人上下文管理 / 生成式工作视图。

最适合研究用户提出的人脉模板。这里借鉴的是人物工作面和关系记录，而不是把个人工具扩展成销售系统。

**官方能力：**Attio 的记录页面汇集属性、活动、笔记和任务；活动以时间线呈现。表格或看板中的记录可以在右侧预览，当前记录保持高亮。 [记录与预览官方帮助](https://attio.com/help/reference/managing-your-data/records/create-and-view-records)；[记录笔记官方帮助](https://attio.com/help/reference/attio-101/productivity/introduction-to-notes)。

**观察与解读：**

- **人物是稳定的中心**：概览、活动和笔记围绕同一对象组织。用户先找到一个人，再处理相关信息。
- **背景与互动有层次**：关键属性适合快速扫视，时间线回答“最近发生了什么”；长笔记可进一步打开。
- **普通动作足够直接**：新笔记、任务和记录维护是明确动作。AI 的价值可以落在辅助整理，而不占据每一次操作的入口。

**MindOS 借鉴位置：第一个内置模板：人脉。**联系人列表 + 人物详情；默认显示背景、最近互动、待跟进和关联原文。新增互动写回人物文档，索引继续负责查找。

可验证场景：找到人物 → 看上次交流 → 记一条互动 → 更新跟进 → 会前挑选可给 Agent 使用的资料。

借鉴边界：参考图部分以公司记录演示同一结构。个人版应精简销售管线、团队指标和自动富化，私人评价与对外准备材料也要分别控制。

**界面材料：**

- [Record · 记录概览](https://a.storyblok.com/f/234930/1829x1067/6aed6cc3ee/full-record-page-overview.png)。官方帮助截图，以公司记录展示结构；截图版本未标注。 [原页面](https://attio.com/help/reference/managing-your-data/records/create-and-view-records)。
- [Activity · 互动时间线](https://a.storyblok.com/f/234930/866x676/721cabee8f/activity-tab.png)。官方帮助截图；截图版本未标注。 [原页面](https://attio.com/help/reference/managing-your-data/records/create-and-view-records)。

### Claude · 项目上下文与生成界面

参考关系：能力重叠与界面参考。对应特性：个人上下文管理 / 跨 Agent 接续 / 生成式工作视图。

同时研究 Projects 与 Artifacts。当前 Artifacts 已支持持久数据，不能把它简单理解为一次性的生成预览。

**官方能力：**Projects 通过项目资料和指令提供上下文。Artifacts 可在对话旁打开、编辑和再次访问，统一保存在 Artifacts 区域；当前帮助也说明其支持跨会话存储数据。 [Artifacts 当前官方产品页](https://claude.com/features/artifacts)；[Artifacts 当前官方帮助](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)；[Projects 当前官方帮助](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)；[Projects 2024 发布材料](https://www.anthropic.com/news/projects)。

**观察与解读：**

- **生成与使用有各自位置**：对话帮助提出修改，工作成果在独立区域展开，用户能直接检查正在生成的结果。
- **成果可再次找到**：Artifacts 有集中管理入口。生成界面能否形成习惯，取决于下一次打开是否容易。
- **项目背景可明确维护**：Projects 的资料与指令提供了可见的上下文边界。MindOS 还需要面向不同 Agent 明确本次选择。

**MindOS 借鉴位置：工作台 / 已保存视图。**生成时并排预览；满意后保存名称、资料绑定和布局。再次打开读取原资料。改版先比较变化，保留用户已经维护的内容。

可验证场景：描述“帮我整理关系资料” → 预览界面 → 核对绑定文件 → 保存 → 下次打开继续维护。

借鉴边界：当前产品能力以帮助文档为准；两张结构参考图来自 2024 年发布。MindOS 的候选差异是文件透明、跨 Agent 使用与经验修订，需要实际验证。

**界面材料：**

- [Artifacts · 2024 年并排布局](https://www-cdn.anthropic.com/images/4zrzovbb/website/c5823949d9350145ce2fda51acbc7076f2139cd0-1920x1080.png)。历史材料：2024-06-25 发布图，仅用于理解并排布局。当前能力以帮助文档为准。 [原页面](https://www.anthropic.com/news/projects)。
- [Projects · 2024 年布局示例](https://www-cdn.anthropic.com/images/4zrzovbb/website/cc048db08b3503fa6d713b2b9e3352e8345c8b79-1920x1080.png)。历史材料：2024-06-25 发布图，仅用于理解布局。 [原页面](https://www.anthropic.com/news/projects)。

### Linear · 列表、预览与连续操作

参考关系：交互与视觉参考。对应特性：个人上下文管理 / 生成式工作视图。

不是个人上下文竞品，但它在列表、预览、导航和键盘操作上的设计方法很适合我们的精修阶段。

**官方能力：**Linear 的 Peek 可用空格打开预览，用方向键查看相邻条目，用 Escape 关闭。Custom Views 可以保存筛选后的问题或项目集合。 [Peek 官方帮助](https://linear.app/docs/peek)；[Custom Views 官方帮助](https://linear.app/docs/custom-views)。

**观察与解读：**

- **列表保留任务语境**：预览让用户查看详情时仍能理解当前位置，连续看多个条目不必反复进入和返回。
- **层次靠密度与对齐**：紧凑行、固定列和清楚的选中状态适合高频工具；克制并不意味着内容稀少。
- **键盘与视图相互配合**：快速移动和保存常用集合共同减少重复操作；有用的是整段连续性，而不只是快捷键数量。

**MindOS 借鉴位置：会话 / 资料列表。**优先保留滚动位置、选中条目和返回路径；提供可点击的预览入口，键盘作为加速方式。复用现有面板。

可验证场景：从列表打开来源预览 → 看相邻记录 → 关闭 → 仍停在原来的列表位置。

借鉴边界：Linear 的 Peek 是键盘入口。MindOS 仍应给鼠标和触屏用户明确入口，也不必照搬问题状态、冲刺周期和团队组织。

**界面材料：**

- [Peek · 列表中查看详情](https://webassets.linear.app/images/ornj730p/production/5205025fbe6e96bf749f76d5e1cad30b484f8b50-1052x634.png?auto=format&dpr=2&q=95&w=1440)。官方帮助截图；截图版本未标注。 [原页面](https://linear.app/docs/peek)。
- [Views · 保存常用集合](https://webassets.linear.app/images/ornj730p/production/6588c3dbdde8688ffd192a47210980e8e1a3c4fc-2494x1021.png?w=1440&q=95&auto=format&dpr=2)。官方帮助截图；截图版本未标注。 [原页面](https://linear.app/docs/custom-views)。

## 四个特性的对照

| 特性 | 用户问题 | 参考产品 | MindOS 选择 | 验证 |
| --- | --- | --- | --- | --- |
| 个人上下文管理 | 资料在哪里？我能否直接修改？ | Obsidian · Notion · Readwise | 保留树和项目；Context 表达本次选择的材料。原文件入口始终可见。 | 改一条资料后，原文件、视图和 Agent 读取结果一致。 |
| 跨 Agent 接续 | 上次说到哪里？这次带哪些背景？ | Pieces · Claude Projects · Readwise MCP | 选择原记录与已核对判断；预览后准备给指定 Agent 使用，状态准确反映已完成的步骤。 | 区分“已准备 / 已复制 / 已接收”；能定位每项材料的来源。 |
| 经验沉淀与成长 | 我当时怎么想？后来结果如何？ | Readwise · Pieces | 原话、我的判断、适用范围和后续结果放在一条可修订的记录里。 | 用户下次找得到、用得上，并能停用过时判断。 |
| 生成式工作视图 | 这些资料能否变成好用的界面？ | Obsidian Bases · Notion · Attio · Claude Artifacts | 先完成一个人脉模板。绑定原资料，支持普通维护，再增加自然语言定制。 | 刷新、改版、移除视图均不丢资料；更新写回原文件。 |

## 建议的三个小步

### 1. 原位置看出处：小幅呈现调整

印迹、资料、会话列表中的来源行靠近内容，显示原会话、时间与项目；先展开关键原话，再进入完整记录。查看、关闭与返回保持列表位置和草稿。参考 Readwise 的原文/批注关系与 Linear 的 Peek。

验收：连续查看三条来源，关闭后仍在原位置；读取失败与无来源分开呈现。依据不足时不以相似记录充当原文。

### 2. 本次带哪些材料：需要状态闭环

在项目现有上下文流程中，清楚列出选择的资料、会话与已核对判断。预览具体内容，可移除；“已准备”“已复制”“已接收”按实际证据显示。参考 Pieces 的时间/来源组织与 Claude Projects 的资料边界。

验收：用户知道为谁准备了哪些背景；私人反思不自动外发。跨 Agent 原生接收需要逐一验证，不能靠界面文案替代。

### 3. 一个真正可用的人脉模板：需要新增能力

在工作台现有应用位置形成“我的视图 / 模板”。首个模板采用联系人列表、人物详情、互动时间线和跟进。绑定关系 CSV 与人物 Markdown，普通维护写回原资料；再增加自然语言调整与模板复用。参考 Attio、Obsidian Bases、Notion 和 Claude Artifacts。

验收：记录一次互动，原文、视图与 Agent 读取一致；资料移动、写入失败、改版与撤销不会丢内容。删除视图保留资料，模板不夹带私人数据。

先核对并复用现有 CSV renderer；当前工作台“关系记忆”只是入口，不是已完成的 CRM。第三步不是纯 UI 改动，需要资料写回、实例保存及版本恢复。

## 一段完整体验

找回原记录 → 核对并保留判断 → 选入本次上下文 → 在工作视图中维护 → 根据结果修订。

先用一种已接入的会话来源、一条有用判断、一个真实人脉或项目场景完成这段流程。观察找回成功率、用户能否解释来源与范围、下一次是否确实复用，以及改版/失败时是否能恢复。材料数量、自动摘要数量和成长分数不作为价值证明。

## 材料与页面

- 页面入口：同目录的 `index.html`，无需构建。
- 页面支持产品切换、图像放大、四特性对照、提案与来源核对；也支持键盘、窄屏和图片错误提示。
- 官方界面示例于 2026-10-03 截图保存，随研究页本地提供；保留出处与历史图像标记。原图地址见 [截图来源记录](images/sources.json)，查阅官方原始材料需联网。版权属于原产品。
- `research-data.js` 是图鉴内容；本报告为本次交付的文字版本。
- 不读取用户知识库，不连接竞品账户，不修改 MindOS 生产功能。

## 与当前方向的关系

关联 [定位与 Generative UI 讨论](../../discussions/discussion-product-focus-20261003.md)。既有小步 UI 精修继续保留；这里的新方案须另行进入开发规格与验收。

## 第一轮页面验证

- 七个产品共 13 张官方图片均在浏览器成功加载；切换图片、放大、Escape 关闭与焦点恢复通过。
- 四特性对照、三项建议、来源页、直达链接与无效产品链接的回退通过。
- 桌面 1440px、手机 390px 与窄屏 320px 检查通过；表格在自身区域滚动，不撑宽页面；窄屏选中产品保持可见。
- 模拟图片加载失败：明确错误、官方材料链接与重试可用，放大入口正确禁用。
- 主文字、次级文字与链接在页面使用的四种背景上对比度均 ≥ 4.5:1；动作点击范围按 44px 处理，尊重减少动效设置。
- 独立页面脚本语法检查与 `git diff --check` 通过。截图保存在 `/tmp/mindos-ui-reference-*.png`。
- 未运行产品全量 build/typecheck：本轮没有修改生产源码或依赖，仅交付独立研究页面与文档。

本地阅读：`http://localhost:4599/`。静态服务可用 `python3 -m http.server 4599 --bind 127.0.0.1 --directory wiki/prototypes/context-ui-reference` 从项目根目录启动。
