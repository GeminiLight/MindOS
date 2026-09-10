import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AcpPermissionEvent } from './types';
import {
  createMindosClient,
  getActiveProcesses,
  getProcess,
  killAgent,
  resolveTerminalSpawn,
  spawnAcpAgent,
} from './subprocess';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

// Command resolution consults the real PATH and well-known install directories
// before any login shell, so spawn tests pin the resolver instead of relying
// on whatever happens to be installed on the machine running the suite.
const detectLocalMock = vi.hoisted(() => ({
  resolveCommandPathSync: vi.fn<(command: string | undefined) => string | null>(),
  actual: null as ((command: string | undefined) => string | null) | null,
}));

vi.mock('./detect-local.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./detect-local.js')>();
  detectLocalMock.actual = actual.resolveCommandPathSync;
  return { ...actual, resolveCommandPathSync: detectLocalMock.resolveCommandPathSync };
});

const mockSpawn = vi.mocked(spawn);
const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  detectLocalMock.resolveCommandPathSync.mockReset();
  detectLocalMock.resolveCommandPathSync.mockImplementation((command) => detectLocalMock.actual!(command));
});

function pinResolvedCommands(paths: Record<string, string>) {
  detectLocalMock.resolveCommandPathSync.mockImplementation((command) => (command ? paths[command] ?? null : null));
}

function makeChildProcess() {
  return {
    pid: 4321,
    stdin: {},
    stdout: {},
    stderr: { on: vi.fn() },
    on: vi.fn(),
  } as any;
}

describe('spawnAcpAgent', () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(makeChildProcess());
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env.SHELL = originalShell;
  });

  it('spawns with the absolute executable resolved for the agent command on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.SHELL = '/bin/zsh';
    pinResolvedCommands({ gemini: '/Users/test/bin/gemini' });

    spawnAcpAgent({ id: 'gemini' } as any);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/Users/test/bin/gemini',
      ['--acp'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('spawns Claude via the resolved npx executable instead of a bare command', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.SHELL = '/bin/zsh';
    pinResolvedCommands({ npx: '/Users/test/bin/npx' });

    spawnAcpAgent({ id: 'claude' } as any);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/Users/test/bin/npx',
      ['--yes', '@agentclientprotocol/claude-agent-acp'],
      expect.objectContaining({ shell: false }),
    );
  });
});

describe('killAgent', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses argv-safe taskkill for Windows process trees', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const acpProc = {
      id: 'acp-test-1',
      agentId: 'test',
      proc: makeChildProcess(),
      alive: true,
    };

    killAgent(acpProc);

    expect(mockExecFileSync).toHaveBeenCalledWith('taskkill', ['/PID', '4321', '/T', '/F'], { stdio: 'ignore' });
    expect(acpProc.alive).toBe(false);
  });

  it('keeps process cleanup subprocess calls argv-safe', () => {
    const source = fs.readFileSync(path.join(__dirname, 'subprocess.ts'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).not.toContain('taskkill /PID ${pid}');
    expect(source).toContain("execFileSync('taskkill', ['/PID', String(pid), '/T', '/F']");
  });

  it('keeps ACP terminal commands out of unconditional shell execution', () => {
    const source = fs.readFileSync(path.join(__dirname, 'subprocess.ts'), 'utf-8');

    expect(source).not.toContain('shell: true,');
    expect(source).toContain('const terminalSpawn = resolveTerminalSpawn(params.command);');
    expect(source).toContain('shell: terminalSpawn.shell');
  });
});

describe('resolveTerminalSpawn', () => {
  const originalPlatform = process.platform;
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env.SHELL = originalShell;
  });

  it('resolves terminal commands without enabling a shell on Unix', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.SHELL = '/bin/zsh';
    pinResolvedCommands({ node: '/usr/local/bin/node' });

    expect(resolveTerminalSpawn('node')).toEqual({
      command: '/usr/local/bin/node',
      shell: false,
    });
  });

  it('does not shell-evaluate unresolved command names with metacharacters', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.SHELL = '/bin/bash';
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(resolveTerminalSpawn('node && rm -rf /')).toEqual({
      command: 'node && rm -rf /',
      shell: false,
    });
  });

  it('uses a shell only for Windows cmd and bat launchers', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockExecFileSync.mockImplementation((command, args) => {
      if (command === 'where' && Array.isArray(args) && args[0] === 'npm') {
        return 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd\r\n' as any;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    expect(resolveTerminalSpawn('npm')).toEqual({
      command: 'C:\\Users\\test\\AppData\\Roaming\\npm\\npm.cmd',
      shell: true,
    });
  });
});

describe('createMindosClient permission policy', () => {
  function makeAcpProcess() {
    return {
      id: 'acp-test-policy',
      agentId: 'test-agent',
      proc: makeChildProcess(),
      alive: true,
    };
  }

  beforeEach(() => {
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(makeChildProcess());
  });

  it('selects a reject option for readonly permission requests', async () => {
    const client = createMindosClient(makeAcpProcess(), '/tmp/mind', {}, 'readonly');

    await expect(client.requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-1', status: 'pending' },
      options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    })).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('delegates ask-mode permission requests to the MindOS resolver', async () => {
    const onPermissionRequest = vi.fn();
    const onPermissionResolved = vi.fn();
    const resolvePermissionRequest = vi.fn().mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
    const client = createMindosClient(
      makeAcpProcess(),
      '/tmp/mind',
      { onPermissionRequest, onPermissionResolved, resolvePermissionRequest },
      'ask',
    );

    await expect(client.requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-1', status: 'pending' },
      options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    })).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    });

    expect(resolvePermissionRequest).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ status: 'pending', toolCallId: 'tc-1' }),
      mode: 'ask',
    }));
    expect(onPermissionRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(onPermissionResolved).toHaveBeenCalledWith(expect.objectContaining({
      status: 'resolved',
      selectedOptionId: 'allow',
      outcome: 'allow_once',
    }));
  });

  it('does not silently approve ask-mode permissions without a resolver', async () => {
    const client = createMindosClient(makeAcpProcess(), '/tmp/mind', {}, 'ask');

    await expect(client.requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-1', status: 'pending' },
      options: [
        { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    })).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('uses allow-once for auto permission and allow-always for full permission', async () => {
    const options = [
      { optionId: 'allow-once', kind: 'allow_once' as const, name: 'Allow once' },
      { optionId: 'allow-always', kind: 'allow_always' as const, name: 'Allow always' },
      { optionId: 'reject', kind: 'reject_once' as const, name: 'Reject' },
    ];

    await expect(createMindosClient(makeAcpProcess(), '/tmp/mind', {}, 'auto').requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-auto', status: 'pending' },
      options,
    })).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });

    await expect(createMindosClient(makeAcpProcess(), '/tmp/mind', {}, 'full').requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-full', status: 'pending' },
      options,
    })).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-always' },
    });
  });

  it('rejects readonly writes and terminal creation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-acp-readonly-'));
    const client = createMindosClient(makeAcpProcess(), root, {}, 'readonly');

    await expect(client.writeTextFile({ path: join(root, 'note.md'), content: 'x' }))
      .rejects.toThrow('readonly mode');
    await expect(client.createTerminal({ command: 'node' }))
      .rejects.toThrow('readonly mode');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('asks before host-side writes in ask mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-acp-ask-write-'));
    const resolvePermissionRequest = vi.fn().mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'allow_once' },
    });
    const client = createMindosClient(makeAcpProcess(), root, { resolvePermissionRequest }, 'ask');

    await client.writeTextFile({ path: 'note.md', content: 'written' });

    expect(resolvePermissionRequest).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        toolName: 'Write file',
        options: expect.arrayContaining([
          expect.objectContaining({ id: 'allow_once', kind: 'allow_once' }),
        ]),
      }),
      mode: 'ask',
    }));
    expect(readFileSync(join(root, 'note.md'), 'utf-8')).toBe('written');
  });

  it('passes runtime env to ACP terminal subprocesses without overriding request env', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-acp-terminal-env-'));
    mockExecFileSync.mockImplementation((command, args) => {
      if (command === 'which' && Array.isArray(args) && args[0] === 'node') {
        return '/usr/bin/node\n' as any;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });
    mockSpawn.mockReturnValue({
      ...makeChildProcess(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
    } as any);
    const client = createMindosClient(
      makeAcpProcess(),
      root,
      {},
      'agent',
      { GEMINI_API_KEY: 'runtime-key', SHARED_KEY: 'runtime-shared' },
    );

    await expect(client.createTerminal({
      command: 'node',
      args: ['-v'],
      env: [{ name: 'SHARED_KEY', value: 'request-shared' }],
    })).resolves.toEqual({ terminalId: expect.stringMatching(/^term-/) });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['-v'],
      expect.objectContaining({
        env: expect.objectContaining({
          GEMINI_API_KEY: 'runtime-key',
          SHARED_KEY: 'request-shared',
        }),
        shell: false,
      }),
    );
  });

  it('resolves relative file paths against the ACP working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-acp-paths-'));
    writeFileSync(join(root, 'note.md'), 'hello', 'utf-8');
    const client = createMindosClient(makeAcpProcess(), root, {}, 'agent');

    await expect(client.readTextFile({ path: 'note.md' })).resolves.toEqual({ content: 'hello' });
    await client.writeTextFile({ path: 'nested/out.md', content: 'written' });
    expect(readFileSync(join(root, 'nested/out.md'), 'utf-8')).toBe('written');
  });

  it('denies reads outside the ACP working directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-acp-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-acp-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'secret', 'utf-8');
    const client = createMindosClient(makeAcpProcess(), root, {}, 'agent');

    await expect(client.readTextFile({ path: join(outside, 'secret.md') }))
      .rejects.toThrow('outside the working directory');
  });
});

/** A terminal child that behaves like a ChildProcess for exit/kill purposes (no real pid: nothing gets signalled). */
function makeTerminalChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined as number | undefined,
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(),
    stdin: {},
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  return child;
}

function pinNodeCommand() {
  mockExecFileSync.mockImplementation((command, args) => {
    if (command === 'which' && Array.isArray(args) && args[0] === 'node') {
      return '/usr/bin/node\n' as any;
    }
    throw new Error(`unexpected command: ${String(command)}`);
  });
}

describe('process bookkeeping', () => {
  const entry = { id: 'test-agent', name: 'Test', description: 'test', transport: 'stdio' as const, command: 'test-agent' };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(makeChildProcess());
    pinResolvedCommands({ 'test-agent': '/usr/local/bin/test-agent' });
  });

  it('gives two spawns in the same millisecond distinct process ids', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    let a: ReturnType<typeof spawnAcpAgent> | undefined;
    let b: ReturnType<typeof spawnAcpAgent> | undefined;
    try {
      a = spawnAcpAgent(entry);
      b = spawnAcpAgent(entry);
      expect(a.id).not.toBe(b.id);
      expect(a.id).toMatch(/^acp-test-agent-[0-9a-f-]{36}$/);
    } finally {
      vi.useRealTimers();
      if (a) killAgent(a);
      if (b) killAgent(b);
    }
  });

  it('forgets a process that exits on its own and kills its leftover terminals', async () => {
    const agentChild = makeChildProcess();
    mockSpawn.mockReturnValueOnce(agentChild);
    const proc = spawnAcpAgent(entry);
    expect(getProcess(proc.id)).toBe(proc);

    pinNodeCommand();
    const terminal = makeTerminalChild();
    mockSpawn.mockReturnValueOnce(terminal as any);
    const client = createMindosClient(proc, mkdtempSync(join(tmpdir(), 'mindos-acp-close-')), {}, 'auto');
    await client.createTerminal({ command: 'node' });

    const closeHandler = agentChild.on.mock.calls.find(([event]: [string]) => event === 'close')?.[1];
    expect(closeHandler).toBeTypeOf('function');
    closeHandler(0, null);

    expect(proc.alive).toBe(false);
    expect(getProcess(proc.id)).toBeUndefined();
    expect(getActiveProcesses()).not.toContain(proc);
    expect(terminal.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('terminal lifecycle', () => {
  function makeAcpProcess() {
    return { id: `acp-terminal-${Math.random().toString(36).slice(2)}`, agentId: 'test-agent', proc: makeChildProcess(), alive: true };
  }

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockSpawn.mockReset();
    pinNodeCommand();
  });

  it('spawns terminals in their own process group so the whole tree can be killed', async () => {
    const terminal = makeTerminalChild();
    mockSpawn.mockReturnValue(terminal as any);
    const client = createMindosClient(makeAcpProcess(), mkdtempSync(join(tmpdir(), 'mindos-acp-term-group-')), {}, 'auto');

    await client.createTerminal({ command: 'node', args: ['-v'] });

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['-v'],
      expect.objectContaining({ detached: process.platform !== 'win32' }),
    );
  });

  it('removes its exit listener when waitForTerminalExit settles', async () => {
    const terminal = makeTerminalChild();
    mockSpawn.mockReturnValue(terminal as any);
    const client = createMindosClient(makeAcpProcess(), mkdtempSync(join(tmpdir(), 'mindos-acp-term-wait-')), {}, 'auto');
    const { terminalId } = await client.createTerminal({ command: 'node' });

    const waiting = client.waitForTerminalExit({ terminalId });
    expect(terminal.listenerCount('exit')).toBe(1);
    terminal.exitCode = 0;
    terminal.emit('exit', 0, null);
    await expect(waiting).resolves.toEqual({ exitCode: 0, signal: null });
    expect(terminal.listenerCount('exit')).toBe(0);

    await expect(client.waitForTerminalExit({ terminalId })).resolves.toEqual({ exitCode: 0, signal: null });
    expect(terminal.listenerCount('exit')).toBe(0);
  });
});

describe('permission request ids and ask-mode waiting', () => {
  function makeAcpProcess() {
    return { id: 'acp-test-permission', agentId: 'test-agent', proc: makeChildProcess(), alive: true };
  }
  const options = [
    { optionId: 'allow', kind: 'allow_once' as const, name: 'Allow' },
    { optionId: 'reject', kind: 'reject_once' as const, name: 'Reject' },
  ];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives two requests for the same tool in the same millisecond distinct request ids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const ids: string[] = [];
    const client = createMindosClient(
      makeAcpProcess(),
      '/tmp/mind',
      { onPermissionRequest: (event) => ids.push(event.requestId) },
      'auto',
    );
    const params = { sessionId: 'ses-1', toolCall: { toolCallId: 'tc-1', status: 'pending' as const }, options };

    await client.requestPermission(params);
    await client.requestPermission(params);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('cancels an ask-mode request that receives no answer within permissionWaitMs and records the reason', async () => {
    vi.useFakeTimers();
    const resolved: AcpPermissionEvent[] = [];
    const client = createMindosClient(
      makeAcpProcess(),
      '/tmp/mind',
      {
        onPermissionResolved: (event) => resolved.push(event),
        resolvePermissionRequest: () => new Promise(() => {}),
      },
      'ask',
      {},
      { permissionWaitMs: 1_000 },
    );

    const pending = client.requestPermission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'tc-slow', status: 'pending' },
      options,
    });
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(pending).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      status: 'resolved',
      outcome: 'cancelled',
      toolCallId: 'tc-slow',
      reason: expect.stringContaining('1s'),
    });
  });

  it('ignores a resolver answer that arrives after the wait expired', async () => {
    vi.useFakeTimers();
    const resolved: AcpPermissionEvent[] = [];
    let answer!: (response: { outcome: { outcome: 'selected'; optionId: string } }) => void;
    const client = createMindosClient(
      makeAcpProcess(),
      '/tmp/mind',
      {
        onPermissionResolved: (event) => resolved.push(event),
        resolvePermissionRequest: () => new Promise((resolve) => { answer = resolve; }),
      },
      'ask',
      {},
      { permissionWaitMs: 1_000 },
    );

    const pending = client.requestPermission({ sessionId: 'ses-1', toolCall: { toolCallId: 'tc-late', status: 'pending' }, options });
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual({ outcome: { outcome: 'cancelled' } });
    answer({ outcome: { outcome: 'selected', optionId: 'allow' } });
    await vi.advanceTimersByTimeAsync(1);

    expect(resolved).toHaveLength(1);
  });
});
