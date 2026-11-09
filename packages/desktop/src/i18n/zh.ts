/**
 * Shell UI copy (Chinese). en.ts must define exactly the same keys.
 *
 * House style, so new strings stay consistent with the rest:
 * - 用「你」，不用「您」；不用感叹号；省略号统一用「…」
 * - 说用户关心的结果，不说实现细节（不出现 CLI / 运行时 / IPC 这类词）
 * - 耗时写成「通常需要 1–3 分钟」，用短横线 –
 * - 术语与 Web 应用一致：知识库、Agent
 */
export const zh = {
  // Mode selection
  subtitle: '选择运行模式',
  localTitle: '本地模式',
  // Packaged builds ship their own Node.js, so this must not say "requires
  // Node.js" — for most users that is simply untrue.
  localDesc: '在这台电脑上运行，笔记和服务都留在本地',
  localSub: '适合个人使用',
  remoteTitle: '远程模式',
  remoteDesc: '连接运行在其他电脑或服务器上的 MindOS',
  remoteSub: '适合已在 NAS 或服务器上部署 MindOS',
  // Remote connection screen
  connectServer: '连接服务器',
  recentServers: '最近连接',
  orConnect: '或连接新服务器',
  serverAddress: '服务器地址',
  testConnection: '测试连接',
  password: '密码',
  enterPassword: '输入服务器密码',
  connect: '连接',
  hint: '服务器地址和密码可以在那台电脑的 <strong>MindOS 设置</strong> 中找到',
  switchLocal: '← 切换到本地模式',
  switchRemote: '← 切换到远程模式',
  backToModes: '← 返回模式选择',
  forgot: '移除',
  // Connection states
  connecting: '正在连接…',
  online: '✓ 在线',
  passwordRequired: '需要密码',
  notMindos: '⚠ 这不是 MindOS 服务器',
  cannotReach: '无法连接到服务器',
  incorrectPassword: '密码不正确',
  connectionFailed: '连接失败',
  connected: '已连接',
  // Setup: MindOS not installed (source / npm installs only — packaged builds bundle it)
  missingCli: '这台电脑还没有安装 MindOS',
  missingCliDesc: '安装后即可使用本地模式。需要 Node.js 22.19 或更新版本。',
  installBtn: '安装 MindOS',
  // Bundled runtime incomplete (packaged Desktop)
  bundledIncomplete: '应用文件不完整',
  bundledIncompleteDesc: '内置的 MindOS 缺失或已损坏，请重新安装 MindOS 桌面应用。',
  retryCheck: '重新检测',
  // Build section
  cliInstalled: '还需要构建一次',
  cliInstalledDesc: 'MindOS 已经安装，但还没有构建。构建只需要做一次。',
  buildBtn: '开始构建',
  building: '正在构建…',
  buildingDesc: '正在构建，通常需要 1–3 分钟…',
  buildSuccess: '✓ 构建完成',
  retryBuild: '重新构建',
  buildFailed: '✗ 构建失败',
  buildError: '✗ 构建出错',
  // Install flow
  installing: '正在安装…',
  installingDesc: '正在下载并安装，通常需要 1–2 分钟…',
  installSuccess: '✓ 安装完成',
  retryInstall: '重新安装',
  installFailed: '✗ 安装失败',
  installError: '✗ 安装出错',
  // Environment check
  checking: '正在检测…',
  missingNode: '✗ 没有找到 Node.js',
  envReady: '✓ 一切就绪，正在启动…',
  missingCliStill: '✗ 仍然没有找到 MindOS',
  // SSH tunnel
  sshTab: 'SSH 隧道',
  httpTab: '直连',
  sshHost: 'SSH 主机',
  sshPort: 'MindOS 端口',
  sshConnect: '连接',
  sshConnecting: '正在建立隧道…',
  sshSuccess: '✓ 隧道已建立',
  sshFailed: '隧道建立失败',
  sshNoConfig: '如果有 ~/.ssh/config，这里会列出其中的主机',
  sshNoSsh: '没有找到 SSH',
  sshSelectHost: 'user@hostname 或 SSH 主机别名',
  cancel: '取消',
  sshPassphrase: 'SSH 密钥口令',
  sshEnterPassphrase: '输入密钥口令',
  sshRememberPassphrase: '记住口令',
  sshPassphraseNeeded: '这个密钥需要口令',
  sshPassphraseWrong: '口令不正确，请重试',
  sshAddingKey: '正在验证口令…',
  // Toolbar (theme / language)
  themeTooltipLight: '主题：浅色',
  themeTooltipDark: '主题：深色',
  langTooltipZh: '语言：中文',
  langTooltipEn: '语言：English',
  // Accessibility labels (localized — these used to be hardcoded English)
  ariaToolbar: '外观设置',
  ariaLocalMode: '本地模式',
  ariaRemoteMode: '远程模式',
  // SSH saved hosts
  sshRecentHosts: '最近的 SSH 主机',
  sshForgetConfirm: '移除这台 SSH 主机，并删除保存的密钥口令？',
  // Error codes surfaced from the main process (see connection-sdk / connect-window)
  errEmptyAddress: '请输入服务器地址',
  errInvalidAddress: '服务器地址格式不对',
  errTimeout: '连接超时',
  errRefused: '无法连接到服务器',
  errHttpStatus: '服务器返回了错误（HTTP {status}）',
  // The request is refused, not merely warned about — say so.
  errPlaintextPassword: '为了安全，密码不能经 HTTP 明文发送。连接远程服务器请改用 SSH 隧道或 HTTPS。',
  errTunnelDead: 'SSH 隧道已断开，请重新连接。',
  errMindosNotRunning: '能连上服务器，但上面的 MindOS 没有在运行',
  errTunnelNoMindos: '隧道已建立，但访问不到 MindOS',
  errSshKeyRejected: '无法把密钥加入 ssh-agent，口令可能不正确。',
  errSshFailed: 'SSH 隧道建立失败',
  errBuildFailed: '构建失败',
  errInstallFailed: '安装失败',
  errInstallUnverified: '安装可能已经完成，但没能确认。请重启 MindOS 再试。',
  errIpcUnavailable: '应用内部出错，请重启 MindOS。',
  errCancelled: '已取消',
  // Keyboard affordances (principle: Keyboard First, Mouse Welcome)
  kbdHintModes: '按 1 / 2 选择，↑↓ 移动，回车确认',
  kbdHintRemote: '回车测试连接，Esc 返回',
  // Saved-server reachability (the status dot used to be permanently grey)
  reachableOnline: '在线',
  reachableOffline: '离线',
  reachableChecking: '检测中',
  // Joins a label to its detail ("安装失败：npm ERR!…"). Full-width in Chinese.
  labelSeparator: '：',
  // Boot shell — startup progress and failures, rendered inside the main
  // window (see boot-shell.ts). Separate from the connect flow's own strings
  // because these describe the shell starting, not a server being chosen.
  bootDetecting: '正在检测环境',
  bootHealing: '正在检查上次的运行状态',
  bootStarting: '正在启动服务',
  bootConnecting: '正在连接服务器',
  bootReady: '就绪',
  bootFailed: '启动失败',
  bootElapsed: '{seconds} 秒',
  // Shown after 20s on *any* launch, so it must not claim this is the first.
  bootFirstRunHint: '第一次启动或更新之后会慢一些，通常需要 1–3 分钟。',
  bootActionRetry: '重试',
  bootActionQuit: '退出',
  bootActionSelectMode: '选择模式',
  bootActionSwitchRemote: '切换到远程模式',
} as const;

export type I18nKeys = keyof typeof zh;
