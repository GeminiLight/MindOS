/**
 * Runtime lane correctness contracts (wiki/specs/spec-runtime-lane-correctness.md):
 * the embedded Pi lane must record model errors as failed runs and release
 * the pi session after every turn; the native lane must cancel a run whose
 * client disconnected and never reattached, while keeping it alive for a
 * client that reattaches inside the grace window.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MindosNativeAgentTurnOptions } from '@geminilight/mindos/agent/runtime';
import type { MindosPiAgentTurnSessionOptions } from '@geminilight/mindos/agent/mindos-pi';
import { listAgentRuns, resetAgentRunsForTest } from '@geminilight/mindos/agent/ledger/run-ledger';
import { resetRuntimeDetectionCacheForTest } from '@geminilight/mindos/server';
import { resetNativeRuntimeDescriptorCacheForTest } from '@/lib/agent/native-runtime-descriptor-cache';

const mockDetectLocalAcpAgents = vi.hoisted(() => vi.fn());
const mockResolveCommandPath = vi.hoisted(() => vi.fn());
const mockResolveCommandPathCandidates = vi.hoisted(() => vi.fn());
const mockCheckNativeRuntimeHealth = vi.hoisted(() => vi.fn());
const mockRunMindosNativeAgentTurn = vi.hoisted(() => vi.fn());
const mockRunMindosPiAgentTurnSession = vi.hoisted(() => vi.fn());
const mockCreateMindosAgentRuntime = vi.hoisted(() => vi.fn());

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  resolveCommandPathCandidates: mockResolveCommandPathCandidates,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@geminilight/mindos/agent/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/agent/runtime')>();
  return {
    ...actual,
    buildAgentRuntimeEnv: vi.fn(() => ({ env: { PATH: '/usr/bin' }, overlay: {}, keys: [], injectedKeys: [], missingKeys: [] })),
    resolveAgentRuntimeEnvOverlay: vi.fn(() => ({ overlay: {}, keys: [], injectedKeys: [], missingKeys: [] })),
    runMindosNativeAgentTurn: mockRunMindosNativeAgentTurn,
  };
});

vi.mock('@geminilight/mindos/agent/mindos-pi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/agent/mindos-pi')>();
  return {
    ...actual,
    runMindosPiAgentTurnSession: mockRunMindosPiAgentTurnSession,
  };
});

vi.mock('@geminilight/mindos/agent/runtime/adapters/mindos', () => ({
  createMindosAgentRuntime: mockCreateMindosAgentRuntime,
}));

const originalGraceMs = process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS;

function agentTurnRequest(body: Record<string, unknown> & { chatSessionId: string }, init: { signal?: AbortSignal } = {}): NextRequest {
  return new NextRequest(`http://localhost/api/agent/sessions/${encodeURIComponent(body.chatSessionId)}/turns`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

async function POST(req: NextRequest, sessionId: string): Promise<Response> {
  const route = await import('../../app/api/agent/sessions/[sessionId]/turns/route');
  return route.POST(req, { params: Promise.resolve({ sessionId }) });
}

async function GET_REATTACH(chatSessionId: string, rootRunId: string, signal: AbortSignal): Promise<Response> {
  const route = await import('../../app/api/agent-runs/reattach/route');
  const params = new URLSearchParams({ chatSessionId, rootRunId });
  return route.GET(new Request(`http://localhost/api/agent-runs/reattach?${params.toString()}`, { signal }));
}

function createFakePiSession() {
  const unsubscribe = vi.fn();
  return {
    subscribe: vi.fn(() => unsubscribe),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(),
    abort: vi.fn(),
    dispose: vi.fn(),
    unsubscribe,
  };
}

function installFakePiRuntime(session: ReturnType<typeof createFakePiSession>) {
  mockCreateMindosAgentRuntime.mockImplementation(async (options: { systemPrompt: string }) => ({
    systemPrompt: options.systemPrompt,
    session,
    agentRunContextResource: {},
    llmHistoryMessages: [],
    lastUserContent: 'hello',
    lastUserImages: undefined,
    fallbackTools: [],
    apiKey: 'test-key',
    modelName: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    baseUrl: '',
    extensionLoadErrors: [],
  }));
}

function sseFrames(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => JSON.parse(frame.slice('data:'.length)) as Record<string, unknown>);
}

describe('runtime lane correctness', () => {
  beforeAll(async () => {
    // Warm both route modules: the disconnect-grace tests race a timer against
    // the reattach request, and a cold dynamic import under full-suite load
    // can take longer than the grace window.
    await import('../../app/api/agent/sessions/[sessionId]/turns/route');
    await import('../../app/api/agent-runs/reattach/route');
  });

  beforeEach(() => {
    mockDetectLocalAcpAgents.mockReset();
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockResolveCommandPath.mockReset();
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockResolveCommandPathCandidates.mockReset();
    mockResolveCommandPathCandidates.mockResolvedValue([]);
    mockCheckNativeRuntimeHealth.mockReset();
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockRunMindosNativeAgentTurn.mockReset();
    mockRunMindosPiAgentTurnSession.mockReset();
    mockCreateMindosAgentRuntime.mockReset();
    resetNativeRuntimeDescriptorCacheForTest();
    resetRuntimeDetectionCacheForTest();
    resetAgentRunsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalGraceMs === undefined) {
      delete process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS;
    } else {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = originalGraceMs;
    }
  });

  describe('embedded Pi lane terminal state', () => {
    it('records a model error reported by the Pi session as a failed run and disposes the session', async () => {
      const session = createFakePiSession();
      installFakePiRuntime(session);
      mockRunMindosPiAgentTurnSession.mockImplementation(async (options: MindosPiAgentTurnSessionOptions) => {
        options.send({ type: 'text_delta', delta: 'partial' });
        options.send({ type: 'error', message: 'model failed' });
        return { status: 'error', message: 'model failed', hasContent: true, lastModelError: 'model failed' };
      });

      const chatSessionId = 'chat-pi-model-error';
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'hello' }],
        chatSessionId,
      }), chatSessionId);
      expect(res.status).toBe(200);
      const frames = sseFrames(await res.text());

      expect(frames).toContainEqual({ type: 'error', message: 'model failed' });
      expect(frames.some((frame) => frame.type === 'done')).toBe(false);
      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        status: 'failed',
        error: 'model failed',
        outputSummary: 'partial',
        chatSessionId,
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('records a failed run when the Pi session streamed an error frame without a structured error result', async () => {
      const session = createFakePiSession();
      installFakePiRuntime(session);
      mockRunMindosPiAgentTurnSession.mockImplementation(async (options: MindosPiAgentTurnSessionOptions) => {
        options.send({ type: 'error', message: 'proxy fallback failed' });
        return { status: 'completed', hasContent: false, lastModelError: '' };
      });

      const chatSessionId = 'chat-pi-streamed-error';
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'hello' }],
        chatSessionId,
      }), chatSessionId);
      expect(res.status).toBe(200);
      await res.text();

      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        status: 'failed',
        error: 'proxy fallback failed',
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('completes the run and still disposes the session after a clean Pi turn', async () => {
      const session = createFakePiSession();
      installFakePiRuntime(session);
      mockRunMindosPiAgentTurnSession.mockImplementation(async (options: MindosPiAgentTurnSessionOptions) => {
        options.send({ type: 'text_delta', delta: 'mindos ok' });
        options.send({ type: 'done' });
        return { status: 'completed', hasContent: true, lastModelError: '' };
      });

      const chatSessionId = 'chat-pi-clean';
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'hello' }],
        chatSessionId,
      }), chatSessionId);
      expect(res.status).toBe(200);
      const frames = sseFrames(await res.text());

      expect(frames).toContainEqual({ type: 'done' });
      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        status: 'completed',
        outputSummary: 'mindos ok',
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('disposes the session even when the Pi turn throws', async () => {
      const session = createFakePiSession();
      installFakePiRuntime(session);
      mockRunMindosPiAgentTurnSession.mockRejectedValue(new Error('Invalid API key'));

      const chatSessionId = 'chat-pi-throw';
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'hello' }],
        chatSessionId,
      }), chatSessionId);
      expect(res.status).toBe(200);
      const frames = sseFrames(await res.text());

      expect(frames).toContainEqual({ type: 'error', message: 'Invalid API key' });
      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        status: 'failed',
        error: 'Invalid API key',
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);
  });

  describe('native lane client disconnect grace', () => {
    function installPendingNativeRuntime(captured: { options: MindosNativeAgentTurnOptions | null; finish?: () => void }) {
      mockRunMindosNativeAgentTurn.mockImplementation(async (options: MindosNativeAgentTurnOptions) => {
        captured.options = options;
        options.send({ type: 'text_delta', delta: 'still running' });
        return await new Promise((resolve) => {
          captured.finish = () => {
            options.send({ type: 'done' });
            resolve({ externalSessionId: 'thr-grace' });
          };
          options.signal?.addEventListener('abort', () => {
            resolve({ error: options.signal?.reason instanceof Error ? options.signal.reason : new Error('aborted'), externalSessionId: 'thr-grace' });
          }, { once: true });
        });
      });
    }

    it('cancels the native run when the client disconnects and never reattaches within the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '40';
      const captured: { options: MindosNativeAgentTurnOptions | null; finish?: () => void } = { options: null };
      installPendingNativeRuntime(captured);

      const chatSessionId = 'chat-disconnect-cancel';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'run then lose the client' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      expect(captured.options?.signal?.aborted).toBe(false);

      const startedAt = Date.now();
      requestAbort.abort();
      // Inside the grace window the runtime keeps going.
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(captured.options?.signal?.aborted).toBe(false);

      await res.text();
      expect(captured.options?.signal?.aborted).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(listAgentRuns({ kind: 'native-runtime' })[0]).toEqual(expect.objectContaining({
        status: 'canceled',
        chatSessionId,
        error: expect.stringContaining('did not reattach'),
        metadata: expect.objectContaining({ canceledBy: 'client-disconnect' }),
      }));
    }, 15_000);

    it('keeps the native run alive when a client reattaches inside the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '100';
      const captured: { options: MindosNativeAgentTurnOptions | null; finish?: () => void } = { options: null };
      installPendingNativeRuntime(captured);

      const chatSessionId = 'chat-disconnect-reattach';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'survive a dropped browser stream' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      const run = listAgentRuns({ kind: 'native-runtime' })[0]!;

      requestAbort.abort();
      const reattachAbort = new AbortController();
      const reattach = await GET_REATTACH(chatSessionId, run.id, reattachAbort.signal);
      expect(reattach.status).toBe(200);

      // Well past the grace window: the reattached client keeps the run alive.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(captured.options?.signal?.aborted).toBe(false);

      captured.finish?.();
      await res.text();
      await reattach.text();
      expect(listAgentRuns({ kind: 'native-runtime' })[0]).toEqual(expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'still running',
      }));
    }, 15_000);

    it('cancels after the last reattached client also disconnects', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '100';
      const captured: { options: MindosNativeAgentTurnOptions | null; finish?: () => void } = { options: null };
      installPendingNativeRuntime(captured);

      const chatSessionId = 'chat-disconnect-twice';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'lose both clients' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      const run = listAgentRuns({ kind: 'native-runtime' })[0]!;

      requestAbort.abort();
      const reattachAbort = new AbortController();
      const reattach = await GET_REATTACH(chatSessionId, run.id, reattachAbort.signal);
      expect(reattach.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(captured.options?.signal?.aborted).toBe(false);

      reattachAbort.abort();
      await res.text();
      expect(captured.options?.signal?.aborted).toBe(true);
      expect(listAgentRuns({ kind: 'native-runtime' })[0]).toEqual(expect.objectContaining({
        id: run.id,
        status: 'canceled',
        metadata: expect.objectContaining({ canceledBy: 'client-disconnect' }),
      }));
    }, 15_000);

    it('does not cancel a native run whose client stayed connected', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '20';
      const captured: { options: MindosNativeAgentTurnOptions | null; finish?: () => void } = { options: null };
      installPendingNativeRuntime(captured);

      const chatSessionId = 'chat-connected';
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'stay connected' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }), chatSessionId);
      expect(res.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(captured.options?.signal?.aborted).toBe(false);

      captured.finish?.();
      await res.text();
      expect(listAgentRuns({ kind: 'native-runtime' })[0]).toEqual(expect.objectContaining({ status: 'completed' }));
    }, 15_000);
  });

  describe('context omission is keyed on the runtime session', () => {
    const contextBody = {
      workDir: { source: 'manual', path: process.cwd(), label: 'web' },
      contextSelection: { version: 1, spaces: [], assistants: [] },
      permissionMode: 'read',
    };

    function installCompletingNativeRuntime(captured: { prompts: string[] }, result: { externalSessionId?: string; error?: Error } = { externalSessionId: 'thr_ctx' }) {
      mockRunMindosNativeAgentTurn.mockImplementation(async (options: MindosNativeAgentTurnOptions) => {
        captured.prompts.push(options.prompt);
        if (result.error) {
          options.send({ type: 'error', message: result.error.message });
          return result;
        }
        options.send({ type: 'text_delta', delta: 'ok' });
        options.send({ type: 'done' });
        return result;
      });
    }

    it('re-sends the session context after switching from the embedded Pi runtime to Codex', async () => {
      const session = createFakePiSession();
      installFakePiRuntime(session);
      let piPrompt = '';
      mockCreateMindosAgentRuntime.mockImplementation(async (options: { systemPrompt: string; turnPrompt?: string }) => {
        piPrompt = options.turnPrompt ?? '';
        return {
          systemPrompt: options.systemPrompt,
          session,
          agentRunContextResource: {},
          llmHistoryMessages: [],
          lastUserContent: 'first on pi',
          lastUserImages: undefined,
          fallbackTools: [],
          apiKey: 'test-key',
          modelName: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          baseUrl: '',
          extensionLoadErrors: [],
          runtimeSession: { externalSessionId: 'pi-session-1', resumed: false },
        };
      });
      mockRunMindosPiAgentTurnSession.mockImplementation(async (options: MindosPiAgentTurnSessionOptions) => {
        options.send({ type: 'done' });
        return { status: 'completed', hasContent: true, lastModelError: '' };
      });
      const chatSessionId = 'chat-context-switch';

      const first = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'first on pi' }],
        chatSessionId,
      }), chatSessionId);
      expect(first.status).toBe(200);
      await first.text();
      expect(piPrompt).toContain('## Session Context');
      expect(listAgentRuns({ kind: 'mindos-main' })[0]?.metadata?.sessionContextInjected).toBe(true);

      const captured = { prompts: [] as string[] };
      installCompletingNativeRuntime(captured);
      const second = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'first on pi' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'now on codex' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }), chatSessionId);
      expect(second.status).toBe(200);
      await second.text();

      expect(captured.prompts[0]).toContain('## Session Context');
      expect(listAgentRuns({ kind: 'native-runtime' })[0]?.metadata?.sessionContextInjected).toBe(true);
    }, 15_000);

    it('re-sends the session context when the previous run on the same runtime failed', async () => {
      const chatSessionId = 'chat-context-failed';
      const captured = { prompts: [] as string[] };
      installCompletingNativeRuntime(captured, { error: new Error('spawn failed'), externalSessionId: 'thr_ctx' });

      const first = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'first turn' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }), chatSessionId);
      expect(first.status).toBe(200);
      await first.text();
      expect(listAgentRuns({ kind: 'native-runtime' })[0]).toEqual(expect.objectContaining({ status: 'failed' }));

      installCompletingNativeRuntime(captured);
      const second = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'second turn' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        runtimeBinding: { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', externalSessionId: 'thr_ctx', status: 'active', updatedAt: Date.now() },
        chatSessionId,
      }), chatSessionId);
      expect(second.status).toBe(200);
      await second.text();

      expect(captured.prompts).toHaveLength(2);
      expect(captured.prompts[1]).toContain('## Session Context');
      expect(listAgentRuns({ kind: 'native-runtime' })[0]?.metadata?.sessionContextInjected).toBe(true);
    }, 15_000);

    it('omits the session context only for a completed run on the same runtime session', async () => {
      const chatSessionId = 'chat-context-same';
      const captured = { prompts: [] as string[] };
      installCompletingNativeRuntime(captured);
      const binding = { kind: 'codex-thread', runtime: 'codex', runtimeId: 'codex', externalSessionId: 'thr_ctx', status: 'active', updatedAt: Date.now() };

      const first = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'first turn' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }), chatSessionId);
      await first.text();

      const sameSession = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'second turn' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        runtimeBinding: binding,
        chatSessionId,
      }), chatSessionId);
      await sameSession.text();
      expect(captured.prompts[1]).not.toContain('## Session Context');
      expect(listAgentRuns({ kind: 'native-runtime' })[0]?.metadata?.sessionContextInjected).toBe(false);

      // A fresh Codex thread (no binding) never saw the context.
      const freshThread = await POST(agentTurnRequest({
        ...contextBody,
        messages: [{ role: 'user', content: 'third turn' }],
        selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        chatSessionId,
      }), chatSessionId);
      await freshThread.text();
      expect(captured.prompts[2]).toContain('## Session Context');
    }, 15_000);
  });
});
