// common + app + login + notFound + updateBanner

export const commonEn = {
  common: {
    relatedFiles: 'Related Files',
  },
  app: {
    tagline: 'You think here, Agents act there.',
    footer: 'MindOS · human-agent collaborative mind system',
  },
  login: {
    tagline: 'You think here, Agents act there.',
    subtitle: 'Enter your password to continue',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Enter password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    incorrectPassword: 'Incorrect password. Please try again.',
    connectionError: 'Connection error. Please try again.',
  },
  notFound: {
    title: 'File not found',
    description: 'This file does not exist in your knowledge base.',
    createButton: 'Create this file',
    creating: 'Creating...',
    goToParent: 'Go to parent folder',
    goHome: 'Home',
  },
  updateBanner: {
    newVersion: (latest: string, current: string) => `MindOS v${latest} available (current: v${current})`,
    updateNow: 'Update',
    runUpdate: 'Run',
    orSee: 'or',
    releaseNotes: 'release notes',
  },
} as const;

export const commonZh = {
  common: {
    relatedFiles: '关联视图',
  },
  app: {
    tagline: '你在此思考，Agent 依此行动。',
    footer: 'MindOS · 人机共生知识系统',
  },
  login: {
    tagline: '人类在此思考，Agent 依此行动。',
    subtitle: '请输入密码以继续',
    passwordLabel: '密码',
    passwordPlaceholder: '输入密码',
    signIn: '登录',
    signingIn: '登录中…',
    incorrectPassword: '密码错误，请重试。',
    connectionError: '连接错误，请重试。',
  },
  notFound: {
    title: '文件未找到',
    description: '该文件不存在于你的知识库中。',
    createButton: '创建此文件',
    creating: '创建中...',
    goToParent: '返回上级目录',
    goHome: '首页',
  },
  updateBanner: {
    newVersion: (latest: string, current: string) => `MindOS v${latest} 可用（当前 v${current}）`,
    updateNow: '更新',
    runUpdate: '终端运行',
    orSee: '或',
    releaseNotes: '查看更新说明',
  },
};
