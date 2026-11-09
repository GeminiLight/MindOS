import { describe, expect, it } from 'vitest';
import {
  buildWebCrashDiagnostic,
  getWebCrashDialogActions,
  classifyWebCrash,
  getCrashLastOutput,
  isNodeNativeCrashOutput,
  isSameFilesystemPath,
  stripAnsi,
} from './desktop-crash-diagnostics';

const WINDOWS_V8_NATIVE_STACK = [
  '5: 00007FF666AEAA20',
  'v8::internal::StrongRootAllocatorBase::StrongRootAllocatorBase+31456',
  '6: 00007FF666AE471A',
  'v8::internal::StrongRootAllocatorBase::StrongRootAllocatorBase+6106',
  '7: 00007FF666ADFDB5 v8::CpuProfileNode::GetScriptResourceNameStr+189453',
  '8: 00007FF66646309D BIO_ssl_shutdown+189',
  '9: 7FF8000000000000',
];

describe('desktop crash diagnostics', () => {
  it('strips ANSI escape codes before displaying stderr in native dialogs', () => {
    expect(stripAnsi(`plain ${String.fromCharCode(27)}[31mred${String.fromCharCode(27)}[0m`)).toBe('plain red');
  });

  it('recognizes Windows V8/OpenSSL native stacks as Node runtime crashes', () => {
    const output = WINDOWS_V8_NATIVE_STACK.join('\n');
    expect(isNodeNativeCrashOutput(output)).toBe(true);
    expect(classifyWebCrash(null, output)).toBe('node-native-crash');
  });

  it('keeps existing specific diagnoses ahead of native crash fallback', () => {
    expect(classifyWebCrash(137, 'v8::internal::StrongRootAllocatorBase')).toBe('oom');
    expect(classifyWebCrash(null, 'Error: listen EADDRINUSE 127.0.0.1:3456')).toBe('port-in-use');
    expect(classifyWebCrash(null, 'Error: Cannot find module next/dist/server')).toBe('stale-build');
  });

  it('uses a bounded last-output snippet for the dialog', () => {
    expect(getCrashLastOutput(['1', '2', '3', '4', '5', '6'], 5)).toBe(['2', '3', '4', '5', '6'].join('\n'));
  });

  it('marks private Node for refresh when the native crash used the private runtime', () => {
    const diagnostic = buildWebCrashDiagnostic({
      zh: true,
      exitCode: null,
      stderrLines: WINDOWS_V8_NATIVE_STACK,
      nodePath: 'C:\\Users\\Alice\\.mindos\\node\\node.exe',
      privateNodePath: 'c:/Users/Alice/.mindos/node/node.exe',
      platform: 'win32',
    });

    expect(diagnostic.cause).toBe('node-native-crash');
    expect(diagnostic.shouldRefreshPrivateNode).toBe(true);
    expect(diagnostic.actions.map((action) => action.id)).toEqual([
      'repair-private-node',
      'open-log',
      'dismiss',
    ]);
    expect(diagnostic.message).toContain('内置的 Node.js 意外崩溃');
    expect(diagnostic.message).toContain('修复并重启');
    expect(diagnostic.message).toContain('下次启动时也会自动修复');
    // Implementation detail stays in crash.log, not in the dialog.
    expect(diagnostic.message).not.toMatch(/V8|OpenSSL|native/);
    expect(diagnostic.message).not.toContain('请检查 Node.js 环境');
    expect(diagnostic.message).toContain('--- Last output ---');
  });

  it('does not mark bundled or system Node for private-runtime refresh', () => {
    const diagnostic = buildWebCrashDiagnostic({
      zh: false,
      exitCode: null,
      stderrLines: WINDOWS_V8_NATIVE_STACK,
      nodePath: 'C:\\Program Files\\MindOS\\resources\\mindos-runtime\\node\\node.exe',
      privateNodePath: 'C:\\Users\\Alice\\.mindos\\node\\node.exe',
      platform: 'win32',
    });

    expect(diagnostic.cause).toBe('node-native-crash');
    expect(diagnostic.shouldRefreshPrivateNode).toBe(false);
    expect(diagnostic.actions.map((action) => action.id)).toEqual([
      'restart-services',
      'open-log',
      'dismiss',
    ]);
    expect(diagnostic.message).toContain('Likely cause: Node.js crashed');
    // Not the built-in runtime, so no promise to repair it.
    expect(diagnostic.message).not.toContain('Repair and Restart');
    expect(diagnostic.message).not.toContain('Please check your Node.js environment');
  });

  it('compares Windows paths case-insensitively while preserving POSIX case sensitivity', () => {
    expect(isSameFilesystemPath('C:\\MindOS\\node.exe', 'c:/mindos/node.exe', 'win32')).toBe(true);
    expect(isSameFilesystemPath('/tmp/MindOS/node', '/tmp/mindos/node', 'linux')).toBe(false);
  });
});

describe('crash dialog wording', () => {
  // "Please send us crash.log" used to be the whole instruction, with no way
  // to do it. Every cause that asks for the log must also say where to send it.
  const causes: Array<{ name: string; exitCode: number | null; stderr: string[] }> = [
    { name: 'native crash', exitCode: null, stderr: WINDOWS_V8_NATIVE_STACK },
    { name: 'unknown', exitCode: 1, stderr: ['something odd happened'] },
  ];

  for (const zh of [true, false]) {
    for (const c of causes) {
      it(`points to Help → Report Issue (${zh ? 'zh' : 'en'}, ${c.name})`, () => {
        const { message } = buildWebCrashDiagnostic({ zh, exitCode: c.exitCode, stderrLines: c.stderr });
        expect(message).toContain(zh ? '帮助 → 报告问题' : 'Help → Report Issue');
      });
    }
  }

  it('labels the dismiss action the same way as the other startup dialogs', () => {
    const labels = getWebCrashDialogActions(false, false).map((a) => a.label);
    expect(labels).toContain('Later');
    expect(labels).not.toContain('Dismiss');
  });
});
