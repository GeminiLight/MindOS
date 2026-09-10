import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexAppServerClient } from '../../agent/runtime/codex-app-server.js';
import {
  CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS,
  closePooledCodexAppServerClients,
  handleCodexModelsGet,
  handleCodexThreadArchivePost,
  handleCodexThreadForkPost,
  handleCodexThreadGet,
  handleCodexThreadUnarchivePost,
  handleCodexThreadsGet,
  type CodexThreadManagerServices,
} from './agent-runtimes-codex.js';
import { resetRuntimeDetectionCacheForTest } from './runtime-detection-cache.js';

beforeEach(() => {
  resetRuntimeDetectionCacheForTest();
});

afterEach(() => {
  closePooledCodexAppServerClients();
  resetRuntimeDetectionCacheForTest();
  vi.useRealTimers();
});

function createFakeServices(): CodexThreadManagerServices & { calls: Array<{ method: string; input?: unknown }> } {
  const calls: Array<{ method: string; input?: unknown }> = [];
  return {
    calls,
    createCodexClient: async () => ({
      initialize: async () => {
        calls.push({ method: 'initialize' });
      },
      listModels: async (input) => {
        calls.push({ method: 'model/list', input });
        return {
          data: [{
            id: 'gpt-5.6-sol',
            model: 'gpt-5.6-sol',
            displayName: 'GPT-5.6 Sol',
            description: 'Fast coding model',
            hidden: false,
            isDefault: true,
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Fastest' },
              { reasoningEffort: 'ultra', description: 'Maximum reasoning with delegation' },
            ],
            defaultReasoningEffort: 'low',
          }],
          nextCursor: null,
        };
      },
      listThreads: async (input) => {
        calls.push({ method: 'thread/list', input });
        return {
          data: [{
            id: 'thr-existing',
            sessionId: 'sess-existing',
            preview: 'Existing thread',
            ephemeral: false,
            modelProvider: 'openai',
            createdAt: 1,
            updatedAt: 2,
            cwd: '/tmp/mind',
            status: { type: 'idle' },
            cliVersion: '0.138.0',
            source: 'appServer',
            turns: [],
          }],
          nextCursor: null,
          backwardsCursor: null,
        };
      },
      readThread: async (input) => {
        calls.push({ method: 'thread/read', input });
        return {
          thread: {
            id: input.threadId,
            sessionId: 'sess-existing',
            preview: 'Existing thread',
            turns: input.includeTurns ? [{ id: 'turn-existing' }] : [],
          },
        };
      },
      forkThread: async (input) => {
        calls.push({ method: 'thread/fork', input });
        return {
          thread: {
            id: 'thr-forked',
            forkedFromId: input.threadId,
            preview: 'Forked thread',
            cwd: input.cwd ?? '/tmp/mind',
            turns: [],
          },
        };
      },
      archiveThread: async (input) => {
        calls.push({ method: 'thread/archive', input });
      },
      unarchiveThread: async (input) => {
        calls.push({ method: 'thread/unarchive', input });
        return {
          thread: {
            id: input.threadId,
            preview: 'Existing thread',
            turns: [],
          },
        };
      },
      startThread: vi.fn(),
      resumeThread: vi.fn(),
      startTurn: vi.fn(),
      close: async () => {
        calls.push({ method: 'close' });
      },
    }),
  };
}

describe('Codex thread manager product handlers', () => {
  it('lists Codex model capabilities without starting a thread or turn', async () => {
    const services = createFakeServices();
    const res = await handleCodexModelsGet(services);

    expect(res.status).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({
      data: [expect.objectContaining({
        id: 'gpt-5.6-sol',
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: expect.arrayContaining([
          expect.objectContaining({ reasoningEffort: 'ultra' }),
        ]),
      })],
      nextCursor: null,
    });
    expect(services.calls).toEqual([
      { method: 'initialize' },
      { method: 'model/list', input: { includeHidden: true, limit: 100 } },
      { method: 'close' },
    ]);
  });

  it('lists Codex threads without starting a turn', async () => {
    const services = createFakeServices();
    const res = await handleCodexThreadsGet(
      new URLSearchParams('limit=25&archived=false&cwd=/tmp/mind&searchTerm=Existing&useStateDbOnly=1'),
      services,
    );

    expect(res.status).toBe(200);
    expect(res.headers?.['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({
      data: [expect.objectContaining({ id: 'thr-existing', preview: 'Existing thread' })],
      nextCursor: null,
      backwardsCursor: null,
    });
    expect(services.calls).toEqual([
      { method: 'initialize' },
      {
        method: 'thread/list',
        input: {
          limit: 25,
          archived: false,
          cwd: '/tmp/mind',
          useStateDbOnly: true,
          searchTerm: 'Existing',
        },
      },
      { method: 'close' },
    ]);
    expect(services.calls.map((call) => call.method)).not.toContain('turn/start');
  });

  it('reads a Codex thread with turns only when requested', async () => {
    const services = createFakeServices();
    const res = await handleCodexThreadGet('thr-existing', new URLSearchParams('includeTurns=true'), services);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      thread: expect.objectContaining({
        id: 'thr-existing',
        turns: [{ id: 'turn-existing' }],
      }),
    });
    expect(services.calls).toEqual([
      { method: 'initialize' },
      {
        method: 'thread/read',
        input: { threadId: 'thr-existing', includeTurns: true },
      },
      { method: 'close' },
    ]);
  });

  it('forks, archives, and unarchives through Codex thread APIs', async () => {
    const services = createFakeServices();

    const fork = await handleCodexThreadForkPost('thr-existing', { cwd: '/tmp/forked', ephemeral: true }, services);
    const archive = await handleCodexThreadArchivePost('thr-existing', services);
    const unarchive = await handleCodexThreadUnarchivePost('thr-existing', services);

    expect(fork.status).toBe(200);
    expect(fork.body).toEqual({
      thread: expect.objectContaining({
        id: 'thr-forked',
        forkedFromId: 'thr-existing',
        cwd: '/tmp/forked',
      }),
    });
    expect(archive.body).toEqual({ ok: true });
    expect(unarchive.body).toEqual({
      thread: expect.objectContaining({ id: 'thr-existing' }),
    });
    expect(services.calls.map((call) => call.method)).toEqual([
      'initialize',
      'thread/fork',
      'close',
      'initialize',
      'thread/archive',
      'close',
      'initialize',
      'thread/unarchive',
      'close',
    ]);
    expect(services.calls.map((call) => call.method)).not.toContain('turn/start');
  });

  it('rejects invalid list limits and missing thread ids before creating a Codex client', async () => {
    const services = createFakeServices();

    const badLimit = await handleCodexThreadsGet(new URLSearchParams('limit=1000'), services);
    const badThread = await handleCodexThreadGet('', new URLSearchParams(), services);

    expect(badLimit.status).toBe(400);
    expect(badLimit.body).toEqual({ error: 'limit must be an integer between 1 and 100.' });
    expect(badThread.status).toBe(400);
    expect(badThread.body).toEqual({ error: 'Missing Codex thread id.' });
    expect(services.calls).toEqual([]);
  });

  it('uses the explicitly configured Codex command and env when checking thread runtime availability', async () => {
    const explicitCommand = '/custom/codex-wrapper';
    const healthCalls: Array<{ binaryPath: string; env?: NodeJS.ProcessEnv }> = [];
    const res = await handleCodexThreadsGet(new URLSearchParams('limit=10'), {
      readSettings: () => ({
        acpAgents: {
          codex: {
            command: explicitCommand,
            env: { PATH: '/custom/bin:/usr/bin', CODEX_HOME: '/custom/codex-home' },
          },
        },
      }),
      resolveRuntimeCommand: async () => '/usr/local/bin/codex',
      resolveRuntimeCommandCandidates: async () => ['/usr/local/bin/codex'],
      checkCodexRuntimeHealth: async (binaryPath, env) => {
        healthCalls.push({ binaryPath, env });
        return { status: 'signed-out', reason: 'explicit wrapper failed' };
      },
    });

    expect(res).toEqual({
      status: 409,
      body: { error: 'Codex is signed out. explicit wrapper failed' },
    });
    expect(healthCalls).toHaveLength(1);
    expect(healthCalls[0]).toMatchObject({
      binaryPath: explicitCommand,
      env: expect.objectContaining({
        PATH: '/custom/bin:/usr/bin',
        CODEX_HOME: '/custom/codex-home',
      }),
    });
  });
});

/** A fake app-server client for the pool: records lifecycle calls and lets a test make one call fail. */
function createPoolFixture() {
  const events: string[] = [];
  let constructed = 0;
  let failNextList = false;
  const factory = ({ command, env }: { command: string; env?: NodeJS.ProcessEnv }): CodexAppServerClient => {
    constructed += 1;
    const id = constructed;
    events.push(`construct#${id} ${command} ${env?.CODEX_HOME ?? '-'}`);
    return {
      initialize: async () => { events.push(`initialize#${id}`); },
      listModels: async () => ({ data: [], nextCursor: null }),
      listThreads: async () => {
        if (failNextList) {
          failNextList = false;
          throw new Error('app-server stopped unexpectedly');
        }
        events.push(`thread/list#${id}`);
        return { data: [], nextCursor: null, backwardsCursor: null };
      },
      readThread: vi.fn(),
      forkThread: vi.fn(),
      archiveThread: vi.fn(),
      unarchiveThread: vi.fn(),
      startThread: vi.fn(),
      resumeThread: vi.fn(),
      startTurn: vi.fn(),
      close: async () => { events.push(`close#${id}`); },
    } as unknown as CodexAppServerClient;
  };
  const healthChecks = vi.fn(async () => ({ status: 'available' as const }));
  const services: CodexThreadManagerServices = {
    // An empty PATH keeps the candidate plan away from whatever Codex this machine has installed.
    readSettings: () => ({ acpAgents: { codex: { env: { CODEX_HOME: '/tmp/codex-home', PATH: '/nonexistent' } } } }),
    resolveRuntimeCommand: async () => '/usr/local/bin/codex',
    resolveRuntimeCommandCandidates: async () => [],
    checkCodexRuntimeHealth: healthChecks,
    createPooledCodexClient: factory,
  };
  return {
    services,
    events,
    healthChecks,
    failNextList: () => { failNextList = true; },
  };
}

describe('Codex thread manager app-server client pool', () => {
  it('reuses one initialized app-server client across consecutive thread requests and runs the health check once', async () => {
    const fixture = createPoolFixture();

    for (let i = 0; i < 3; i += 1) {
      const res = await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
      expect(res.status).toBe(200);
    }

    expect(fixture.events).toEqual([
      'construct#1 /usr/local/bin/codex /tmp/codex-home',
      'initialize#1',
      'thread/list#1',
      'thread/list#1',
      'thread/list#1',
    ]);
    expect(fixture.healthChecks).toHaveBeenCalledTimes(1);
  });

  it('shares one client between concurrent requests while it is still initializing', async () => {
    const fixture = createPoolFixture();

    const responses = await Promise.all(Array.from({ length: 4 }, () => handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services)));

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(fixture.events.filter((event) => event.startsWith('construct'))).toHaveLength(1);
    expect(fixture.events.filter((event) => event.startsWith('initialize'))).toHaveLength(1);
  });

  it('closes the pooled client after the idle TTL and starts a fresh one afterwards', async () => {
    vi.useFakeTimers();
    const fixture = createPoolFixture();

    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    await vi.advanceTimersByTimeAsync(CODEX_APP_SERVER_CLIENT_IDLE_TTL_MS - 1);
    expect(fixture.events).not.toContain('close#1');
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.events).toContain('close#1');

    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    expect(fixture.events.filter((event) => event.startsWith('construct'))).toHaveLength(2);
  });

  it('drops a pooled client whose request failed so the next request starts a fresh app-server', async () => {
    const fixture = createPoolFixture();

    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    fixture.failNextList();
    const failed = await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    expect(failed.status).toBe(500);
    expect(fixture.events).toContain('close#1');

    const recovered = await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    expect(recovered.status).toBe(200);
    expect(fixture.events.filter((event) => event.startsWith('construct'))).toHaveLength(2);
  });

  it('keeps one pooled client per command and env pair', async () => {
    const fixture = createPoolFixture();
    const other: CodexThreadManagerServices = {
      ...fixture.services,
      readSettings: () => ({ acpAgents: { codex: { env: { CODEX_HOME: '/tmp/other-home', PATH: '/nonexistent' } } } }),
    };

    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);
    await handleCodexThreadsGet(new URLSearchParams('limit=5'), other);
    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);

    expect(fixture.events.filter((event) => event.startsWith('construct'))).toEqual([
      'construct#1 /usr/local/bin/codex /tmp/codex-home',
      'construct#2 /usr/local/bin/codex /tmp/other-home',
    ]);
  });

  it('closes every pooled client on shutdown', async () => {
    const fixture = createPoolFixture();
    await handleCodexThreadsGet(new URLSearchParams('limit=5'), fixture.services);

    closePooledCodexAppServerClients();

    expect(fixture.events).toContain('close#1');
  });
});
