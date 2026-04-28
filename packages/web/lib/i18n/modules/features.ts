// shortcuts + help

export const featuresEn = {
  shortcuts: [
    { keys: ['⌘', 'K'], description: 'Search' },
    { keys: ['⌘', '/'], description: 'MindOS' },
    { keys: ['⌘', ','], description: 'Settings' },
    { keys: ['E'], description: 'Edit current file' },
    { keys: ['⌘', 'S'], description: 'Save' },
    { keys: ['Esc'], description: 'Cancel edit / close modal' },
    { keys: ['@'], description: 'Attach file in MindOS' },
  ],
  help: {
    title: 'Help & Guide',
    subtitle: 'Everything you need to get started with MindOS',
    whatIs: {
      title: 'What is MindOS?',
      body: 'MindOS is your local knowledge assistant. It keeps your projects, decisions, SOPs, and preferences in one place so you and your connected agents can work from the same context. Your files stay local, your knowledge stays reusable, and you do not need to restate everything from scratch.',
    },
    quickStart: {
      title: 'Quick Start',
      step1Title: 'Browse your knowledge base',
      step1Desc: 'Click the Spaces icon in the left sidebar to explore your files. Each top-level folder is a "Space" — a themed area like Profile, Notes, or Projects.',
      step2Title: 'Talk to MindOS',
      step2Desc: 'Press ⌘/ (or Ctrl/) to open MindOS. Ask about your knowledge base, or use @ to attach a specific file for context.',
      step3Title: 'Connect your AI agents',
      step3Desc: 'Go to Settings → Connections to connect external agents like Claude Code, Cursor, or Windsurf. Once connected, they can read and write your knowledge base directly.',
    },
    concepts: {
      title: 'Core Concepts',
      spaceTitle: 'Space',
      spaceDesc: 'Spaces are knowledge partitions organized the way you think. You decide the structure, and AI agents follow it to read, write, and manage automatically.',
      instructionTitle: 'Instruction',
      instructionDesc: 'A rules file that all AI agents obey. You write the boundaries once, and every agent connected to your knowledge base follows them.',
      skillTitle: 'Skill',
      skillDesc: 'Teaches agents how to operate your knowledge base — reading, writing, organizing. Agents don\'t guess; they follow the skills you\'ve installed.',
    },
    shortcutsTitle: 'Keyboard Shortcuts',
    agentUsage: {
      title: 'Using MindOS with AI Agents',
      intro: 'Once you connect an agent (Claude Code, Cursor, Windsurf, etc.) via MCP, just talk to it naturally. The agent can read and write your knowledge base directly — no special commands needed. Here are the most common scenarios:',
      scenarios: [
        { emoji: '🪪', title: 'Inject Your Identity', desc: 'Tell all AI agents who you are — preferences, tech stack, communication style — in one shot.', prompt: "\"Here's my resume, read it and organize my info into MindOS.\"" },
        { emoji: '🔄', title: 'Cross-Agent Handoff', desc: 'Brainstorm ideas in GPT, then execute in Claude Code — zero context loss.', prompt: '"Save this conversation to MindOS."\n"Read the plan in MindOS and help me start coding."' },
        { emoji: '📋', title: 'Experience → SOP', desc: 'Turn hard-won debugging sessions into reusable workflows that prevent future mistakes.', prompt: '"Help me distill this conversation into a reusable workflow in MindOS."' },
        { emoji: '🚀', title: 'Project Cold Start', desc: 'Spin up a new project in minutes — your profile and SOPs guide the scaffolding automatically.', prompt: '"Help me start a new project following the Startup SOP in MindOS."' },
        { emoji: '🔍', title: 'Research & Archive', desc: 'Let agents research competitors or topics for you, then file structured results in your knowledge base.', prompt: '"Help me research X, Y, Z products and save results to the MindOS product library."' },
      ],
      copy: 'Copy prompt',
      hint: 'Tip: The agent auto-discovers your knowledge base structure. Just mention "MindOS" in your prompt and it will know where to look. Click "Explore" in the left sidebar for more scenarios.',
    },
    shortcuts: {
      search: 'Search files',
      askAI: 'Toggle MindOS',
      settings: 'Open Settings',
      shortcutPanel: 'Keyboard shortcuts panel',
      editFile: 'Edit current file',
      save: 'Save file',
      closePanel: 'Close panel / Exit modal',
      attachFile: 'Attach file in MindOS',
    },
    faq: {
      title: 'FAQ',
      items: [
        { q: 'How do I change the language?', a: 'Go to Settings → Appearance → Language. You can switch between English and Chinese.' },
        { q: 'How do I connect an AI agent?', a: 'Go to Settings → Connections. MindOS auto-detects installed agents (Claude Code, Cursor, etc.) and lets you connect them with one click.' },
        { q: 'Where is my data stored?', a: 'All your data stays on your local machine as plain Markdown files. MindOS never uploads your data to any cloud service. You own everything.' },
        { q: 'How do I sync across devices?', a: 'Go to Settings → Sync. MindOS uses Git for cross-device sync. Enter your Git remote URL and access token to start syncing.' },
        { q: 'Can I use my own AI provider?', a: 'Yes! Go to Settings → AI. You can use OpenAI, Anthropic, Google, or any OpenAI-compatible API with a custom base URL.' },
        { q: 'What file formats are supported?', a: 'MindOS works best with Markdown (.md) files, but also supports JSON, CSV, and plain text. Plugins extend rendering for special formats like Kanban boards or timelines.' },
        { q: 'How do I create a new note?', a: 'Click the + icon next to any folder in the file tree, or ask AI to create one for you. Notes are just Markdown files — you can also create them from your file system.' },
      ],
    },
  },

  /** Disabled-state and contextual tooltip hints */
} as const;

export const featuresZh = {
  shortcuts: [
    { keys: ['⌘', 'K'], description: '搜索' },
    { keys: ['⌘', '/'], description: 'MindOS' },
    { keys: ['⌘', ','], description: '设置' },
    { keys: ['E'], description: '编辑当前文件' },
    { keys: ['⌘', 'S'], description: '保存' },
    { keys: ['Esc'], description: '取消编辑 / 关闭弹窗' },
    { keys: ['@'], description: '在 AI 对话中添加附件' },
  ],
  help: {
    title: '帮助与指南',
    subtitle: '开始使用 MindOS 所需的一切',
    whatIs: {
      title: '什么是 MindOS？',
      body: 'MindOS 是你的本地知识助手。它把项目、决策、SOP 和偏好整理在同一处，让你和已连接的 Agent 都能基于同一份上下文工作。文件保留在本地，知识可以反复复用，也不用每次都从头交代背景。',
    },
    quickStart: {
      title: '快速开始',
      step1Title: '浏览你的知识库',
      step1Desc: '点击左侧边栏的"空间"图标来浏览你的文件。每个顶级文件夹是一个"空间"——比如个人档案、笔记或项目。',
      step2Title: '和 MindOS 对话',
      step2Desc: '按 ⌘/（或 Ctrl/）打开 MindOS。你可以直接询问知识库相关问题，或用 @ 附加特定文件作为上下文。',
      step3Title: '连接你的 AI Agent',
      step3Desc: '前往 设置 → 连接 以连接外部 Agent，如 Claude Code、Cursor 或 Windsurf。连接后，它们可以直接读写你的知识库。',
    },
    concepts: {
      title: '核心概念',
      spaceTitle: '空间（Space）',
      spaceDesc: '空间是按你的思维方式组织的知识分区。你怎么想，就怎么分，AI Agent 遵循同样的结构来自动读写和管理。',
      instructionTitle: '指令（Instruction）',
      instructionDesc: '一份所有 AI Agent 都遵守的规则文件。你写一次边界，每个连接到知识库的 Agent 都会照做。',
      skillTitle: '技能（Skill）',
      skillDesc: '教 Agent 如何操作你的知识库——读取、写入、整理。Agent 不是瞎猜，而是按你安装的 Skill 来执行。',
    },
    shortcutsTitle: '快捷键',
    agentUsage: {
      title: '在 AI Agent 中使用 MindOS',
      intro: '通过 MCP 连接 Agent（Claude Code、Cursor、Windsurf 等）后，直接用自然语言对话即可。Agent 能自动读写你的知识库，不需要特殊指令。以下是最常见的使用场景：',
      scenarios: [
        { emoji: '🪪', title: '注入身份', desc: '让所有 AI Agent 一次认识你——偏好、技术栈、沟通风格。', prompt: '"这是我的简历，读一下，把我的信息整理到 MindOS 里。"' },
        { emoji: '🔄', title: '跨 Agent 切换', desc: '在 GPT 里聊想法，到 Claude Code 去执行——上下文零丢失。', prompt: '"帮我把刚才的对话整理到 MindOS。"\n"读一下 MindOS 里的方案，帮我开始写代码。"' },
        { emoji: '📋', title: '经验→SOP', desc: '把踩坑经验沉淀为可复用的工作流，下次 3 分钟搞定。', prompt: '"帮我把这次对话的经验沉淀到 MindOS，形成可复用的工作流。"' },
        { emoji: '🚀', title: '项目冷启动', desc: '几分钟搭建新项目——Profile 和 SOP 自动引导脚手架。', prompt: '"帮我按 MindOS 里的 Startup SOP 启动一个新项目。"' },
        { emoji: '🔍', title: '调研入库', desc: '让 Agent 替你调研竞品或话题，结果结构化存入知识库。', prompt: '"帮我调研 X、Y、Z 这几个产品，结果写入 MindOS 产品库。"' },
      ],
      copy: '复制 Prompt',
      hint: '提示：Agent 会自动发现你的知识库结构。在 prompt 中提到"MindOS"，它就知道去哪里找。点击左侧"探索"查看更多场景。',
    },
    shortcuts: {
      search: '搜索文件',
      askAI: '切换 MindOS',
      settings: '打开设置',
      shortcutPanel: '快捷键面板',
      editFile: '编辑当前文件',
      save: '保存文件',
      closePanel: '关闭面板 / 退出弹窗',
      attachFile: '在 MindOS 中附加文件',
    },
    faq: {
      title: '常见问题',
      items: [
        { q: '如何切换语言？', a: '前往 设置 → 外观 → 语言。支持中文和英文切换。' },
        { q: '如何连接 AI Agent？', a: '前往 设置 → 连接。MindOS 会自动检测已安装的 Agent（Claude Code、Cursor 等），一键即可连接。' },
        { q: '我的数据存储在哪里？', a: '所有数据以纯 Markdown 文件的形式存储在你的本地机器上。MindOS 不会将你的数据上传到任何云服务。数据完全由你掌控。' },
        { q: '如何跨设备同步？', a: '前往 设置 → 同步。MindOS 使用 Git 进行跨设备同步。输入 Git 远程仓库 URL 和访问令牌即可开始同步。' },
        { q: '可以使用自己的 AI 服务商吗？', a: '可以！前往 设置 → AI。支持 OpenAI、Anthropic、Google，或任何 OpenAI 兼容的 API（自定义 Base URL）。' },
        { q: '支持哪些文件格式？', a: 'MindOS 最适合 Markdown（.md）文件，但也支持 JSON、CSV 和纯文本。插件可以扩展特殊格式的渲染，如看板或时间线。' },
        { q: '如何创建新笔记？', a: '点击文件树中任意文件夹旁的 + 图标，或让 AI 帮你创建。笔记就是 Markdown 文件，你也可以直接在文件系统中创建。' },
      ],
    },
  },

  /** 禁用态和上下文提示文案 */
};
