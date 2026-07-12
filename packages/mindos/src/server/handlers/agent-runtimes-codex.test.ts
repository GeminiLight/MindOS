import { describe, expect, it, vi } from 'vitest';
import {
  handleCodexModelsGet,
  handleCodexThreadArchivePost,
  handleCodexThreadForkPost,
  handleCodexThreadGet,
  handleCodexThreadUnarchivePost,
  handleCodexThreadsGet,
  type CodexThreadManagerServices,
} from './agent-runtimes-codex.js';

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
