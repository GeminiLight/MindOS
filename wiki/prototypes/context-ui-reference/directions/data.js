  const data = {
    date: '2026-10-03',
    project: 'MindOS 产品打磨',
    people: [
      {id: 'lin', name: '林若舟', initials: '林', role: '独立产品设计师', focus: '个人知识与多 Agent 工作流', next: '一起试用一个可维护的人脉模板', followup: '2026-10-08', path: '人物/林若舟.md',
        summary: '关注资料怎样跨工具接续，也关心人在使用 AI 的过程中，能否保留自己的判断。',
        background: '第一次交流时，我们从各自的笔记习惯聊起。若舟更愿意从具体内容进入工作：一份资料、一段对话，或者一个需要继续跟进的人。',
        discussion: '我们聊了目录、项目与上下文的关系。目录回答资料在哪里；项目把相关工作放在一起；本次上下文只包含这次需要使用的材料。',
        candidate: '先保留熟悉的目录，在当前内容旁核对出处；每次只打磨一个高频动作，再观察能否顺畅接续。',
        source: {agent: 'Codex', date: '2026-10-02', title: '人脉模板与上下文接续', user: '资料树先保留。人物详情可以把最近互动和原会话放在一起，让人打开之后就能接着做。', assistant: '可以从联系人列表、人物详情和互动记录开始。先让同一份资料能维护、能再次打开，再增加布局定制。'},
        history: [{date: '2026-10-02', text: '讨论人脉模板：先明确资料归属，再确定最少的几个字段。', type: '交流记录'}, {date: '2026-09-28', text: '初次交流，分享各自整理 AI 对话与项目资料的方法。', type: '初次交流'}]
      },
      {id: 'chen', name: '陈以安', initials: '陈', role: '人机交互研究者', focus: '判断与学习的长期变化', next: '讨论一次真实任务的回看方式', followup: '2026-10-10', path: '人物/陈以安.md',
        summary: '研究人怎样判断 AI 的建议是否适用，喜欢从一段真实经历追问理由和结果。',
        background: '在一个关于人机协作的读书会认识。她关心经验记录怎样帮助下一次工作，而不仅是留下一个摘要。',
        discussion: '我们讨论了如何区分原话、AI 的候选解读与人的判断，以及什么时候值得重新核对一条经验。',
        candidate: '判断应保留适用范围与实际结果；依据变化时允许修订或停用。',
        source: {agent: 'Claude Code', date: '2026-10-01', title: '经验回看与真实结果', user: '不能因为读过摘要，就认为已经掌握。回看时要知道这条判断用在什么情境、后来发生了什么。', assistant: '可以保留原始依据和后续结果，让用户主动确认仍适用、需修订或已停用。'},
        history: [{date: '2026-10-01', text: '讨论经验回看，以实际任务的结果作为修订依据。', type: '交流记录'}]
      },
      {id: 'wen', name: '温小满', initials: '温', role: '独立开发者', focus: '本地资料与工具效率', next: '核对跨 Agent 材料是否准确', followup: '2026-10-12', path: '人物/温小满.md',
        summary: '同时使用多个开发 Agent，希望切换工具时能准确知道带走了哪些背景。',
        background: '因为一个本地知识库项目认识。她习惯把核心资料保留在普通文件里，喜欢可检查的操作反馈。',
        discussion: '我们讨论了“已准备”“已复制”和“Agent 已接收”的区别，以及资料更新后是否需要重新核对。',
        candidate: '本次材料需要有可见清单；复制完成只表示已复制，接收状态按实际证据展示。',
        source: {agent: 'Cursor', date: '2026-09-30', title: '跨工具准备材料', user: '我想知道这次带了什么、从哪里来。换一个工具时，不要偷偷附上之前项目的东西。', assistant: '将材料与当前任务绑定，并在更换目标、选材或资料版本后清除过期的完成提示。'},
        history: [{date: '2026-09-30', text: '核对跨工具材料准备与接收反馈。', type: '交流记录'}]
      }
    ],
    directions: [
      {id: 'a', name: '原位精修', level: '变化最小', tagline: '目录仍在原处，来源就近展开，操作贴着当前内容。', recommendation: '近期推荐', note: '从已有阅读页开始：减少重复入口，在当前内容旁核对原话并准备材料。主要投入是来源、返回和草稿状态。', references: [['Linear 的连续预览', 'https://linear.app/docs/peek'], ['Readwise 的原文与批注', 'https://readwise.io/read']]},
      {id: 'b', name: '内容与出处', level: '局部布局变化', tagline: '正文保持完整，来源与本次材料在一个按需辅助区切换。', recommendation: '渐进候选', note: '适合频繁核对原话、候选与本次材料。宽屏并排，窄屏单列；要复用现有 Ask/TOC/Agent Detail 的互斥与宽度规则。', references: [['Heptabase 的原文与理解', 'https://heptabase.com/'], ['Claude 的并排工作成果', 'https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them']]},
      {id: 'c', name: '人物工作视图', level: '新增场景能力', tagline: '同一份人物资料，成为可维护的详情、互动与跟进视图。', recommendation: '模板方向', note: '先做一个好用的人脉模板。原资料仍可核对；互动维护、文件写回、视图保存与恢复需要新增真实能力，投入高于 A/B。', references: [['Capacities 的对象详情', 'https://capacities.io/product'], ['Attio 的人物与互动', 'https://attio.com/help/reference/managing-your-data/records/create-and-view-records'], ['Obsidian 的文件与视图', 'https://obsidian.md/help/bases']]}
    ]
  };
export default data;
