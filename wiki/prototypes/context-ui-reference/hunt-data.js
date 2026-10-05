window.HUNT_RESEARCH = {
  date: '2026-10-03',
  products: [
    {
      id: 'capacities', name: 'Capacities', collection: 'hunt', category: '对象与知识管理', shorthand: '人物与资料的归属',
      headline: '一个人物，拥有自己的资料、关系和工作面。',
      lesson: '人物详情怎样兼顾少量结构字段与自由记录。',
      priority: true, pillars: [0, 3],
      relevance: '对人脉模板最有帮助：先打开一个具体的人，再按需看属性、关联与记录。这个心智容易落在现有树和项目中。',
      facts: 'Capacities 用人物、书籍、项目等对象组织内容，支持自定义对象类型、属性、模板与反向链接；同类对象可用列表、图库、表格等视图查看。',
      looks: [
        ['内容占据主要空间', 'Art Déco 示例中，正文和图片占主区；对象类型在左侧，提纲与相关对象在旁边。内容与导航有清楚的层次。'],
        ['字段长在对象上', '书籍详情把作者、状态、日期放在标题附近。“添加属性”在需要时展开，阅读正文前不必先填写完整表单。'],
        ['关联可以就地理解', '对象旁保留关系与关联内容，适合从一条记录了解背景。MindOS 可让人物资料与原会话在同一位置接续。']
      ],
      adaptation: ['工作台 / 人脉模板', '默认只露出姓名、背景、最近互动和下一次跟进。长记录在下方，关联会话在侧边；更多字段按需展开。视图仍绑定原文件，人物列表继续沿用已有项目归属。'],
      scenario: '从项目树打开人物 → 看最近互动 → 核对原会话 → 记录下一次跟进。',
      boundary: '对象索引可以帮助阅读。暂不要求用户迁移全部 Markdown，也不把自定义类型与字段配置作为首次使用的前置步骤。',
      sources: [
        ['对象与视图 · 官方产品页', 'https://capacities.io/product'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/capacities']
      ],
      images: [
        {src: 'images/hunt/capacities-overview.jpg', title: '正文、提纲与关联对象', alt: 'Capacities 官方界面：左侧对象导航，中间 Art Déco 正文，旁边是提纲与对象详情', note: '官方产品页公开界面示例；版本未标注。', source: 'https://capacities.io/product'},
        {src: 'images/hunt/capacities-properties.jpg', title: '对象详情 · 属性按需展开', alt: 'Capacities 官方书籍对象详情，作者、阅读状态等属性与添加属性菜单', note: '官方对象详情局部示例；版本未标注。', source: 'https://capacities.io/product'}
      ]
    },
    {
      id: 'mymind', name: 'mymind', collection: 'hunt', category: '个人收藏与找回', shorthand: '收藏的辨识与检索',
      headline: '先认出内容，再决定怎样整理。',
      lesson: '用内容缩略图，让集合更容易认出来。',
      priority: true, pillars: [0, 2],
      relevance: '它最值得学习的是收藏与找回的轻盈感：视觉线索可以辅助记忆，界面不急着要求用户完成分类。',
      facts: 'mymind 支持保存多种内容，用 AI 识别与标记，并按关键词、颜色、日期等搜索。Smart Spaces 可按条件自动聚合；Focus Mode 支持写作，Serendipity 用于重新发现已保存的内容。',
      looks: [
        ['集合展示实际内容', '官方 Spaces 教程封面用叠放的内容缩略图表示集合。与一排相似文件夹相比，用户能凭图像辨认“上次那个项目”。'],
        ['控制藏得很轻', '这个局部界面只保留窄导航和必要的集合信息，视觉注意力集中在自己的内容上。'],
        ['回看与搜索互补', '自动聚合和重新发现是官方能力；它们可以补充主动查找。对 MindOS 的价值仍需以“能否找回并继续使用”验证。']
      ],
      adaptation: ['心智 / 最近资料', '保留树；在已有“最近”区域尝试少量内容预览。保存时允许先收下，随后补项目归属。自动聚合要解释条件，并允许修正或移除。'],
      scenario: '想不起文件名 → 认出项目里的图片或片段 → 打开原文 → 回到原目录。',
      boundary: '保留 MindOS 用户对树、文件夹和路径的掌控。时间排序、文字搜索与文本列表仍要可用；视觉集合不会适合所有资料。',
      sources: [
        ['产品与功能 · 官方网站', 'https://mymind.com/'],
        ['Spaces 教程与界面', 'https://mymind.com/videos'],
        ['功能说明 · 官方 FAQ', 'https://mymind.com/faq'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/my-mind']
      ],
      images: [
        {src: 'images/hunt/mymind-spaces.webp', title: 'Spaces · 内容预览识别集合', alt: 'mymind 官方教程封面的 Spaces 界面，集合使用内容缩略图和名称呈现', note: '官方教程封面中的局部界面，含叠放预览；不是完整应用截图。版本未标注。', source: 'https://mymind.com/videos'}
      ]
    },
    {
      id: 'heptabase', name: 'Heptabase', collection: 'hunt', category: '研究与视觉思考', shorthand: '原文与理解同屏',
      headline: '读原文、形成理解，都留在同一个工作面。',
      lesson: '看资料与核对 AI 解读时，怎样减少来回切换。',
      priority: true, pillars: [0, 2],
      relevance: '对“印迹 → 查看出处 → 保留自己的判断”最直接。它也说明白板可以作为一个局部工作面，与正文阅读相互配合。',
      facts: 'Heptabase 提供白板、卡片笔记、PDF 阅读与高亮，以及连接资料的 AI 研究功能。官网展示白板、PDF 原文与基于资料的 AI 解读并排使用。',
      looks: [
        ['原文与解读并排', '研究示例中 PDF 在中间，AI 解读在右侧。来源可以持续核对，不必在对话与阅读页面之间反复切换。'],
        ['选中卡片仍保留位置', '白板示例在右侧展开笔记，画布上的相关卡片仍可见。这种持续的空间关系能帮助用户理解当前内容的归属。'],
        ['工作面围绕一个主题', '白板适合把某个研究主题拆成相关片段。对已有树结构的用户，可把它作为项目的可选视图。']
      ],
      adaptation: ['回响 / 来源预览', '打开一条印迹时，在旁边保留原文片段与项目归属。明确区分“原话”“AI 候选解读”“我的判断”；关闭来源后保持选中项、滚动与草稿。'],
      scenario: '看到一条候选经验 → 对照原话 → 修改为自己的判断 → 继续处理下一条。',
      boundary: '先借鉴来源与理解的空间关系。白板只作为可选项目视图，不替换全局树，也不把自动关联等同于用户认同的判断。',
      sources: [
        ['白板与 AI 研究 · 官方网站', 'https://heptabase.com/'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/heptabase']
      ],
      images: [
        {src: 'images/hunt/heptabase-research.png', title: '白板、PDF 与 AI 解读', alt: 'Heptabase 官方研究界面，左侧白板、中间 PDF 原文、右侧 AI 解读', note: '官网公开研究界面示例；版本未标注。', source: 'https://heptabase.com/'},
        {src: 'images/hunt/heptabase-whiteboard.png', title: '白板 · 选中笔记侧边展开', alt: 'Heptabase 白板中的笔记组与关联线，选中笔记在右侧展开正文', note: '官网公开白板界面示例；版本未标注。', source: 'https://heptabase.com/'}
      ]
    },
    {
      id: 'tana', name: 'Tana Outliner', collection: 'hunt', category: '大纲与结构化视图', shorthand: '记录逐渐成为结构',
      headline: '先写下记录，再把需要的部分变成结构。',
      lesson: '让普通记录逐步拥有字段与可重复使用的视图。',
      pillars: [0, 3],
      relevance: '它对我们最大的启发是组织方式的渐进性：用户可以从熟悉的记录开始，只给需要管理的部分增加结构。',
      facts: 'Tana Outliner 的 Supertag 可给节点添加类型与字段；Search Nodes 可实时聚合节点，并以大纲、表格、卡片等形式查看。当前官网已将 Outliner 与 tana.inc 的会议产品区分。',
      looks: [
        ['类型贴在记录上', '任务局部示例在一条任务下放状态、日期和项目。结构服务于这条记录的维护，字段靠近内容。'],
        ['相关内容按需汇集', '会议示例突出人物信息与后续事项；Search Nodes 的官方说明支持按条件聚合分散节点。集合可以成为可再次打开的工作视图。'],
        ['局部结构不等于全局改版', '对 MindOS，可让已有文件或项目增加一个模板视图。普通笔记继续按原方式阅读。']
      ],
      adaptation: ['工作台 / 模板入口', '从已有资料选择“用人脉模板查看”，先提供少量默认字段。保存为有名字的视图，再允许更改筛选和布局；原文件入口始终可达。'],
      scenario: '已有一组人物记录 → 套用模板 → 查看“待跟进” → 回到原人物笔记。',
      boundary: '避免一开始引入节点、类型、标签、查询等多层概念。这里研究 Outliner；会议产品的当前能力与界面应另行评估。',
      sources: [
        ['Outliner · 当前官方产品', 'https://outliner.tana.inc/'],
        ['Search Nodes · 官方说明', 'https://outliner.tana.inc/search-nodes'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/tana']
      ],
      images: [
        {src: 'images/hunt/tana-tasks.webp', title: 'Supertag · 任务字段', alt: 'Tana Outliner 官网局部任务示例，展示状态、日期和项目字段', note: '官网局部界面展示；不是完整应用截图。版本未标注。', source: 'https://outliner.tana.inc/'},
        {src: 'images/hunt/tana-overview.webp', title: '会议记录 · 人物与后续事项', alt: 'Tana Outliner 官方会议记录展示，人物信息与后续事项被放大突出', note: '官网界面展示图，局部内容经过放大编排；不是原尺寸完整应用截图。', source: 'https://outliner.tana.inc/'}
      ]
    },
    {
      id: 'fabric', name: 'Fabric', collection: 'hunt', category: '资料工作空间', shorthand: '围绕项目聚合资料',
      headline: '进入一个项目，先看到它的内容。',
      lesson: '项目怎样接住文件、笔记与下一步工作。',
      pillars: [0, 1, 3],
      relevance: '项目页面把相关材料聚集起来，适合研究我们工作台里的“继续项目”。当前官网也展示 Agent 与跨工具工作能力，交互完成度尚未登录核验。',
      facts: 'Fabric 将文件、笔记等资料放在工作空间中，提供 Spaces、可视化画布与关联资料的任务能力；当前官网还介绍跨工具的 Agent 工作。',
      looks: [
        ['项目标题接近内容', 'Project [M] 示例先给出项目名称与简短说明，下方立即呈现资料，进入页面后的目的清楚。'],
        ['混合资料保持可辨认', '图片、文档等用预览和文件名呈现。视觉丰富时仍保留名称，帮助确认具体材料。'],
        ['助手入口尺度较小', '这张公开项目示例把助手入口放在底部，资料占主区。这是该展示图中的层次，不代表全部当前产品流程。']
      ],
      adaptation: ['工作台 / 继续项目', '沿用现有项目入口；进入后先显示最近使用的文件、相关会话和本次已选材料。少量预览帮助辨认，文字列表用于高密度资料，辅助动作贴近正在处理的内容。'],
      scenario: '继续上次项目 → 找回最近文件与会话 → 检查本次材料 → 接着工作。',
      boundary: '先改善已在 MindOS 中的项目资料组织。跨服务连接、云迁移和 Agent 角色体系各有成本，不列为本轮最小 UI 调整。',
      sources: [
        ['工作空间与 Agent · 官方网站', 'https://fabric.so/'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/fabric-6']
      ],
      images: [
        {src: 'images/hunt/fabric-project.png', title: 'Space · 项目资料工作面', alt: 'Fabric 官网项目资料示例，标题下用预览与文件名展示图片和文档', note: '官网公开项目工作面示例；裁去应用外层，版本未标注。', source: 'https://fabric.so/'}
      ]
    },
    {
      id: 'recall', name: 'Recall', collection: 'hunt', category: '知识收藏与复习', shorthand: '收藏后的再次使用',
      headline: '保存之后，还要有再次使用的理由。',
      lesson: '把保存、个人笔记和后续回看连在一起。',
      pillars: [0, 1, 2],
      relevance: '它提示我们关注“之后怎么办”。MindOS 的经验成长需要让判断回到真实工作，而不是只显示更多总结。',
      facts: 'Recall 卡片区分 Reader 原内容与 Notebook 个人笔记，提供测验和间隔复习；MCP 文档当前列出的能力为只读搜索、读取和探索，写入仍待支持。',
      looks: [
        ['来源在资料卡上可见', '官网知识库示例在标题下标明来源网站与类型。进入详情前，用户已能分辨内容从哪里来。'],
        ['时间帮助重新进入', '示例用 Today、Yesterday 分组，回到近期保存的内容容易找到起点。MindOS 可在已有最近区域提供这种线索。'],
        ['回看需要明确对象', 'Notebook 与复习是官方文档能力，本图没有展示对应流程。可借鉴保存后的再次使用机制，具体交互需要独立验证。']
      ],
      adaptation: ['回响 / 判断回看', '一条经验保留原话、我的判断、适用范围与后续结果。允许主动设一次回看时间，到时检查“仍适用 / 需修订 / 已停用”，再选择是否带到下次工作。'],
      scenario: '保留一个判断 → 实际用一次 → 记下结果 → 下次接续前确认是否仍适用。',
      boundary: '不据此承诺学习效果。专业经验未必适合测验、连续打卡或成长评分；回看以用户选择和真实使用场景为依据。',
      sources: [
        ['知识库 · 官方网站', 'https://www.recall.it/'],
        ['Reader 与 Notebook · 官方帮助', 'https://docs.recall.it/getting-started/3-summarize-and-chat-with-content'],
        ['回看与复习 · 官方帮助', 'https://docs.recall.it/getting-started/6-review-content'],
        ['MCP 能力范围 · 官方文档', 'https://docs.recall.it/developer/mcp'],
        ['Product Hunt 产品页', 'https://www.producthunt.com/products/recall-6']
      ],
      images: [
        {src: 'images/hunt/recall-library.webp', title: 'Library · 来源与时间分组', alt: 'Recall 官网设备展示图中的知识库界面，按日期排列资料卡，并标注来源', note: '官网设备展示图中的知识库界面；版本未标注。本图没有展示 Notebook 或复习流程。', source: 'https://www.recall.it/'}
      ]
    }
  ],
  watchlist: [
    {
      name: 'Atlaso', scope: '共享 Agent 记忆',
      meaning: '当前官网列出 Claude Code、Cursor、Codex 等共享记忆，并介绍项目范围与冲突处理。跨 Agent 记忆已有直接重叠。',
      question: '本次实际带入哪些判断？能否修正、停用，并验证下一次是否生效？',
      limit: '官网将 ChatGPT 标为 Soon；本轮未安装测试，也不将发布页讨论中的历史疑问视为当前缺陷。',
      sources: [['当前官网', 'https://www.atlaso.ai/'], ['Product Hunt', 'https://www.producthunt.com/products/atlaso']]
    },
    {
      name: 'ContextPool', scope: '会话 → 可复用经验',
      meaning: 'Product Hunt 发布者介绍从 Claude Code、Cursor 会话提取修复、决策与经验，并通过 MCP 提供上下文。与我们关注的路径很接近。',
      question: '自动提取的候选与用户确认的判断，如何区分？依据变化时怎样更新？',
      limit: '上述为发布者主张，未安装验证；当前公开仓是二进制发布/安装仓，不能据此确认核心源码开放。',
      sources: [['公开发布仓', 'https://github.com/syv-labs/cxp'], ['Product Hunt', 'https://www.producthunt.com/products/contextpool']]
    },
      {
      name: 'Supermemory', scope: 'Agent 记忆基础设施',
      meaning: '当前官网侧重面向 Agent 的记忆基础设施、API 与接入。Product Hunt 上的早期个人收藏产品叙述不能直接代表现在的工作界面。',
      question: '共享记忆接入之外，用户怎样核对出处、理解范围，并维护长期判断？',
      limit: '作为能力与定位观察项；未把历史收藏界面当作当前消费者 UI，也未验证性能指标。',
      sources: [['当前官网', 'https://supermemory.ai/'], ['Product Hunt', 'https://www.producthunt.com/products/supermemory']]
    }
  ]
};
window.UI_RESEARCH.products.push(...window.HUNT_RESEARCH.products);
