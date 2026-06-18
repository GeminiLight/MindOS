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
  const logLine = zh ? `详细日志：${crashLogPath}` : `Details: ${crashLogPath}`;
  const output = lastOutput ? `\n\n--- Last output ---\n${lastOutput}` : '';

  return {
    cause,
    lastOutput,
    shouldRefreshPrivateNode,
    actions: getWebCrashDialogActions(zh, shouldRefreshPrivateNode),
    message: `${zh ? 'Web 服务连续崩溃 3 次。' : 'The web server crashed 3 times.'}${hint}\n\n${logLine}${output}`,
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
    { id: 'dismiss', label: zh ? '稍后处理' : 'Dismiss' },
  ];
}

function getLocalizedCrashHint(
  cause: DesktopCrashCause,
  zh: boolean,
  shouldRefreshPrivateNode: boolean,
): string {
  switch (cause) {
    case 'oom':
      return zh
        ? '\n\n可能原因：内存不足 (OOM)。尝试关闭其他应用后重启。'
        : '\n\nLikely cause: out of memory (OOM). Close other apps and restart.';
    case 'disk-full':
      return zh
        ? '\n\n可能原因：磁盘空间不足。请清理磁盘后重启。'
        : '\n\nLikely cause: disk full. Free up disk space and restart.';
    case 'port-in-use':
      return zh
        ? '\n\n可能原因：端口被占用。请关闭占用端口的程序后重启。'
        : '\n\nLikely cause: port in use. Close the program using the port and restart.';
    case 'stale-build':
      return zh
        ? '\n\n可能原因：构建产物过期。请在终端运行 mindos start 重新编译。'
        : '\n\nLikely cause: stale build. Run "mindos start" in terminal to rebuild.';
    case 'node-native-crash':
      if (shouldRefreshPrivateNode) {
        return zh
          ? '\n\n可能原因：MindOS 私有 Node.js 运行时发生 native 崩溃（V8/OpenSSL）。点击「修复并重启」会自动刷新运行时并重新启动服务；如果先稍后处理，MindOS 也会在下次启动时自动刷新。若仍复现，请把 crash.log 发给我们。'
          : '\n\nLikely cause: the private MindOS Node.js runtime crashed natively (V8/OpenSSL). Click "Repair and Restart" to refresh the runtime and restart services now; if you dismiss it, MindOS will still refresh the runtime on the next launch. If it repeats, send crash.log to support.';
      }
      return zh
        ? '\n\n可能原因：Node.js 运行时发生 native 崩溃（V8/OpenSSL），这通常不是知识库内容或普通设置错误。请完全退出 MindOS 后重新打开，并更新到最新桌面版；若仍复现，请把 crash.log 发给我们。'
        : '\n\nLikely cause: the Node.js runtime crashed natively (V8/OpenSSL), usually not a note-content or normal settings issue. Fully quit and reopen MindOS, update to the latest Desktop build, and send crash.log if it repeats.';
    case 'unknown':
    default:
      return zh
        ? '\n\n暂未识别具体原因。请完全退出 MindOS 后重新打开；若仍复现，请把 crash.log 发给我们。'
        : '\n\nThe exact cause is not recognized yet. Fully quit and reopen MindOS, and send crash.log if it repeats.';
  }
}
