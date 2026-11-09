import path from 'path';

export type DesktopCrashCause =
  | 'oom'
  | 'disk-full'
  | 'port-in-use'
  | 'stale-build'
  | 'node-native-crash'
  | 'unknown';

export interface WebCrashDiagnosticInput {
  zh: boolean;
  exitCode: number | null;
  stderrLines?: string[];
  nodePath?: string | null;
  privateNodePath?: string | null;
  crashLogPath?: string;
  platform?: NodeJS.Platform;
}

export interface WebCrashDiagnostic {
  cause: DesktopCrashCause;
  message: string;
  lastOutput: string;
  shouldRefreshPrivateNode: boolean;
  actions: WebCrashDialogAction[];
}

export type WebCrashDialogActionId =
  | 'repair-private-node'
  | 'restart-services'
  | 'open-log'
  | 'dismiss';

export interface WebCrashDialogAction {
  id: WebCrashDialogActionId;
  label: string;
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const NODE_NATIVE_CRASH_PATTERNS = [
  /v8::/i,
  /v8::internal/i,
  /StrongRootAllocatorBase/i,
  /BIO_ssl_/i,
  /node::Abort/i,
  /node::OnFatalError/i,
  /Fatal error in V8/i,
  /Native stack trace/i,
  /EXCEPTION_ACCESS_VIOLATION/i,
  /Segmentation fault/i,
  /\bSIGSEGV\b/i,
  /Illegal instruction/i,
];

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_PATTERN, '');
}

export function getCrashLastOutput(stderrLines: string[] = [], maxLines = 5): string {
  return stripAnsi(stderrLines.slice(-maxLines).join('\n')).trim();
}

export function isNodeNativeCrashOutput(output: string): boolean {
  const cleaned = stripAnsi(output);
  return NODE_NATIVE_CRASH_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function isSameFilesystemPath(
  a: string | null | undefined,
  b: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!a || !b) return false;
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replace(/\\/g, '/');
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

export function classifyWebCrash(exitCode: number | null, stderrOutput: string): DesktopCrashCause {
  const stderr = stripAnsi(stderrOutput);
  const lower = stderr.toLowerCase();
  if (exitCode === 137 || exitCode === 9) return 'oom';
  if (stderr.includes('ENOSPC') || lower.includes('no space left')) return 'disk-full';
  if (stderr.includes('EADDRINUSE') || lower.includes('address already in use')) return 'port-in-use';
  if (stderr.includes('MODULE_NOT_FOUND') || stderr.includes('Cannot find module')) return 'stale-build';
  if (isNodeNativeCrashOutput(stderr)) return 'node-native-crash';
  return 'unknown';
}

export function buildWebCrashDiagnostic({
  zh,
  exitCode,
  stderrLines = [],
  nodePath,
  privateNodePath,
  crashLogPath = '~/.mindos/crash.log',
  platform = process.platform,
}: WebCrashDiagnosticInput): WebCrashDiagnostic {
  const lastOutput = getCrashLastOutput(stderrLines);
  const cause = classifyWebCrash(exitCode, lastOutput);
  const shouldRefreshPrivateNode =
    cause === 'node-native-crash' && isSameFilesystemPath(nodePath, privateNodePath, platform);

  const hint = getLocalizedCrashHint(cause, zh, shouldRefreshPrivateNode);
  const logLine = zh ? `日志：${crashLogPath}` : `Log: ${crashLogPath}`;
  const output = lastOutput ? `\n\n--- Last output ---\n${lastOutput}` : '';

  return {
    cause,
    lastOutput,
    shouldRefreshPrivateNode,
    actions: getWebCrashDialogActions(zh, shouldRefreshPrivateNode),
    message: `${zh ? 'MindOS 服务连续崩溃了 3 次。' : 'The MindOS service crashed 3 times in a row.'}${hint}\n\n${logLine}${output}`,
  };
}

export function getWebCrashDialogActions(
  zh: boolean,
  shouldRefreshPrivateNode: boolean,
): WebCrashDialogAction[] {
  return [
    shouldRefreshPrivateNode
      ? { id: 'repair-private-node', label: zh ? '修复并重启' : 'Repair and Restart' }
      : { id: 'restart-services', label: zh ? '重启服务' : 'Restart Services' },
    { id: 'open-log', label: zh ? '打开日志' : 'Open Log' },
    { id: 'dismiss', label: zh ? '稍后处理' : 'Later' },
  ];
}

function getLocalizedCrashHint(
  cause: DesktopCrashCause,
  zh: boolean,
  shouldRefreshPrivateNode: boolean,
): string {
  // "Send us crash.log" used to stop there, with no way to do it. The Help
  // menu has a Report Issue entry, so every hint points at it.
  const report = zh
    ? '如果问题反复出现，可以通过「帮助 → 报告问题」把 crash.log 发给我们。'
    : 'If it keeps happening, send us crash.log via Help → Report Issue.';
  switch (cause) {
    case 'oom':
      return zh
        ? '\n\n可能原因：内存不足。关闭一些其他应用后再重启服务。'
        : '\n\nLikely cause: the computer ran out of memory. Close some other apps, then restart services.';
    case 'disk-full':
      return zh
        ? '\n\n可能原因：磁盘空间不足。清理出一些空间后再重启服务。'
        : '\n\nLikely cause: the disk is full. Free up some space, then restart services.';
    case 'port-in-use':
      return zh
        ? '\n\n可能原因：端口被其他程序占用。关闭那个程序后再重启服务。'
        : '\n\nLikely cause: another program is using the port. Close it, then restart services.';
    case 'stale-build':
      return zh
        ? '\n\n可能原因：构建文件已过期。在终端运行 mindos start 可以重新构建。'
        : '\n\nLikely cause: the build is out of date. Run `mindos start` in a terminal to rebuild it.';
    case 'node-native-crash':
      if (shouldRefreshPrivateNode) {
        return zh
          ? `\n\n可能原因：MindOS 内置的 Node.js 意外崩溃。点「修复并重启」会重新准备它并重启服务；选择稍后处理的话，下次启动时也会自动修复。${report}`
          : `\n\nLikely cause: the Node.js built into MindOS crashed. "Repair and Restart" prepares it again and restarts services. If you choose Later, MindOS repairs it on the next launch. ${report}`;
      }
      return zh
        ? `\n\n可能原因：Node.js 意外崩溃，这通常和你的笔记或设置无关。请完全退出 MindOS 再打开，并更新到最新的桌面版。${report}`
        : `\n\nLikely cause: Node.js crashed. This is usually unrelated to your notes or settings. Quit MindOS completely, reopen it, and update to the latest desktop version. ${report}`;
    case 'unknown':
    default:
      return zh
        ? `\n\n暂时无法判断原因。请完全退出 MindOS 再打开。${report}`
        : `\n\nThe cause isn't clear yet. Quit MindOS completely and reopen it. ${report}`;
  }
}
