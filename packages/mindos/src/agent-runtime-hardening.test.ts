import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendBoundedLog,
  clearLoginShellEnvValueCache,
  createClaudeCodeCliClient,
  createClaudeCodeCliStdioTransport,
  createCodexAppServerStdioTransport,
  killChildWithEscalation,
  readLoginShellEnvValue,
  runMindosAgentRuntimeAskSession,
  type ClaudeCodeCliTransport,
  type CodexAppServerMessage,
  type MindOSSSEvent,
} from './agent-runtime.js';

function createCapturingClaudeTransport(lines: string[]): ClaudeCodeCliTransport & { argv: string[] | null } {
  return {
    argv: null,
    run(args) {
      this.argv = args;
      return {
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield line;
        },
      };
    },
  };
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

type FakeChild = {
  kills: string[];
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  exitListeners: Array<() => void>;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: string, listener: () => void): FakeChild;
};

function createFakeChild(): FakeChild {
  return {
    kills: [],
    exitCode: null,
    signalCode: null,
    exitListeners: [],
    kill(signal: NodeJS.Signals = 'SIGTERM') {
      this.kills.push(signal);
      return true;
    },
    once(event: string, listener: () => void) {
      if (event === 'exit') this.exitListeners.push(listener);
      return this;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('claude-code-cli argv safety', () => {
  it('places a -- separator before the prompt so dash-prefixed prompts are not parsed as flags', async () => {
    const transport = createCapturingClaudeTransport([
      '{"type":"result","result":"ok","session_id":"s1"}',
    ]);
    const client = createClaudeCodeCliClient(transport);
    await drain(client.startTurn({ prompt: '--dangerously-skip-permissions', cwd: '/tmp' }));

    const argv = transport.argv!;
    expect(argv.at(-1)).toBe('--dangerously-skip-permissions');
    expect(argv.at(-2)).toBe('--');
  });
});

describe('claude-code-cli stream resilience', () => {
  it('skips malformed JSON lines instead of failing the turn', async () => {
    const transport = createCapturingClaudeTransport([
      'Warning: something logged to stdout',
      '"just-a-string"',
      '{"type":"result","result":"final answer","session_id":"s1"}',
    ]);
    const client = createClaudeCodeCliClient(transport);
    const events = await drain(client.startTurn({ prompt: 'hi', cwd: '/tmp' }));

    expect(events).toContainEqual({ type: 'session_id', sessionId: 's1' });
    expect(events).toContainEqual({ type: 'text_delta', delta: 'final answer' });
    expect(events).toContainEqual({ type: 'done' });
  });
});

describe('claude-code-cli stdio transport process handling', () => {
  it('reports an error when the CLI process is killed by a signal', async () => {
    const transport = createClaudeCodeCliStdioTransport({ command: process.execPath });
    const iterable = transport.run(
      ['-e', 'process.kill(process.pid, "SIGKILL")'],
      { cwd: process.cwd() },
    );
    await expect(drain(iterable)).rejects.toThrow(/SIGKILL/);
  });

  it('caps captured stderr so huge error output cannot exhaust memory', async () => {
    const transport = createClaudeCodeCliStdioTransport({ command: process.execPath });
    const iterable = transport.run(
      ['-e', 'process.stderr.write("x".repeat(200 * 1024)); process.exit(1)'],
      { cwd: process.cwd() },
    );
    await expect(drain(iterable)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message.length).toBeLessThanOrEqual(64 * 1024);
      return true;
    });
  });
});

describe('codex app-server stdio transport process handling', () => {
  it('skips malformed JSON lines from the app-server stream', async () => {
    const transport = createCodexAppServerStdioTransport({
      command: process.execPath,
      args: ['-e', 'console.log("startup noise"); console.log(JSON.stringify({ method: "turn/completed", params: {} }))'],
    });
    const messages = await drain(transport.read());
    expect(messages).toEqual([{ method: 'turn/completed', params: {} }]);
  });

  it('throws when the app-server is killed by a signal', async () => {
    const transport = createCodexAppServerStdioTransport({
      command: process.execPath,
      args: ['-e', 'process.kill(process.pid, "SIGKILL")'],
    });
    await expect(drain(transport.read())).rejects.toThrow(/SIGKILL/);
  });

  it('does not report a signal error when the transport itself was closed', async () => {
    const transport = createCodexAppServerStdioTransport({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    const reading = drain(transport.read());
    await new Promise((resolve) => setTimeout(resolve, 150));
    transport.close?.();
    await expect(reading).resolves.toEqual([]);
  });

  it('send() throws a descriptive error instead of crashing after the app-server exits', async () => {
    const transport = createCodexAppServerStdioTransport({
      command: process.execPath,
      args: ['-e', ''],
    });
    await drain(transport.read());
    expect(() => transport.send({ method: 'thread/start', id: 1, params: {} }))
      .toThrow(/not running/i);
  });

  it('caps captured stderr from the app-server', async () => {
    const transport = createCodexAppServerStdioTransport({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("y".repeat(200 * 1024)); process.exit(1)'],
    });
    await expect(drain(transport.read())).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message.length).toBeLessThanOrEqual(64 * 1024);
      return true;
    });
  });
});

describe('killChildWithEscalation', () => {
  it('escalates to SIGKILL after the grace period when the child ignores SIGTERM', () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    killChildWithEscalation(child, 100);
    expect(child.kills).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(100);
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('does not escalate when the child exits within the grace period', () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    killChildWithEscalation(child, 100);
    for (const listener of child.exitListeners) listener();
    vi.advanceTimersByTime(200);
    expect(child.kills).toEqual(['SIGTERM']);
  });

  it('is a no-op when the child has already exited', () => {
    const child = createFakeChild();
    child.exitCode = 0;
    killChildWithEscalation(child, 100);
    expect(child.kills).toEqual([]);
  });
});

describe('appendBoundedLog', () => {
  it('keeps only the most recent output once the cap is reached', () => {
    let log = '';
    log = appendBoundedLog(log, 'aaaa', 10);
    log = appendBoundedLog(log, 'bbbb', 10);
    log = appendBoundedLog(log, 'cccc', 10);
    expect(log.length).toBeLessThanOrEqual(10);
    expect(log.endsWith('cccc')).toBe(true);
  });

  it('returns short logs unchanged', () => {
    expect(appendBoundedLog('ab', 'cd', 10)).toBe('abcd');
  });
});

describe('native runtime error redaction', () => {
  it('redacts secrets from transport failures before sending them to the client', async () => {
    const events: MindOSSSEvent[] = [];
    const secret = 'sk-aaaaaaaaaaaaaaaaaaaaaaaa';
    const result = await runMindosAgentRuntimeAskSession({
      runtime: { kind: 'claude', id: 'claude', name: 'Claude Code', binaryPath: '/usr/local/bin/claude' },
      cwd: '/tmp',
      prompt: 'hi',
      send: (event) => events.push(event),
      services: {
        createClaudeClient: () => {
          throw new Error(`request failed: api_key=${secret}`);
        },
      },
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).not.toContain(secret);
    const errorEvent = events.find((event) => event.type === 'error') as { message: string } | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).not.toContain(secret);
  });
});

describe('login shell environment value caching', () => {
  it('reads each key through the shell only once per process', () => {
    clearLoginShellEnvValueCache();
    let calls = 0;
    const reader = (key: string) => {
      calls += 1;
      return key === 'MINDOS_CACHED_KEY' ? 'cached-value' : undefined;
    };

    expect(readLoginShellEnvValue('MINDOS_CACHED_KEY', {}, reader)).toBe('cached-value');
    expect(readLoginShellEnvValue('MINDOS_CACHED_KEY', {}, reader)).toBe('cached-value');
    expect(calls).toBe(1);
  });

  it('caches missing keys too, so absent vars do not re-trigger slow shell probes', () => {
    clearLoginShellEnvValueCache();
    let calls = 0;
    const reader = () => {
      calls += 1;
      return undefined;
    };

    expect(readLoginShellEnvValue('MINDOS_MISSING_KEY', {}, reader)).toBeUndefined();
    expect(readLoginShellEnvValue('MINDOS_MISSING_KEY', {}, reader)).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('caches keys independently', () => {
    clearLoginShellEnvValueCache();
    const reader = (key: string) => (key === 'MINDOS_KEY_A' ? 'a-value' : undefined);
    expect(readLoginShellEnvValue('MINDOS_KEY_A', {}, reader)).toBe('a-value');
    expect(readLoginShellEnvValue('MINDOS_KEY_B', {}, reader)).toBeUndefined();
    expect(readLoginShellEnvValue('MINDOS_KEY_A', {}, reader)).toBe('a-value');
  });
});
