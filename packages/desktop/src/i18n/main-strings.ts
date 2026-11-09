/**
 * Main-process user-facing strings.
 *
 * main.ts used to carry ~40 bilingual strings as inline `zh ? '…' : '…'`
 * ternaries spread over 15 `const zh = navigator_lang() === 'zh'` sites. Adding
 * a string meant touching two places and nothing flagged a missing translation.
 * Everything now lives here and resolves through the shared getUiLang().
 */
import { getUiLang, type UiLang } from './lang';

type Entry = Record<UiLang, string>;

export const mainStrings = {
  // House style matches zh.ts / en.ts: 你 not 您, no exclamation marks, "…",
  // durations as "1–3 分钟". Dialog titles are sentence case in English.

  // ── crash log ──
  logNotFoundTitle: { zh: '找不到日志', en: 'Log not found' },
  couldNotOpenLogTitle: { zh: '无法打开日志', en: "Couldn't open the log" },

  // ── boot: node runtime ──
  downloadingNodeRuntime: { zh: '正在下载 Node.js…', en: 'Downloading Node.js…' },
  downloadingNodePercent: { zh: '正在下载 Node.js… {percent}%', en: 'Downloading Node.js… {percent}%' },
  installingNode: { zh: '正在安装 Node.js…', en: 'Installing Node.js…' },
  nodeDownloadFailed: { zh: 'Node.js 下载失败：{message}', en: 'Node.js download failed: {message}' },

  // ── boot: mindos runtime ──
  installingMindos: { zh: '正在安装 MindOS…', en: 'Installing MindOS…' },
  installingMindosFirstRun: {
    zh: '正在安装 MindOS，第一次通常需要 1–2 分钟…',
    en: 'Installing MindOS. The first time usually takes 1–2 minutes…',
  },
  mindosInstallFailed: { zh: 'MindOS 安装失败：{message}', en: 'MindOS install failed: {message}' },
  noRunnableMindos: { zh: '没有找到可以运行的 MindOS', en: 'No runnable MindOS found' },

  // ── boot: build ──
  buildingFirstRun: {
    zh: '正在构建 MindOS，第一次通常需要 1–3 分钟…',
    en: 'Building MindOS. The first time usually takes 1–3 minutes…',
  },
  installingDependencies: { zh: '正在安装依赖…', en: 'Installing dependencies…' },
  compilingFrontend: { zh: '正在构建界面，通常需要 1–3 分钟…', en: 'Building the interface. This usually takes 1–3 minutes…' },
  buildFailed: { zh: '构建失败：{message}', en: 'Build failed: {message}' },

  // ── boot: heal ──
  healCheckingPrevious: { zh: '正在检查上次的运行状态…', en: 'Checking the last session…' },
  healFreeingPorts: { zh: '正在清理上次没有退出的服务…', en: 'Cleaning up services from the last session…' },

  // ── ports ──
  portsAllInUse: {
    zh: '端口 {from}–{to} 都被占用了。\n请关闭占用这些端口的程序后重试。可以用这条命令查看是谁占用了端口：\n  {hint}',
    en: 'Ports {from}–{to} are all in use.\nClose the programs using them and try again. To see which program holds a port:\n  {hint}',
  },
  mcpPortBlockedTitle: { zh: 'MCP 端口被占用', en: 'MCP port in use' },
  mcpPortBlockedWithSuggestion: {
    zh: '端口 {blockedPort} 被其他程序占用，MCP 服务没法启动。\n\n可以改用端口 {suggestedPort}（现在可用），已接入的 Agent 配置会自动更新。',
    en: 'Port {blockedPort} is used by another program, so MCP can\'t start.\n\nYou can switch to port {suggestedPort}, which is free now. Connected Agent configurations update automatically.',
  },
  mcpPortBlocked: {
    zh: '端口 {blockedPort} 被其他程序占用，MCP 服务没法启动。\n\n请关闭占用它的程序，再重启 MindOS。',
    en: 'Port {blockedPort} is used by another program, so MCP can\'t start.\n\nClose that program, then restart MindOS.',
  },
  useSuggestedPort: { zh: '改用端口 {port}', en: 'Use port {port}' },
  dismiss: { zh: '稍后处理', en: 'Later' },
  ok: { zh: '好', en: 'OK' },

  // ── overlays ──
  coreUpdatingTitle: { zh: 'MindOS 正在更新…', en: 'Updating MindOS…' },
  coreUpdatingDetail: {
    zh: '服务正在重启，好了会自动刷新。',
    en: 'Services are restarting. This page reloads when they are ready.',
  },
  coreUpdatingShortDetail: { zh: '服务重启后会自动刷新', en: 'Reloads when services are ready' },
  repairingRuntimeTitle: { zh: '正在修复 MindOS…', en: 'Repairing MindOS…' },
  repairingRuntimeDetail: {
    zh: '正在重新准备内置的 Node.js 并重启服务，完成后会自动恢复。',
    en: 'Preparing the built-in Node.js again and restarting services. MindOS comes back on its own.',
  },
  switchingMode: { zh: '正在切换…', en: 'Switching…' },
  restartingServices: { zh: '正在重启…', en: 'Restarting…' },
  connectionLostTitle: { zh: '⚠ 和服务器断开了连接', en: '⚠ Connection lost' },
  connectionLostDetail: { zh: '正在尝试重新连接…', en: 'Trying to reconnect…' },
  retryNow: { zh: '立即重试', en: 'Retry now' },
  switchToLocalMode: { zh: '切换到本地模式', en: 'Switch to local mode' },

  // ── repair / restart ──
  repairStartedButNotRunning: {
    zh: '修复完成了，但本地服务没能启动。',
    en: "Repair finished, but local services didn't start.",
  },
  repairFailedTitle: { zh: '修复失败', en: 'Repair failed' },
  restartFailedTitle: { zh: '重启失败', en: 'Restart failed' },
  serviceCrashedTitle: { zh: 'MindOS 服务意外停止', en: 'MindOS service stopped' },

  // ── remote ──
  reconnectingSsh: { zh: '正在重新连接 SSH {host}…', en: 'Reconnecting to {host} over SSH…' },
  remoteSetupCancelledTitle: { zh: '还没有连接服务器', en: 'Not connected' },
  // Must name the buttons actually offered (retry / choose mode / quit).
  remoteSetupCancelled: {
    zh: '还没有连接到服务器。可以重试、重新选择模式，或者退出。',
    en: "You're not connected to a server yet. Try again, choose a different mode, or quit.",
  },
  remoteVersionTooOldTitle: { zh: '服务器版本太旧', en: 'Server version is too old' },
  remoteVersionTooOld: {
    zh: '这台服务器上的 MindOS 是 v{serverVersion}，当前桌面应用需要 v{minVersion} 或更新版本。\n\n建议先升级服务器，否则部分界面可能显示不正常。',
    en: 'That server runs MindOS v{serverVersion}. This desktop app needs v{minVersion} or later.\n\nUpgrade the server first, or parts of the interface may not display correctly.',
  },
  connectAnyway: { zh: '仍然连接', en: 'Connect anyway' },
  cancel: { zh: '取消', en: 'Cancel' },

  // ── navigation failure ──
  pageLoadFailedTitle: { zh: '页面没能加载', en: "Page didn't load" },
  pageLoadFailedMessage: { zh: '无法加载：{url}', en: "Couldn't load {url}" },
  // An environment variable is not advice an end user can act on; the
  // developer switch stays documented in packages/desktop/README.md.
  pageLoadFailedTip: {
    zh: '可以稍后用「视图 → 重新加载」再试，或在浏览器里打开同一地址，确认服务是否正常。',
    en: 'Try View → Reload in a moment, or open the same address in a browser to check whether the service is up.',
  },

  // ── uninstall ──
  uninstallNoUninstaller: {
    zh: '在 {path} 中没有找到卸载程序。请在 Windows「设置 → 应用」中卸载 MindOS。',
    en: 'No uninstaller found in {path}. Uninstall MindOS from Windows Settings → Apps.',
  },
  uninstallPackageManager: {
    zh: 'MindOS 是通过系统包管理器安装的，请用包管理器卸载，例如 `sudo apt remove mindos-desktop` 或 `sudo rpm -e mindos-desktop`。',
    en: 'MindOS was installed with your system package manager. Remove it the same way, e.g. `sudo apt remove mindos-desktop` or `sudo rpm -e mindos-desktop`.',
  },
  uninstallTrashFailed: {
    zh: '没能把 {target} 移到废纸篓：{message}。可能需要手动删除。',
    en: "Couldn't move {target} to the Trash: {message}. You may need to delete it yourself.",
  },

  // ── obsidian isolated plugin editor ──
  obsidianEditorTitle: { zh: 'MindOS · 隔离插件编辑器', en: 'MindOS · Isolated Plugin Editor' },
  obsidianEditorHeading: { zh: '隔离插件编辑器', en: 'Isolated plugin editor' },
  obsidianRefreshVault: { zh: '刷新知识库', en: 'Refresh vault' },
  obsidianSaveNote: { zh: '保存笔记', en: 'Save note' },
  obsidianPreparing: { zh: '准备中…', en: 'Preparing…' },
  obsidianUnsaved: { zh: '未保存', en: 'Unsaved' },
  obsidianSaved: { zh: '已保存', en: 'Saved' },
  obsidianSaving: { zh: '保存中…', en: 'Saving…' },
  obsidianRefreshingVault: { zh: '刷新知识库中…', en: 'Refreshing vault…' },
  obsidianSaveConflict: {
    zh: '保存冲突，请保留草稿并重新打开',
    en: 'Save conflict — keep your draft and reopen the note',
  },
  obsidianDirtyMessage: { zh: '笔记有未保存的修改', en: 'This note has unsaved changes' },
  obsidianDirtyDetail: {
    zh: '关闭前保存，或继续编辑。放弃修改后无法恢复。',
    en: 'Save before closing, or keep editing. Discarded changes cannot be recovered.',
  },
  obsidianKeepEditing: { zh: '继续编辑', en: 'Keep editing' },
  obsidianSaveAndClose: { zh: '保存并关闭', en: 'Save and close' },
  obsidianDiscard: { zh: '放弃修改', en: 'Discard changes' },
  obsidianNoDraftMessage: { zh: '插件没有返回最新草稿', en: 'The plugin did not return its latest draft' },
  obsidianNoDraftDetail: {
    zh: '可以继续等待，或强制关闭此插件窗口。强制关闭会丢失未保存的修改。',
    en: 'You can keep waiting, or force-close this plugin window. Force-closing loses unsaved changes.',
  },
  obsidianForceClose: { zh: '强制关闭', en: 'Force close' },
  obsidianRecoveryTitle: { zh: 'MindOS · 草稿恢复', en: 'MindOS · Draft recovery' },
  obsidianRecoveryFound: { zh: '发现未保存的插件草稿', en: 'Found an unsaved plugin draft' },
  obsidianRecoveryStale: {
    zh: '草稿对应的笔记或插件已发生变化',
    en: 'The note or plugin behind this draft has changed',
  },
  obsidianRecoveryMatchDetail: {
    zh: '恢复只载入编辑器，不会自动写入知识库。保存时仍会检查版本。',
    en: 'Restoring only loads the editor; nothing is written to your vault until you save, and the version is re-checked then.',
  },
  obsidianRecoveryStaleDetail: {
    zh: '为防止覆盖较新的内容，不直接恢复。请查看备份文件中的 content 字段，手动核对。',
    en: 'Restoring is blocked so newer content is not overwritten. Open the backup file and reconcile its `content` field manually.',
  },
  obsidianRecoveryCount: {
    zh: '共 {count} 份备份，当前为最近一份；其余备份仍保留。',
    en: '{count} backup(s) total; this is the most recent. The others are kept.',
  },
  obsidianRestoreDraft: { zh: '恢复草稿', en: 'Restore draft' },
  obsidianOpenBackups: { zh: '查看备份文件', en: 'Open backup folder' },
} as const satisfies Record<string, Entry>;

export type MainStringKey = keyof typeof mainStrings;

/** Interpolate `{name}` placeholders. Unknown placeholders are left verbatim. */
export function formatString(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** Translate a main-process string in the current UI language. */
export function mt(key: MainStringKey, params?: Record<string, string | number>): string {
  return formatString(mainStrings[key][getUiLang()], params);
}

/** Translate into an explicit language (for strings that cross a process boundary). */
export function mtIn(lang: UiLang, key: MainStringKey, params?: Record<string, string | number>): string {
  return formatString(mainStrings[key][lang], params);
}

/** Every obsidian-editor string the renderer chrome needs, resolved once at window creation. */
export function obsidianEditorStrings(lang: UiLang) {
  const pick = (key: MainStringKey) => mtIn(lang, key);
  return {
    title: pick('obsidianEditorTitle'),
    heading: pick('obsidianEditorHeading'),
    refreshVault: pick('obsidianRefreshVault'),
    saveNote: pick('obsidianSaveNote'),
    preparing: pick('obsidianPreparing'),
    unsaved: pick('obsidianUnsaved'),
    saved: pick('obsidianSaved'),
    saving: pick('obsidianSaving'),
    refreshing: pick('obsidianRefreshingVault'),
    conflict: pick('obsidianSaveConflict'),
  };
}

export type ObsidianEditorStrings = ReturnType<typeof obsidianEditorStrings>;
