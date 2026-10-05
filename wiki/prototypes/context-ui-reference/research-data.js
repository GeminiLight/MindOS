window.UI_RESEARCH = {
  date: '2026-10-03',
  pillars: ['个人上下文管理', '跨 Agent 接续', '经验沉淀与成长', '生成式工作视图'],
  products: [
    {
      id: 'obsidian', name: 'Obsidian', category: '相邻竞品', shorthand: '资料与视图',
      headline: '让文件保持熟悉，让视图变得有用。',
      relevance: '最贴近 MindOS 本地文件基础的参考。尤其值得看 Bases：整理方式可以变，原始资料仍有稳定归属。',
      pillars: [0, 3],
      facts: 'Bases 可以查看、编辑、筛选笔记及其属性；同一个 Base 可以有多个视图。资料保存在本地 Markdown 文件中，视图定义可以保存为 .base 文件。',
      looks: [
        ['以内容为中心', '书籍以行呈现，标题和属性直接进入工作面，用户先处理内容，再考虑组织方式。'],
        ['视图有名字', '不同呈现可以作为可回到的视图存在。“再打开刚才的视图”比“再生成一次界面”更容易形成日常习惯。'],
        ['文件与视图各有归属', '这是数据模型带来的体验优势：用户可以更换呈现方式，同时保持原文件的可读性。']
      ],
      adaptation: ['心智 / 工作台', '保留文件树；在人脉 CSV 或关联项目上增加可命名的视图。始终提供“打开原文件”，视图筛选和布局单独保存。'],
      boundary: '借鉴文件与视图的关系。先用模板提供默认字段，避免让初次使用的人先学习查询语法和属性体系。',
      scenario: '打开关系总览 → 切到“待跟进” → 维护一个人物 → 在原文件中看到同一项更新。',
      sources: [
        ['Bases 官方帮助', 'https://obsidian.md/help/bases'],
        ['官方截图源文件', 'https://github.com/obsidianmd/obsidian-help/blob/master/en/Attachments/bases-noshadow.png']
      ],
      images: [{
        src: 'images/obsidian-1.png', original: 'https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Attachments/bases-noshadow.png',
        title: 'Bases · 书籍表格',
        alt: 'Obsidian 官方 Bases 示例，以表格组织书籍文件和属性',
        note: '官方帮助示例；截图版本未标注。',
        source: 'https://obsidian.md/help/bases'
      }]
    },
    {
      id: 'pieces', name: 'Pieces', category: '接近定位的竞品', shorthand: '工作记忆与接续',
      headline: '先找回发生过的事，再继续工作。',
      relevance: '在这组产品中最接近“跨工具工作记忆”的方向，值得认真比较定位，而不只是看视觉。',
      pillars: [0, 1, 2],
      facts: 'Pieces 用时间线呈现捕获的工作事件，支持按类型、来源筛选和查看事件内容。官网说明其 MCP 可将工作历史带入兼容助手，并提供暂停捕获及按来源删除的控制。',
      looks: [
        ['时间成为入口', '左侧按天组织事件，主区阅读选中的内容。用户可以从“上周做过什么”进入，而不必先记住文件名。'],
        ['来源帮助辨认', '工具、时间和事件类型让相似记录更容易区分，也帮助核对回忆的出处。'],
        ['记忆需要管理面', '暂停与删除的可见控制提醒我们：接入越方便，用户越需要知道正在收集什么。']
      ],
      adaptation: ['协作记录 / 回响', '给已有会话列表补足时间、来源和项目；选中后在主区看原文，再挑选值得保留的判断。接续前预览确切材料。'],
      boundary: '自动捕获是 Pieces 的产品选择。MindOS 近期可以聚焦明确接入的会话和资料；候选经验须能核对、修订和停止使用。',
      scenario: '找到上次 Codex 的讨论 → 定位那条取舍 → 加入本次上下文 → 为另一个 Agent 准备材料。',
      sources: [
        ['Pieces 官方产品页', 'https://pieces.app/'],
        ['Timeline 官方帮助', 'https://docs.pieces.app/products/desktop/timeline'],
        ['对话检索官方帮助', 'https://docs.pieces.app/products/desktop/conversational-search']
      ],
      images: [
        {src:'images/pieces-1.png', original:'https://ik.imagekit.io/pieces/images/home/pieces-desktop-timeline.png?tr=w-1880%2Ch-1436&v=1782488482084849', title:'Desktop · 事件与主区', alt:'Pieces 官方桌面界面展示时间线、摘要和工作活动', note:'当前官网展示图；截图版本未标注。', source:'https://pieces.app/'},
        {src:'images/pieces-2.png', original:'https://ik.imagekit.io/pieces/images/home/pieces-desktop-timeline-feature.png?tr=w-1360&v=1784581911806178', title:'Timeline · 按时间找回', alt:'Pieces 官方时间线功能展示图', note:'当前官网功能展示图；截图版本未标注。', source:'https://pieces.app/'}
      ]
    },
    {
      id: 'reader', name: 'Readwise Reader', category: '相邻竞品', shorthand: '原文、批注与回看',
      headline: '让自己的理解贴着原文生长。',
      relevance: '为“经验沉淀与成长”提供具体的界面参考：阅读、标注和再次回看可以衔接成日常行为。',
      pillars: [0, 1, 2],
      facts: 'Reader 支持高亮和批注，内容可同步到 Readwise 供回看；其 Filtered Views 可保存筛选后的资料集合。当前官网也提供 MCP 连接助手读取资料的说明。',
      looks: [
        ['阅读占据主区', '界面的重点是正在读的内容；批注靠近原文，比单独跳去“成长中心”更能保留理解的语境。'],
        ['小动作能积累', '标记一段、写一句自己的解释，是一次可完成的操作；积累价值来自以后还能找到它。'],
        ['按需要回到内容', '保存的筛选视图可成为固定入口。对 MindOS 来说，“待核对”“最近复用”比泛化总览更接近实际任务。']
      ],
      adaptation: ['回响 / 印迹', '将“原话”和“我的判断”放在同一阅读流程中；保留来源定位。回看时补充“后来发生了什么”，支持修改适用范围。'],
      boundary: 'Readwise 的复习机制不能直接证明用户成长。MindOS 先把经验与实际结果连起来，再决定提醒频率；不以打卡或分数替代判断。',
      scenario: '读原会话 → 保留自己的判断 → 下次复用 → 在同一条记录里补充结果与修订。',
      sources: [
        ['Reader 官方产品页', 'https://readwise.io/read'],
        ['高亮与批注官方帮助', 'https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes'],
        ['Filtered Views 官方帮助', 'https://docs.readwise.io/reader/docs/faqs/filtered-views']
      ],
      images: [
        {src:'images/reader-1.png', original:'https://d34adp677peecb.cloudfront.net/static/images/reader/Hero-Screen%401x.72ad6bf1deaa.webp',title:'Reader · 资料与阅读',alt:'Readwise Reader 官方桌面界面展示资料列表与阅读区',note:'当前官网展示图；截图版本未标注。',source:'https://readwise.io/read'},
        {src:'images/reader-2.png', original:'https://d34adp677peecb.cloudfront.net/static/images/reader/Highlight-Alpha-No-Note%401x.28c2c4cc2706.webp',title:'Highlight · 就地标注',alt:'Reader 官方高亮阅读示例',note:'当前官网高亮功能展示图；截图版本未标注。',source:'https://readwise.io/read'}
      ]
    },
    {
      id: 'notion', name: 'Notion', category: '相邻竞品', shorthand: '一份资料，多种视图',
      headline: '把工作方式放进视图，而不是增加目录。',
      relevance: '值得借鉴的是数据、页面与视图之间的组织方式，尤其适合研究内置模板的用户心智。',
      pillars: [0, 3],
      facts: 'Notion 数据库可用表格、列表、看板等视图呈现同一份内容。每个视图可有自己的布局和筛选设置；数据库页面支持侧边预览。',
      looks: [
        ['视图围绕任务', '看板适合状态推进，列表适合快速查找。切换表达的是“现在要怎样处理资料”。'],
        ['详情可以靠近列表', '侧边预览保留左侧数据库的操作空间，减少查看一个条目后再找回列表的往返。'],
        ['配置按需出现', '布局、字段和筛选放在视图设置里。默认工作面可以简洁，定制能力仍可被找到。']
      ],
      adaptation: ['工作台 / 我的视图', '模板先带一个可立即使用的默认视图；用户可以重命名、筛选和另存视图。人脉、项目和研究资料继续绑定原文件。'],
      boundary: '多视图本身不等于 Generative UI。MindOS 需要另外完成自然语言定制、稳定保存和写回原资料；也应控制字段与配置的初始复杂度。',
      scenario: '从“人脉管理”模板开始 → 绑定已有 CSV → 保存“本周待跟进” → 以后从项目直接打开。',
      sources: [
        ['数据库视图官方帮助', 'https://www.notion.com/help/views-filters-and-sorts'],
        ['项目官方产品页', 'https://www.notion.com/product/projects']
      ],
      images: [
        {src:'images/notion-1.png', original:'https://images.ctfassets.net/spoqsaf9291f/6rIlyH477Pd7UHscCYMz2s/5fa0c3b7809ab984e085b4cf01965a7b/feature-filter-kanban.png',title:'Projects · 筛选后的看板',alt:'Notion 官方项目看板视图，展示按任务状态组织的卡片',note:'当前项目产品页展示图；截图版本未标注。',source:'https://www.notion.com/product/projects'},
        {src:'images/notion-2.png', original:'https://images.ctfassets.net/spoqsaf9291f/2KRCKUbMb1AYfqJUWafwSr/03dfbdd1149dfbc3525543d373925722/Group_158.png',title:'Views · 在视图间切换',alt:'Notion 官方帮助展示数据库视图切换',note:'官方帮助截图；截图版本未标注。',source:'https://www.notion.com/help/views-filters-and-sorts'}
      ]
    },
    {
      id: 'attio', name: 'Attio', category: '垂直场景参考', shorthand: '人物、互动与跟进',
      headline: '以一个人组织信息，以一次互动推进关系。',
      relevance: '最适合研究用户提出的人脉模板。这里借鉴的是人物工作面和关系记录，而不是把个人工具扩展成销售系统。',
      pillars: [0, 3],
      facts: 'Attio 的记录页面汇集属性、活动、笔记和任务；活动以时间线呈现。表格或看板中的记录可以在右侧预览，当前记录保持高亮。',
      looks: [
        ['人物是稳定的中心', '概览、活动和笔记围绕同一对象组织。用户先找到一个人，再处理相关信息。'],
        ['背景与互动有层次', '关键属性适合快速扫视，时间线回答“最近发生了什么”；长笔记可进一步打开。'],
        ['普通动作足够直接', '新笔记、任务和记录维护是明确动作。AI 的价值可以落在辅助整理，而不占据每一次操作的入口。']
      ],
      adaptation: ['第一个内置模板：人脉', '联系人列表 + 人物详情；默认显示背景、最近互动、待跟进和关联原文。新增互动写回人物文档，索引继续负责查找。'],
      boundary: '参考图部分以公司记录演示同一结构。个人版应精简销售管线、团队指标和自动富化，私人评价与对外准备材料也要分别控制。',
      scenario: '找到人物 → 看上次交流 → 记一条互动 → 更新跟进 → 会前挑选可给 Agent 使用的资料。',
      sources: [
        ['记录与预览官方帮助', 'https://attio.com/help/reference/managing-your-data/records/create-and-view-records'],
        ['记录笔记官方帮助', 'https://attio.com/help/reference/attio-101/productivity/introduction-to-notes']
      ],
      images: [
        {src:'images/attio-1.png', original:'https://a.storyblok.com/f/234930/1829x1067/6aed6cc3ee/full-record-page-overview.png',title:'Record · 记录概览',alt:'Attio 官方记录概览，包含对象背景和相关活动',note:'官方帮助截图，以公司记录展示结构；截图版本未标注。',source:'https://attio.com/help/reference/managing-your-data/records/create-and-view-records'},
        {src:'images/attio-2.png', original:'https://a.storyblok.com/f/234930/866x676/721cabee8f/activity-tab.png',title:'Activity · 互动时间线',alt:'Attio 官方活动页面展示会议、任务和属性更新',note:'官方帮助截图；截图版本未标注。',source:'https://attio.com/help/reference/managing-your-data/records/create-and-view-records'}
      ]
    },
    {
      id: 'claude', name: 'Claude', category: '能力重叠与界面参考', shorthand: '项目上下文与生成界面',
      headline: '从对话开始，留下可以再次打开的工作成果。',
      relevance: '同时研究 Projects 与 Artifacts。当前 Artifacts 已支持持久数据，不能把它简单理解为一次性的生成预览。',
      pillars: [0, 1, 3],
      facts: 'Projects 通过项目资料和指令提供上下文。Artifacts 可在对话旁打开、编辑和再次访问，统一保存在 Artifacts 区域；当前帮助也说明其支持跨会话存储数据。',
      looks: [
        ['生成与使用有各自位置', '对话帮助提出修改，工作成果在独立区域展开，用户能直接检查正在生成的结果。'],
        ['成果可再次找到', 'Artifacts 有集中管理入口。生成界面能否形成习惯，取决于下一次打开是否容易。'],
        ['项目背景可明确维护', 'Projects 的资料与指令提供了可见的上下文边界。MindOS 还需要面向不同 Agent 明确本次选择。']
      ],
      adaptation: ['工作台 / 已保存视图', '生成时并排预览；满意后保存名称、资料绑定和布局。再次打开读取原资料。改版先比较变化，保留用户已经维护的内容。'],
      boundary: '当前产品能力以帮助文档为准；两张结构参考图来自 2024 年发布。MindOS 的候选差异是文件透明、跨 Agent 使用与经验修订，需要实际验证。',
      scenario: '描述“帮我整理关系资料” → 预览界面 → 核对绑定文件 → 保存 → 下次打开继续维护。',
      sources: [
        ['Artifacts 当前官方产品页', 'https://claude.com/features/artifacts'],
        ['Artifacts 当前官方帮助', 'https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them'],
        ['Projects 当前官方帮助', 'https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects'],
        ['Projects 2024 发布材料', 'https://www.anthropic.com/news/projects']
      ],
      images: [
        {src:'images/claude-1.png', original:'https://www-cdn.anthropic.com/images/4zrzovbb/website/c5823949d9350145ce2fda51acbc7076f2139cd0-1920x1080.png',title:'Artifacts · 2024 年并排布局',alt:'Claude 2024 年官方发布界面，聊天旁边展示生成的 Artifacts 工作成果',note:'历史材料：2024-06-25 发布图，仅用于理解并排布局。当前能力以帮助文档为准。',source:'https://www.anthropic.com/news/projects'},
        {src:'images/claude-2.png', original:'https://www-cdn.anthropic.com/images/4zrzovbb/website/cc048db08b3503fa6d713b2b9e3352e8345c8b79-1920x1080.png',title:'Projects · 2024 年布局示例',alt:'Claude Projects 2024 年官方发布图，展示项目聊天与资料上传区域',note:'历史材料：2024-06-25 发布图，仅用于理解布局。',source:'https://www.anthropic.com/news/projects'}
      ]
    },
    {
      id: 'linear', name: 'Linear', category: '交互与视觉参考', shorthand: '列表、预览与连续操作',
      headline: '查看细节的时候，仍然知道自己在哪里。',
      relevance: '不是个人上下文竞品，但它在列表、预览、导航和键盘操作上的设计方法很适合我们的精修阶段。',
      pillars: [0, 3],
      facts: 'Linear 的 Peek 可用空格打开预览，用方向键查看相邻条目，用 Escape 关闭。Custom Views 可以保存筛选后的问题或项目集合。',
      looks: [
        ['列表保留任务语境', '预览让用户查看详情时仍能理解当前位置，连续看多个条目不必反复进入和返回。'],
        ['层次靠密度与对齐', '紧凑行、固定列和清楚的选中状态适合高频工具；克制并不意味着内容稀少。'],
        ['键盘与视图相互配合', '快速移动和保存常用集合共同减少重复操作；有用的是整段连续性，而不只是快捷键数量。']
      ],
      adaptation: ['会话 / 资料列表', '优先保留滚动位置、选中条目和返回路径；提供可点击的预览入口，键盘作为加速方式。复用现有面板。'],
      boundary: 'Linear 的 Peek 是键盘入口。MindOS 仍应给鼠标和触屏用户明确入口，也不必照搬问题状态、冲刺周期和团队组织。',
      scenario: '从列表打开来源预览 → 看相邻记录 → 关闭 → 仍停在原来的列表位置。',
      sources: [
        ['Peek 官方帮助', 'https://linear.app/docs/peek'],
        ['Custom Views 官方帮助', 'https://linear.app/docs/custom-views']
      ],
      images: [
        {src:'images/linear-1.png', original:'https://webassets.linear.app/images/ornj730p/production/5205025fbe6e96bf749f76d5e1cad30b484f8b50-1052x634.png?auto=format&dpr=2&q=95&w=1440',title:'Peek · 列表中查看详情',alt:'Linear 官方 Peek 示例，在列表上预览问题详情',note:'官方帮助截图；截图版本未标注。',source:'https://linear.app/docs/peek'},
        {src:'images/linear-2.png', original:'https://webassets.linear.app/images/ornj730p/production/6588c3dbdde8688ffd192a47210980e8e1a3c4fc-2494x1021.png?w=1440&q=95&auto=format&dpr=2',title:'Views · 保存常用集合',alt:'Linear 官方自定义视图展示问题和项目视图',note:'官方帮助截图；截图版本未标注。',source:'https://linear.app/docs/custom-views'}
      ]
    }
  ],
  comparisons: [
    {title:'个人上下文管理',need:'资料在哪里？我能否直接修改？',references:'Obsidian · Capacities · mymind · Fabric',pattern:'文件保持稳定归属；人物与项目接住资料，内容预览辅助辨认。',proposal:'保留树和项目；Context 表达本次选择的材料。原文件入口始终可见。',verify:'改一条资料后，原文件、视图和 Agent 读取结果一致。'},
    {title:'跨 Agent 接续',need:'上次说到哪里？这次带哪些背景？',references:'Pieces · Claude Projects · Readwise MCP',pattern:'用时间、来源和项目找回记录；将可复用背景维护为可见材料。',proposal:'选择原记录与已核对判断；预览后准备给指定 Agent 使用，状态准确反映已完成的步骤。',verify:'区分“已准备 / 已复制 / 已接收”；能定位每项材料的来源。'},
    {title:'经验沉淀与成长',need:'我当时怎么想？后来结果如何？',references:'Readwise · Heptabase · Recall',pattern:'原文与理解能同时核对，保存后有回看与修订的入口。',proposal:'原话、我的判断、适用范围和后续结果放在一条可修订的记录里。',verify:'用户下次找得到、用得上，并能停用过时判断。'},
    {title:'生成式工作视图',need:'这些资料能否变成好用的界面？',references:'Obsidian Bases · Attio · Capacities · Tana Outliner',pattern:'在已有内容上逐渐增加结构；模板、数据和视图分别维护。',proposal:'先完成一个人脉模板。绑定原资料，支持普通维护，再增加自然语言定制。',verify:'刷新、改版、移除视图均不丢资料；更新写回原文件。'}
  ]
};
