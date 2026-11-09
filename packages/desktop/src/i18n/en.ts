import type { I18nKeys } from './zh';

/**
 * Shell UI copy (English). Must define exactly the keys in zh.ts.
 *
 * House style:
 * - Sentence case in the window ("Recent servers"), matching the Web app.
 *   Native menus keep platform Title Case — that lives in app-menu.ts / tray.ts.
 * - No exclamation marks; ellipsis is "…"; durations are "1–3 minutes".
 * - Describe the outcome, not the mechanism (no "CLI", "runtime", "IPC").
 */
export const en: Record<I18nKeys, string> = {
  // Mode selection
  subtitle: 'Choose how to run MindOS',
  localTitle: 'Local mode',
  localDesc: 'Runs on this computer. Your notes and services stay here.',
  localSub: 'Best for personal use',
  remoteTitle: 'Remote mode',
  remoteDesc: 'Connect to MindOS running on another computer or server',
  remoteSub: 'Best if MindOS already runs on a NAS or server',
  // Remote connection screen
  connectServer: 'Connect to a server',
  recentServers: 'Recent servers',
  orConnect: 'or connect to a new server',
  serverAddress: 'Server address',
  testConnection: 'Test connection',
  password: 'Password',
  enterPassword: 'Server password',
  connect: 'Connect',
  hint: 'Find the address and password in <strong>MindOS Settings</strong> on that computer.',
  switchLocal: '← Switch to local mode',
  switchRemote: '← Switch to remote mode',
  backToModes: '← Back to mode selection',
  forgot: 'Remove',
  // Connection states
  connecting: 'Connecting…',
  online: '✓ Online',
  passwordRequired: 'Password required',
  notMindos: '⚠ Not a MindOS server',
  cannotReach: "Can't reach the server",
  incorrectPassword: 'Incorrect password',
  connectionFailed: 'Connection failed',
  connected: 'Connected',
  // Setup: MindOS not installed (source / npm installs only — packaged builds bundle it)
  missingCli: "MindOS isn't installed on this computer",
  missingCliDesc: 'Install it to use local mode. Requires Node.js 22.19 or later.',
  installBtn: 'Install MindOS',
  // Bundled runtime incomplete (packaged Desktop)
  bundledIncomplete: 'App files are incomplete',
  bundledIncompleteDesc: 'The built-in MindOS is missing or damaged. Reinstall the MindOS desktop app.',
  retryCheck: 'Check again',
  // Build section
  cliInstalled: 'One build step left',
  cliInstalledDesc: "MindOS is installed but hasn't been built yet. This only needs to happen once.",
  buildBtn: 'Build now',
  building: 'Building…',
  buildingDesc: 'Building. This usually takes 1–3 minutes…',
  buildSuccess: '✓ Build complete',
  retryBuild: 'Build again',
  buildFailed: '✗ Build failed',
  buildError: '✗ Build error',
  // Install flow
  installing: 'Installing…',
  installingDesc: 'Downloading and installing. This usually takes 1–2 minutes…',
  installSuccess: '✓ Installed',
  retryInstall: 'Install again',
  installFailed: '✗ Install failed',
  installError: '✗ Install error',
  // Environment check
  checking: 'Checking…',
  missingNode: '✗ Node.js not found',
  envReady: '✓ Ready. Starting…',
  missingCliStill: '✗ MindOS still not found',
  // SSH tunnel
  sshTab: 'SSH tunnel',
  httpTab: 'Direct',
  sshHost: 'SSH host',
  sshPort: 'MindOS port',
  sshConnect: 'Connect',
  sshConnecting: 'Opening tunnel…',
  sshSuccess: '✓ Tunnel open',
  sshFailed: "Couldn't open the tunnel",
  sshNoConfig: 'Hosts from ~/.ssh/config appear here when available',
  sshNoSsh: 'SSH not found',
  sshSelectHost: 'user@hostname or SSH host alias',
  cancel: 'Cancel',
  sshPassphrase: 'SSH key passphrase',
  sshEnterPassphrase: 'Enter passphrase',
  sshRememberPassphrase: 'Remember passphrase',
  sshPassphraseNeeded: 'This key needs a passphrase',
  sshPassphraseWrong: 'Incorrect passphrase. Try again.',
  sshAddingKey: 'Checking passphrase…',
  // Toolbar (theme / language)
  themeTooltipLight: 'Theme: light',
  themeTooltipDark: 'Theme: dark',
  langTooltipZh: 'Language: Chinese',
  langTooltipEn: 'Language: English',
  // Accessibility labels (localized — these used to be hardcoded English)
  ariaToolbar: 'Appearance',
  ariaLocalMode: 'Local mode',
  ariaRemoteMode: 'Remote mode',
  // SSH saved hosts
  sshRecentHosts: 'Recent SSH hosts',
  sshForgetConfirm: 'Remove this SSH host and delete its saved passphrase?',
  // Error codes surfaced from the main process (see connection-sdk / connect-window)
  errEmptyAddress: 'Enter a server address',
  errInvalidAddress: "That server address isn't valid",
  errTimeout: 'Connection timed out',
  errRefused: "Can't reach the server",
  errHttpStatus: 'The server returned an error (HTTP {status})',
  errPlaintextPassword: "For your security, the password can't be sent over plain HTTP. Use an SSH tunnel or HTTPS for remote servers.",
  errTunnelDead: 'The SSH tunnel closed. Connect again.',
  errMindosNotRunning: "The server is reachable, but MindOS isn't running on it",
  errTunnelNoMindos: "The tunnel is open, but MindOS isn't reachable through it",
  errSshKeyRejected: "Couldn't add the key to ssh-agent. The passphrase may be wrong.",
  errSshFailed: "Couldn't open the SSH tunnel",
  errBuildFailed: 'Build failed',
  errInstallFailed: 'Install failed',
  errInstallUnverified: "The install may have finished, but it couldn't be confirmed. Restart MindOS and try again.",
  errIpcUnavailable: 'Something went wrong inside the app. Restart MindOS.',
  errCancelled: 'Cancelled',
  // Keyboard affordances (principle: Keyboard First, Mouse Welcome)
  kbdHintModes: 'Press 1 / 2 to choose, ↑↓ to move, Enter to confirm',
  kbdHintRemote: 'Enter to test the connection, Esc to go back',
  // Saved-server reachability (the status dot used to be permanently grey)
  reachableOnline: 'Online',
  reachableOffline: 'Offline',
  reachableChecking: 'Checking',
  // Joins a label to its detail ("安装失败：npm ERR!…"). Full-width in Chinese.
  labelSeparator: ': ',
  // Boot shell — startup progress and failures, rendered inside the main
  // window (see boot-shell.ts). Separate from the connect flow's own strings
  // because these describe the shell starting, not a server being chosen.
  bootDetecting: 'Checking your setup',
  bootHealing: 'Checking the last session',
  bootStarting: 'Starting services',
  bootConnecting: 'Connecting to the server',
  bootReady: 'Ready',
  bootFailed: "MindOS couldn't start",
  bootElapsed: '{seconds}s',
  // Shown after 20s on *any* launch, so it must not claim this is the first.
  bootFirstRunHint: 'The first launch, and the first after an update, take longer. This usually takes 1–3 minutes.',
  bootActionRetry: 'Try again',
  bootActionQuit: 'Quit',
  bootActionSelectMode: 'Choose mode',
  bootActionSwitchRemote: 'Switch to remote mode',
};
