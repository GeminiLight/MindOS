import { describe, expect, it } from 'vitest';
import {
  buildWebCrashDiagnostic,
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
    expect(diagnostic.message).toContain('私有 Node.js 运行时发生 native 崩溃');
    expect(diagnostic.message).toContain('修复并重启');
    expect(diagnostic.message).toContain('下次启动时自动刷新');
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
    expect(diagnostic.message).toContain('Node.js runtime crashed natively');
    expect(diagnostic.message).not.toContain('Please check your Node.js environment');
  });

  it('compares Windows paths case-insensitively while preserving POSIX case sensitivity', () => {
    expect(isSameFilesystemPath('C:\\MindOS\\node.exe', 'c:/mindos/node.exe', 'win32')).toBe(true);
    expect(isSameFilesystemPath('/tmp/MindOS/node', '/tmp/mindos/node', 'linux')).toBe(false);
  });
});
