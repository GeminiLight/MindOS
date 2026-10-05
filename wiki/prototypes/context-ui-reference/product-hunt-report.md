# MindOS · Product Hunt 产品与界面精选

> 研究日期：2026-10-03。对话分类：产品定位 / 竞品与 UI 研究。
> 用户要求：继续到 Product Hunt 寻找有借鉴价值、界面更精致的产品，扩充已有网页材料。
> Workflow：Product Hunt 发现 → 官方当前资料核对 → 公开界面逐张检查 → 六项 UI 研究与三个定位观察项 → 页面验证与展示。
> 状态：设计研究与提案；未登录试用竞品，未修改 MindOS 生产功能。

## 建议先看的三个

**Capacities、mymind、Heptabase** 分别帮助我们打磨人物资料、内容辨识、出处与理解。选择依据是当前问题的匹配度及可核对的公开材料；不是 Product Hunt 榜单排名，也不是完整的产品质量评测。

这轮的判断：**记录先有归属，理解始终有出处，视图能继续维护。** 树和项目可以保留，新能力接在具体资料与已有操作上。精致来自内容与控制的层次、上下文的连续性、维护后的可恢复性；配色和圆角只支撑这些选择。

## 选取与证据边界

- Product Hunt 用于发现及核对发布者的产品叙述；能力以当前官方页面或文档为准。发布者主张与亲自验证分开标明。
- 六个界面参考：Capacities、mymind、Heptabase、Tana Outliner、Fabric、Recall。它们是相邻产品或交互参考，不能全部当作直接竞品。
- 三个定位观察项：Atlaso、ContextPool、Supermemory。与跨 Agent 记忆或经验复用更接近，本轮未获得足够可核对的当前操作界面，未列入 UI 图鉴。
- 九张官方公开界面媒体原样归档，逐张检查内容；局部、放大编排和设备展示图均标明。它们不等于登录账户的当前版本截图。
- 原文件 URL、来源页、日期、类型与归档方式见 [本轮图像来源](images/hunt-sources.json)。第一轮 13 张截图的记录仍保留在 [原来源文件](images/sources.json)。图片版权属于原产品，仅用于这份设计研究。

## 1. Capacities：人物与资料的归属

[Product Hunt](https://www.producthunt.com/products/capacities) · [官方产品页](https://capacities.io/product)

**官方能力：** 用人物、书籍、项目等对象组织内容，支持对象类型、属性、模板、反向链接与多种视图。以上依据官方产品页。

**界面观察：** 正文在中间，占据主要空间；类型导航在左侧，提纲与相关对象在旁边。另一张书籍详情示例把作者、状态与日期放在标题附近，更多属性按需展开。

精致的地方是“人物是谁、有什么记录、关联什么内容”处于同一个阅读位置。结构没有吞掉正文，详情也没有变成全屏表单。这对我们的人脉模板有直接参考价值。

**MindOS 提案：** 人物详情先显示姓名、背景、最近互动、下次跟进；长记录留在下面，原会话在旁边。更多字段按需展开。列表、筛选与详情绑定已有 CSV/Markdown，仍可打开原文件。

**借鉴边界：** 对象索引可以帮助阅读，但不要求用户迁移全部知识库或先配置类型系统。文件路径、项目归属与 Agent 读取的一致性仍需验证。

界面材料：[正文、提纲与关联对象](images/hunt/capacities-overview.jpg)、[对象属性详情](images/hunt/capacities-properties.jpg)。官方示例，版本未标注。

## 2. mymind：收藏的辨识与检索

[Product Hunt](https://www.producthunt.com/products/my-mind) · [官网](https://mymind.com/) · [官方 FAQ](https://mymind.com/faq) · [Spaces 教程](https://mymind.com/videos)

**官方能力：** 保存多种内容，自动识别与标记；可以按关键词、颜色、日期等搜索。Smart Spaces 按条件聚合，Focus Mode 用于写作，Serendipity 帮助重新发现已保存的内容。

**界面观察：** 本轮检查的 Spaces 教程封面用内容缩略图和集合名呈现每个集合。预览有差异，用户容易凭印象认出要找的内容；局部界面中的导航很轻。

精致来自“认出来”的能力。用户想不起文件名时，图片、片段与近期使用线索可以协助找回。但这张图只是教程封面，不能据此推断完整的最新应用布局。

**MindOS 提案：** 在已有“最近”区域试少量预览，不增加首页大面积瀑布流。收集时先收下，随后补项目归属；自动聚合需要解释条件，并允许修正。

**借鉴边界：** 保留树、文件夹、路径和高密度文本列表。视觉预览对代码、长文、相似标题资料未必有效，需按资料类型验证。

界面材料：[Spaces 局部界面](images/hunt/mymind-spaces.webp)。来自官方教程封面；不是完整应用截图。

## 3. Heptabase：原文与理解同屏

[Product Hunt](https://www.producthunt.com/products/heptabase) · [官方白板与研究功能](https://heptabase.com/)

**官方能力：** 白板、卡片笔记、PDF 阅读与高亮，以及连接资料的 AI 研究功能。官网展示白板、原文与 AI 解读并排使用。

**界面观察：** 研究示例把 PDF 放在中间，解读放在右边，主题资料仍留在左侧。另一张白板示例在右侧展开选中笔记，关联卡片仍能看到。

这里值得学习的是空间连续性：看解读时能核对原文，读笔记时还能理解它在哪个主题中。对于我们的候选经验审核，这比独立一个新的“分析中心”更容易顺手。

**MindOS 提案：** 印迹旁保留原话与项目归属，区分原话、AI 候选解读和我的判断。连续核对多条来源后，选中项、滚动与草稿仍在。

**借鉴边界：** 先借鉴来源与理解的关系。白板可以是可选项目视图；不替换全局树，不把自动关联当作用户已经认同。

界面材料：[PDF 与 AI 解读](images/hunt/heptabase-research.png)、[白板与笔记详情](images/hunt/heptabase-whiteboard.png)。官网公开示例，版本未标注。

## 4. Tana Outliner：记录逐渐成为结构

[Product Hunt](https://www.producthunt.com/products/tana) · [当前 Outliner 官网](https://outliner.tana.inc/) · [Search Nodes 文档](https://outliner.tana.inc/search-nodes)

**官方能力：** Supertag 为节点添加类型与字段；Search Nodes 实时聚合节点，并提供大纲、表格、卡片等呈现。

**版本注意：** 当前官方已区分 Outliner 与 [tana.inc 的会议产品](https://tana.inc/)。本研究讨论 Outliner，不能将旧发布叙述、Outliner 图像与会议产品功能混成同一个最新界面。

**界面观察：** 任务局部示例把状态、日期和项目直接放在任务下面；会议展示图突出人物信息与后续事项。后者经过局部放大编排，并非完整原尺寸截图。

可以借鉴记录的渐进结构：普通内容先可写、可读，确实需要维护时才增加少量字段和一个有名字的视图。

**MindOS 提案：** 从已有资料选择“用人脉模板查看”，默认字段少而明确。保存筛选与布局，支持再次打开；自然语言调整留在这段基础流程之后。

**借鉴边界：** 初次使用不同时引入节点、类型、标签、查询多套概念。仍以资料、对话和项目表达主要心智。

界面材料：[任务字段局部](images/hunt/tana-tasks.webp)、[人物与后续事项展示](images/hunt/tana-overview.webp)。后者有放大编排，均未标版本。

## 5. Fabric：围绕项目聚合资料

[Product Hunt](https://www.producthunt.com/products/fabric-6) · [当前官网](https://fabric.so/)

**官方能力：** 工作空间内聚合文件与笔记，提供 Spaces、画布和关联资料的任务能力；当前官网也介绍跨工具 Agent 工作。

**界面观察：** 公开 Project [M] 示例先呈现项目名称和说明，下面直接是图片、文档预览与文件名，助手入口较小。资料的视觉表现丰富，但仍能确认具体文件。

这张图适合研究“继续项目”的内容层次。它是官网局部工作面示例，不能代表全部当前 Agent 流程。

**MindOS 提案：** 在现有项目入口中先露出最近使用的文件、相关会话与本次已选材料。文字列表处理高密度内容，必要的缩略图辅助辨认。

**借鉴边界：** 先改善已接入的资料；跨服务同步、云迁移与角色体系不是本轮最小 UI 范围。

界面材料：[项目资料工作面](images/hunt/fabric-project.png)。官方局部示例，版本未标注。

## 6. Recall：收藏后的再次使用

[Product Hunt](https://www.producthunt.com/products/recall-6) · [当前官网](https://www.recall.it/) · [Reader 与 Notebook](https://docs.recall.it/getting-started/3-summarize-and-chat-with-content) · [回看](https://docs.recall.it/getting-started/6-review-content) · [MCP](https://docs.recall.it/developer/mcp)

**官方能力：** Reader 与 Notebook 区分原内容和个人笔记，提供测验与间隔复习。当前 MCP 文档列出只读搜索、读取和探索；写入仍待支持。

**界面观察：** 官网设备展示图内的知识库按日期分组，资料卡保留标题、网站与类型。本图没有展示 Notebook 或复习流程，这部分分析依据文档。

它对我们最大的价值是保存后的下一步。经验如果只被提取、存下，却没有回到真实任务或后续结果，就很难证明它帮助人成长。

**MindOS 提案：** 经验保留原话、我的判断、范围和后续结果。用户可设一次回看时间，主动确认仍适用、需修订或停用；在下一次工作中选择是否使用。

**借鉴边界：** 专业经验不一定适合测验、连续打卡或自动评分；没有本轮证据证明这些机制适合 MindOS 用户或能改善判断。

界面材料：[知识库与日期分组](images/hunt/recall-library.webp)。官方设备展示图，非登录账户截图；版本未标注。

## 三个更接近定位的观察项

| 产品 | 当前可核对的范围 | 对 MindOS 的意义 | 核对边界 |
| --- | --- | --- | --- |
| [Atlaso](https://www.atlaso.ai/) / [PH](https://www.producthunt.com/products/atlaso) | 官网列出 Claude Code、Cursor、Codex 等共享记忆，以及项目范围与冲突处理。 | “连接多个 Agent”已有直接重叠；应验证单条记忆的核对、修正与生效反馈。 | ChatGPT 标为 Soon；未安装测试。发布页历史疑问不等于当前缺陷。 |
| [ContextPool 发布仓](https://github.com/syv-labs/cxp) / [PH](https://www.producthunt.com/products/contextpool) | PH 发布者介绍从 Claude Code、Cursor 会话提取修复、决策与经验，经 MCP 复用。 | 自动候选与人确认的判断如何区分，如何维护过时经验，需要明确。 | 发布者主张未亲测；公开仓是二进制发布/安装仓，其 README 指明实际 Rust 源码另在私有仓，不能据此确认核心源码开放。 |
| [Supermemory](https://supermemory.ai/) / [PH](https://www.producthunt.com/products/supermemory) | 当前官网侧重 Agent 记忆基础设施、API 与接入。 | 记忆基础能力并非空白；用户维护出处、范围和长期判断的体验仍要验证。 | 不拿 PH 早期收藏产品的图像当作当前消费者 UI；未验证性能指标。 |

以上三项作为能力与定位观察，本轮不评价其登录后的 UI 精致程度。不宣称 MindOS 已有独占能力。

## 把这一轮放回四个特性

| 特性 | 新增参考 | 可以借鉴的具体关系 | 暂不增加 |
| --- | --- | --- | --- |
| 个人上下文管理 | Capacities、mymind、Fabric | 对象与项目接住资料；内容线索帮助辨认；原路径仍清楚。 | 全量对象迁移、替换目录树、默认瀑布流。 |
| 跨 Agent 接续 | Atlaso、ContextPool、Supermemory；Recall MCP | 核对范围、选择本次材料、修正记忆后确认是否生效。 | 单靠接入数量的定位；没有接收证据的成功提示。 |
| 经验沉淀与成长 | Heptabase、Recall | 原话与理解一起核对，保存后通过真实结果回看与修订。 | 强制测验、连续打卡、自动成长评分。 |
| 生成式工作视图 | Capacities、Tana Outliner；第一轮 Attio/Bases | 普通资料逐渐拥有少量字段，视图有名字、能维护、可再次打开。 | 先搭任意应用平台，再寻找实际用途。 |

## 对此前三个小步的补充

1. **原位置看出处。** 加入 Heptabase 的原文/理解关系。原话、候选和我的判断区分清楚；只预览不丢草稿，读取失败要真实提示。
2. **明确本次带哪些材料。** 三个记忆产品说明这已是重叠赛道。将材料清单、项目范围、单条移除和实际接收证据做具体，不用笼统“已同步”替代。
3. **一个可维护的人脉模板。** 加入 Capacities 的详情层次与 Tana 的渐进结构。默认字段少，记录在内容位置；先完成写回、实例保存、再次打开与恢复，再增加生成式定制。

这些均为后续设计建议。第三项涉及状态与资料写回，不应作为仅改 CSS 的任务估算。近期未建议增加一级入口或整体重排页面。

## 页面与复验方式

- [交互网页](index.html#hunt)：六个精选概览 → 每个产品的界面、三条观察、能力来源、落地提案、借鉴边界；另有三个定位观察项。
- 基础七产品继续可用。图鉴按“本轮精选 / 基础参考”切换，旧的产品直达链接保留。
- 文本材料可从精选页下载；来源章节统一列出 16 个产品/观察项。
- 从项目根目录启动独立静态服务：`python3 -m http.server 4599 --bind 127.0.0.1 --directory wiki/prototypes/context-ui-reference`。
- 在服务运行时，执行 `node wiki/prototypes/context-ui-reference/qa.cjs` 复验。浏览器检查只访问该本地研究页。
- 不读取用户知识库，不连接竞品账户，不新增生产依赖，不执行发布。

本轮浏览器检查通过：13 个图鉴产品/22 张图像、分组与键盘导航、直达/回退、放大与焦点恢复、图片失败重试，以及 390px/320px 五个章节布局。修正了缩窄视口后返回图鉴时选中产品被挤出列表的问题。详细记录见 [本轮 review](../../reviews/review-context-ui-reference-20261003.md)。本地入口：`http://localhost:4599/#hunt`。
