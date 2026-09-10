/**
 * Client-presence disconnect grace across ALL turn lanes
 * (spec-runtime-lane-contract wave-4 follow-up, task item 2): Pi and ACP used
 * to cancel on requestSignal abort directly; they now ride the same presence
 * model as the native lane — a dropped SSE stream stays reattachable, and the
 * run is canceled only after the grace window passed with no client.
 *
 * The native-lane contracts live in agent-turn-lane-correctness.test.ts
 * (unchanged); this file extends the same matrix to the Pi and ACP lanes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MindosPiAgentTurnSessionOptions } from '@geminilight/mindos/agent/mindos-pi';
import { listAgentRuns, resetAgentRunsForTest } from '@geminilight/mindos/agent/ledger/run-ledger';
import { resetRuntimeDetectionCacheForTest } from '@geminilight/mindos/server';
import { resetNativeRuntimeDescriptorCacheForTest } from '@/lib/agent/native-runtime-descriptor-cache';

const mockDetectLocalAcpAgents = vi.hoisted(() => vi.fn());
const mockResolveCommandPath = vi.hoisted(() => vi.fn());
const mockResolveCommandPathCandidates = vi.hoisted(() => vi.fn());
const mockCheckNativeRuntimeHealth = vi.hoisted(() => vi.fn());
const mockRunMindosAcpAgentTurn = vi.hoisted(() => vi.fn());
const mockRunMindosPiAgentTurnSession = vi.hoisted(() => vi.fn());
const mockCreateMindosAgentRuntime = vi.hoisted(() => vi.fn());
const mockCreateAcpSession = vi.hoisted(() => vi.fn());
const mockLoadAcpSession = vi.hoisted(() => vi.fn());
const mockSetAcpMode = vi.hoisted(() => vi.fn());
const mockSetAcpConfigOption = vi.hoisted(() => vi.fn());
const mockCancelAcpPrompt = vi.hoisted(() => vi.fn());
const mockCloseAcpSession = vi.hoisted(() => vi.fn());
const mockPromptAcpStream = vi.hoisted(() => vi.fn());

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
  };
});

vi.mock('@geminilight/mindos/agent/turn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/agent/turn')>();
  return {
    ...actual,
    runMindosAcpAgentTurn: mockRunMindosAcpAgentTurn,
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

vi.mock('@/lib/acp/session', () => ({
  createSession: mockCreateAcpSession,
  loadSession: mockLoadAcpSession,
  promptStream: mockPromptAcpStream,
  cancelPrompt: mockCancelAcpPrompt,
  closeSession: mockCloseAcpSession,
  setConfigOption: mockSetAcpConfigOption,
  setMode: mockSetAcpMode,
}));

const originalGraceMs = process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS;

function agentTurnRequest(
  body: Record<string, unknown> & { chatSessionId: string },
  init: { signal?: AbortSignal } = {},
): NextRequest {
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

describe('runtime lane disconnect grace (Pi / ACP)', () => {
  beforeAll(async () => {
    // Warm both route modules: the grace tests race a timer against the
    // reattach request, and a cold dynamic import under full-suite load can
    // take longer than the grace window.
    await import('../../app/api/agent/sessions/[sessionId]/turns/route');
    await import('../../app/api/agent-runs/reattach/route');
  });

  beforeEach(() => {
    mockDetectLocalAcpAgents.mockReset();
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockResolveCommandPath.mockReset();
    mockResolveCommandPath.mockImplementation(async () => null);
    mockResolveCommandPathCandidates.mockReset();
    mockResolveCommandPathCandidates.mockResolvedValue([]);
    mockCheckNativeRuntimeHealth.mockReset();
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockRunMindosAcpAgentTurn.mockReset();
    mockRunMindosPiAgentTurnSession.mockReset();
    mockCreateMindosAgentRuntime.mockReset();
    mockCreateAcpSession.mockReset();
    mockCreateAcpSession.mockImplementation(async () => ({ id: 'acp-session-grace' }));
    mockLoadAcpSession.mockReset();
    mockPromptAcpStream.mockReset();
    mockCancelAcpPrompt.mockReset();
    mockCloseAcpSession.mockReset();
    mockCloseAcpSession.mockResolvedValue(undefined);
    mockSetAcpMode.mockReset();
    mockSetAcpConfigOption.mockReset();
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

  describe('embedded Pi lane', () => {
    function installPendingPiSession(captured: { options: MindosPiAgentTurnSessionOptions | null; finish?: () => void }) {
      mockRunMindosPiAgentTurnSession.mockImplementation(async (options: MindosPiAgentTurnSessionOptions) => {
        captured.options = options;
        options.send({ type: 'text_delta', delta: 'pi still running' });
        return await new Promise((resolve) => {
          captured.finish = () => {
            options.send({ type: 'done' });
            resolve({ status: 'completed', hasContent: true, lastModelError: '' });
          };
          options.signal?.addEventListener('abort', () => {
            const reason = options.signal?.reason;
            resolve({
              status: 'error',
              message: reason instanceof Error ? reason.message : 'aborted',
              hasContent: true,
              lastModelError: '',
            });
          }, { once: true });
        });
      });
    }

    it('cancels the Pi run when the client disconnects and never reattaches within the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '40';
      const session = createFakePiSession();
      installFakePiRuntime(session);
      const captured: { options: MindosPiAgentTurnSessionOptions | null; finish?: () => void } = { options: null };
      installPendingPiSession(captured);

      const chatSessionId = 'chat-pi-disconnect-cancel';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'run then lose the client' }],
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      expect(captured.options?.signal?.aborted).toBe(false);

      requestAbort.abort();
      // Inside the grace window the Pi session keeps going.
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(captured.options?.signal?.aborted).toBe(false);

      await res.text();
      expect(captured.options?.signal?.aborted).toBe(true);
      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        status: 'canceled',
        chatSessionId,
        error: expect.stringContaining('did not reattach'),
        metadata: expect.objectContaining({ canceledBy: 'client-disconnect' }),
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);

    it('keeps the Pi run alive when a client reattaches inside the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '100';
      const session = createFakePiSession();
      installFakePiRuntime(session);
      const captured: { options: MindosPiAgentTurnSessionOptions | null; finish?: () => void } = { options: null };
      installPendingPiSession(captured);

      const chatSessionId = 'chat-pi-disconnect-reattach';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'survive a dropped browser stream' }],
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      const run = listAgentRuns({ kind: 'mindos-main' })[0]!;

      requestAbort.abort();
      const reattachAbort = new AbortController();
      const reattach = await GET_REATTACH(chatSessionId, run.id, reattachAbort.signal);
      expect(reattach.status).toBe(200);

      // Well past the grace window: the reattached client keeps the run alive.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(captured.options?.signal?.aborted).toBe(false);

      captured.finish?.();
      await res.text();
      await reattach.text();
      expect(listAgentRuns({ kind: 'mindos-main' })[0]).toEqual(expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'pi still running',
      }));
      expect(session.dispose).toHaveBeenCalledTimes(1);
    }, 15_000);
  });

  describe('ACP lane', () => {
    function installPendingAcpTurn(captured: { options: Record<string, any> | null; finish?: () => void }) {
      mockRunMindosAcpAgentTurn.mockImplementation(async (options: Record<string, any>) => {
        captured.options = options;
        options.send({ type: 'text_delta', delta: 'acp still running' });
        return await new Promise((resolve) => {
          captured.finish = () => {
            options.send({ type: 'done' });
            resolve({});
          };
          options.signal?.addEventListener('abort', () => {
            const reason = options.signal?.reason;
            resolve({ error: reason instanceof Error ? reason : new Error('aborted') });
          }, { once: true });
        });
      });
    }

    it('cancels the ACP run when the client disconnects and never reattaches within the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '40';
      const captured: { options: Record<string, any> | null; finish?: () => void } = { options: null };
      installPendingAcpTurn(captured);

      const chatSessionId = 'chat-acp-disconnect-cancel';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'run then lose the client' }],
        selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      expect(captured.options?.signal?.aborted).toBe(false);

      requestAbort.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(captured.options?.signal?.aborted).toBe(false);

      await res.text();
      expect(captured.options?.signal?.aborted).toBe(true);
      expect(listAgentRuns({ kind: 'acp' })[0]).toEqual(expect.objectContaining({
        status: 'canceled',
        chatSessionId,
        error: expect.stringContaining('did not reattach'),
        metadata: expect.objectContaining({ canceledBy: 'client-disconnect' }),
      }));
    }, 15_000);

    it('keeps the ACP run alive when a client reattaches inside the grace window', async () => {
      process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS = '100';
      const captured: { options: Record<string, any> | null; finish?: () => void } = { options: null };
      installPendingAcpTurn(captured);

      const chatSessionId = 'chat-acp-disconnect-reattach';
      const requestAbort = new AbortController();
      const res = await POST(agentTurnRequest({
        messages: [{ role: 'user', content: 'survive a dropped browser stream' }],
        selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
        chatSessionId,
      }, { signal: requestAbort.signal }), chatSessionId);
      expect(res.status).toBe(200);
      const run = listAgentRuns({ kind: 'acp' })[0]!;

      requestAbort.abort();
      const reattachAbort = new AbortController();
      const reattach = await GET_REATTACH(chatSessionId, run.id, reattachAbort.signal);
      expect(reattach.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(captured.options?.signal?.aborted).toBe(false);

      captured.finish?.();
      await res.text();
      await reattach.text();
      expect(listAgentRuns({ kind: 'acp' })[0]).toEqual(expect.objectContaining({
        id: run.id,
        status: 'completed',
        outputSummary: 'acp still running',
      }));
    }, 15_000);
  });
});
