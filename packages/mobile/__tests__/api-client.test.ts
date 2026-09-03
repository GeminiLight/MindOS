import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
const secureStorage = vi.hoisted(() => new Map<string, string>());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    multiGet: vi.fn((keys: string[]) => Promise.resolve(keys.map((key) => [key, storage.get(key) ?? null]))),
    multiRemove: vi.fn((keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
      return Promise.resolve();
    }),
  },
}));

import { mindosClient } from '@/lib/api-client';
import {
  LEGACY_AUTH_TOKEN_STORAGE_KEY,
  readConnectionAuthToken,
  setSecureTokenStoreAdapterForTests,
} from '@/lib/connection-secret-store';

describe('mindosClient auth', () => {
  beforeEach(async () => {
    storage.clear();
    secureStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    setSecureTokenStoreAdapterForTests({
      getItemAsync: vi.fn((key: string) => Promise.resolve(secureStorage.get(key) ?? null)),
      setItemAsync: vi.fn((key: string, value: string) => {
        secureStorage.set(key, value);
        return Promise.resolve();
      }),
      deleteItemAsync: vi.fn((key: string) => {
        secureStorage.delete(key);
        return Promise.resolve();
      }),
    });
    await mindosClient.disconnect();
    mindosClient.setConnectionObserver(null);
  });

  it('sends the bearer token on API requests', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567/');
    mindosClient.setAuthToken('  secret-token  ');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tree: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await mindosClient.getFileTree();

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/files',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('normalizes the server file path list into a mobile file tree', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(['Space/note.md']), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getFileTree()).resolves.toEqual([
      {
        type: 'directory',
        name: 'Space',
        path: 'Space',
        children: [
          { type: 'file', name: 'note.md', path: 'Space/note.md', extension: '.md' },
        ],
      },
    ]);
  });

  it('returns stale cached file tree data when refresh fails', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    storage.set('mindos_file_tree_cache', JSON.stringify([
      { type: 'file', name: 'cached.md', path: 'cached.md', extension: '.md' },
    ]));

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network request failed'));

    await expect(mindosClient.getFileTreeWithStatus()).resolves.toEqual({
      stale: true,
      error: 'Network request failed',
      tree: [
        { type: 'file', name: 'cached.md', path: 'cached.md', extension: '.md' },
      ],
    });
  });

  it('creates files through the no-overwrite create_file operation', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, mtime: 123 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.createFile('Space/note.md', '# Note\n')).resolves.toEqual({
      ok: true,
      mtime: 123,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/file',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          op: 'create_file',
          path: 'Space/note.md',
          content: '# Note\n',
        }),
      }),
    );
  });

  it('maps create_file conflicts to a non-overwriting exists result', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'File already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.createFile('note.md', '# Note\n')).resolves.toEqual({
      ok: false,
      error: 'exists',
    });
  });

  it('persists and clears the optional access token through secure storage', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    await mindosClient.persistServer();

    expect(storage.get('mindos_server_url')).toBe('http://127.0.0.1:4567');
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('secret-token');

    await mindosClient.disconnect();

    expect(mindosClient.baseUrl).toBe('');
    expect(mindosClient.hasAuthToken).toBe(false);
    expect(storage.has('mindos_server_url')).toBe(false);
    expect(storage.has(LEGACY_AUTH_TOKEN_STORAGE_KEY)).toBe(false);
    await expect(readConnectionAuthToken()).resolves.toBe('');
  });

  it('maps protected API failures to auth_required during probing', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');

    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(mindosClient.probeApiAccess()).resolves.toEqual({
      ok: false,
      reason: 'auth_required',
      status: 401,
      message: 'Access token required or invalid.',
    });
  });

  it('loads agent runtimes with auth and normalizes malformed registry payloads', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ runtimes: 'bad', installed: null, notInstalled: undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getAgentRuntimes({ force: true })).resolves.toEqual({
      runtimes: [],
      installed: [],
      notInstalled: [],
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent-runtimes?force=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('resolves runtime permission requests through the MindOS server', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.resolveRuntimePermission({
      runId: 'run-1',
      requestId: 'req-1',
      decision: 'allow-once',
    })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent/runtime-permission',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        }),
        body: JSON.stringify({
          runId: 'run-1',
          requestId: 'req-1',
          decision: 'allow-once',
        }),
      }),
    );
  });

  it('loads pending agent actions and normalizes missing collections', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      permissions: [{ kind: 'runtime-permission', requestId: 'req-1' }],
      questions: null,
      automationApprovals: [{ kind: 'automation-approval', approvalId: 'approval-1' }],
      pendingCount: 2,
      generatedAt: 123,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(mindosClient.getPendingAgentActions()).resolves.toEqual({
      permissions: [{ kind: 'runtime-permission', requestId: 'req-1' }],
      questions: [],
      automationApprovals: [{ kind: 'automation-approval', approvalId: 'approval-1' }],
      pendingCount: 2,
      generatedAt: 123,
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent/pending-actions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }),
    );
  });

  it('resolves a durable automation approval through the MindOS server', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(mindosClient.resolveAutomationApproval({
      approvalId: 'approval-1',
      decision: 'allow',
    })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent/automation-approval',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ approvalId: 'approval-1', decision: 'allow' }),
      }),
    );
  });

  it('answers and cancels AskUserQuestion requests through the MindOS server', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const answer = {
      runId: 'run-1',
      toolCallId: 'tool-1',
      answers: [{ questionIndex: 0, question: 'Ship?', kind: 'option' as const, answer: 'Yes' }],
    };
    await expect(mindosClient.resolveUserQuestion(answer)).resolves.toEqual({ ok: true });
    await expect(mindosClient.resolveUserQuestion({
      runId: 'run-2', toolCallId: 'tool-2', action: 'cancel', reason: 'user_cancelled',
    })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenNthCalledWith(1,
      'http://127.0.0.1:4567/api/agent/user-question',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(answer) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(2,
      'http://127.0.0.1:4567/api/agent/user-question',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({
        runId: 'run-2', toolCallId: 'tool-2', action: 'cancel', reason: 'user_cancelled',
      }) }),
    );
  });

  it('loads agent run activity for the active mobile chat session', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({
        runs: [
          {
            id: 'run-1',
            chatSessionId: 'chat-1',
            agentKind: 'pi-subagent',
            runtimeId: 'reviewer',
            displayName: 'Reviewer',
            status: 'running',
            permissionMode: 'agent',
            inputSummary: 'Review',
            startedAt: 1000,
          },
        ],
        events: 'bad',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getAgentRuns({
      chatSessionId: 'chat-1',
      startedAfter: 900,
      limit: 20,
    })).resolves.toMatchObject({
      runs: [expect.objectContaining({ id: 'run-1' })],
      events: [],
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent-runs?chatSessionId=chat-1&startedAfter=900&limit=20&includeEvents=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('loads recent global agent run activity for the mobile home surface', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({
        runs: [
          {
            id: 'run-1',
            agentKind: 'native-runtime',
            runtimeId: 'codex',
            displayName: 'Codex',
            status: 'completed',
            permissionMode: 'agent',
            inputSummary: 'Fix tests',
            startedAt: 1000,
            completedAt: 1200,
          },
        ],
        events: [],
        observatory: { traces: [{ id: 'run-1', capsule: { id: 'capsule-1' } }] },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(mindosClient.getAgentRuns({
      limit: 6,
      includeEvents: true,
    })).resolves.toMatchObject({
      runs: [expect.objectContaining({ id: 'run-1' })],
      events: [],
      observatory: { traces: [{ id: 'run-1', capsule: { id: 'capsule-1' } }] },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4567/api/agent-runs?limit=6&includeEvents=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
  });

  it('starts capsule recovery through the plan and canonical turn contracts', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        plan: { id: 'recovery-plan-1', targetChatSessionId: 'chat-recovery' },
      }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('data: {"type":"agent_run_context"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));

    await expect(mindosClient.recoverAgentRunCapsule('capsule-1', 'retry')).resolves.toEqual({
      planId: 'recovery-plan-1',
      chatSessionId: 'chat-recovery',
    });
    expect(fetch).toHaveBeenNthCalledWith(1,
      'http://127.0.0.1:4567/api/agent-run-capsules/capsule-1/recovery',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(2,
      'http://127.0.0.1:4567/api/agent/sessions/chat-recovery/turns',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'X-MindOS-Recovery-Plan-Id': 'recovery-plan-1',
        }),
      }),
    );
  });

  it('loads retrieval receipts and sends all four context-learning decisions through the shared contract', async () => {
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setAuthToken('secret-token');
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ receipts: [{
        id: 'receipt-1', queryPreview: 'launch', outcome: 'selected', startedAt: '2026-09-03T03:00:00.000Z',
        selections: [{ assetId: 'asset-1', path: 'launch.md', score: 1, reason: 'selected' }],
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ feedback: [{
        id: 'feedback-existing', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'helpful', status: 'active',
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, feedback: { id: 'feedback-1' } }), { status: 201 }));

    await expect(mindosClient.getRetrievalReceipts({ limit: 4 })).resolves.toEqual([
      expect.objectContaining({ id: 'receipt-1', selections: [expect.objectContaining({ assetId: 'asset-1' })] }),
    ]);
    await expect(mindosClient.getContextFeedback({ limit: 100 })).resolves.toEqual([
      expect.objectContaining({ id: 'feedback-existing', signal: 'helpful' }),
    ]);
    for (const signal of ['helpful', 'irrelevant', 'stale'] as const) {
      await mindosClient.submitContextFeedback({ receiptId: 'receipt-1', assetId: 'asset-1', signal });
    }
    await mindosClient.submitContextFeedback({ receiptId: 'receipt-1', signal: 'missing' });

    expect(vi.mocked(fetch).mock.calls.slice(2).map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { action: 'submit', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'helpful' },
      { action: 'submit', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'irrelevant' },
      { action: 'submit', receiptId: 'receipt-1', assetId: 'asset-1', signal: 'stale' },
      { action: 'submit', receiptId: 'receipt-1', signal: 'missing' },
    ]);
  });

  it('notifies connection observers for API success and connection failures only', async () => {
    const events: unknown[] = [];
    mindosClient.setBaseUrl('http://127.0.0.1:4567');
    mindosClient.setConnectionObserver((event) => events.push(event));

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tree: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'File already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('Server error', { status: 500 }));

    await mindosClient.getFileTree();
    await expect(mindosClient.createFile('note.md', '# Note\n')).resolves.toEqual({
      ok: false,
      error: 'exists',
    });
    await expect(mindosClient.search('hello')).rejects.toMatchObject({ status: 500 });

    expect(events).toMatchObject([
      { type: 'success', path: '/api/files' },
      { type: 'failure', path: '/api/search?q=hello', reason: 'api_unavailable', status: 500 },
    ]);
  });
});
