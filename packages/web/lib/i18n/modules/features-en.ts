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
