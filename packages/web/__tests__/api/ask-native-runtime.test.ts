import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { invalidateCache } from '../../lib/fs';
import type { MindosAgentRuntimeAskOptions } from '@geminilight/mindos/agent-runtime';
import { listAgentRuns, resetAgentRunsForTest } from '@/lib/agent/run-ledger';

let capturedNativeOptions: MindosAgentRuntimeAskOptions | null = null;
let capturedAcpOptions: Record<string, any> | null = null;
const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();
const mockRunMindosAgentRuntimeAskSession = vi.fn();
const mockRunMindosAcpAskSession = vi.fn();
const mockCreateAcpSession = vi.fn();

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@geminilight/mindos/agent-runtime', () => ({
  runMindosAgentRuntimeAskSession: mockRunMindosAgentRuntimeAskSession,
}));

vi.mock('@geminilight/mindos/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/session')>();
  return {
    ...actual,
    runMindosAcpAskSession: mockRunMindosAcpAskSession,
  };
});

vi.mock('@/lib/acp/session', () => ({
  createSession: mockCreateAcpSession,
  promptStream: vi.fn(),
  cancelPrompt: vi.fn(),
  closeSession: vi.fn(),
}));

vi.mock('@geminilight/mindos/session/pi-coding-agent', () => ({
  createMindosPiCodingAgentRuntime: vi.fn(() => {
    throw new Error('pi runtime should not initialize for native runtime requests');
  }),
}));

function askRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ask', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/ask native runtime routing', () => {
  beforeEach(() => {
    capturedNativeOptions = null;
    capturedAcpOptions = null;
    mockDetectLocalAcpAgents.mockReset();
    mockResolveCommandPath.mockReset();
    mockCheckNativeRuntimeHealth.mockReset();
    mockRunMindosAgentRuntimeAskSession.mockReset();
    mockRunMindosAcpAskSession.mockReset();
    mockCreateAcpSession.mockReset();
    mockCreateAcpSession.mockResolvedValue({ id: 'acp-session-1' });
    mockRunMindosAgentRuntimeAskSession.mockImplementation(async (options: MindosAgentRuntimeAskOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'native ok' });
      options.send({ type: 'done' });
      return { externalSessionId: 'thr_123' };
    });
    mockRunMindosAcpAskSession.mockImplementation(async (options: {
      agentId: string;
      send: (event: { type: string; delta?: string }) => void;
    }) => {
      capturedAcpOptions = options;
      options.send({ type: 'text_delta', delta: 'acp ok' });
      options.send({ type: 'done' });
      return {};
    });
    resetAgentRunsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes Codex before MindOS pi runtime initialization and bridges MindOS context', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
      ],
      notInstalled: [],
    });
    seedFile('current.md', '# Current\nCurrent file body');
    seedFile('attached.md', '# Attached\nAttached file body');
    invalidateCache();

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use the attached context' }],
      currentFile: 'current.md',
      attachedFiles: ['attached.md'],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_existing',
        status: 'active',
        updatedAt: 1,
      },
      providerOverride: 'anthropic',
      modelOverride: 'claude-test',
      mode: 'agent',
      chatSessionId: 'chat-native-1',
    }));

    expect(res.status).toBe(200);
    const text = await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      externalSessionId: 'thr_existing',
    });
    expect(capturedNativeOptions?.permissionMode).toBe('agent');
    expect(capturedNativeOptions?.prompt).toContain('MindOS Turn Context');
    expect(capturedNativeOptions?.prompt).toContain('Use the attached context');
    expect(capturedNativeOptions?.prompt).toContain('current.md');
    expect(capturedNativeOptions?.prompt).toContain('Current file body');
    expect(capturedNativeOptions?.prompt).toContain('attached.md');
    expect(capturedNativeOptions?.prompt).toContain('Attached file body');
    expect(capturedNativeOptions?.prompt).not.toContain('claude-test');
    expect(mockDetectLocalAcpAgents).not.toHaveBeenCalled();
    expect(mockResolveCommandPath).toHaveBeenCalledWith('codex');
    expect(mockResolveCommandPath).not.toHaveBeenCalledWith('claude');
    const nativeRuns = listAgentRuns({ kind: 'native-runtime' });
    expect(nativeRuns).toEqual([
      expect.objectContaining({
        agentKind: 'native-runtime',
        runtimeId: 'codex',
        displayName: 'Codex',
        status: 'completed',
        chatSessionId: 'chat-native-1',
        permissionMode: 'agent',
        outputSummary: 'native ok',
        metadata: expect.objectContaining({
          runtimeKind: 'codex',
          externalSessionId: 'thr_123',
        }),
      }),
    ]);
    expect(nativeRuns[0]?.rootRunId).toBe(nativeRuns[0]?.id);
    expect(text).toContain('"type":"agent_run_context"');
    expect(text).toContain(`"rootRunId":"${nativeRuns[0]?.id}"`);
  });

  it('maps Chat mode native runtime requests to readonly permission mode', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Read the workspace only' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      mode: 'chat',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime.kind).toBe('claude');
    expect(capturedNativeOptions?.permissionMode).toBe('readonly');
  });

  it('maps organize mode native runtime requests to readonly permission mode', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Organize without granting full harness writes' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      mode: 'organize',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime.kind).toBe('codex');
    expect(capturedNativeOptions?.permissionMode).toBe('readonly');
  });

  it('does not resume a native runtime when the matching session binding is non-active', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Start fresh if old thread failed' }],
      selectedRuntime: {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
        externalSessionId: 'thr_stale',
      },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_stale',
        status: 'failed',
        updatedAt: 1,
      },
      mode: 'agent',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    });
  });

  it('does not resume selectedRuntime.externalSessionId when a typed binding is present but mismatched', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Do not resume a mismatched thread' }],
      selectedRuntime: {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
        externalSessionId: 'thr_from_legacy_field',
      },
      runtimeBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'claude_session',
        status: 'active',
        updatedAt: 1,
      },
      mode: 'agent',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
    });
  });

  it('rejects a native runtime request when forced availability recheck reports it unavailable', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockImplementation(async ({ runtime }) => (
      runtime === 'codex'
        ? { status: 'signed-out', reason: 'Run codex login first.' }
        : { status: 'error', reason: 'not checked' }
    ));
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        {
          id: 'codex-acp',
          name: 'Codex',
          binaryPath: '/usr/local/bin/codex',
          status: 'signed-out',
          reason: 'Run codex login first.',
        },
      ],
      notInstalled: [],
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      mode: 'agent',
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Codex is signed out. Run codex login first.' },
    });
    expect(capturedNativeOptions).toBeNull();
  });

  it('does not block native runtime send when the forced availability recheck hangs', async () => {
    vi.useFakeTimers();
    mockResolveCommandPath.mockImplementation(async () => new Promise(() => {}));
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const responsePromise = POST(askRequest({
      messages: [{ role: 'user', content: 'Use Claude Code even if detection is slow' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      mode: 'agent',
    }));

    await vi.advanceTimersByTimeAsync(3000);
    const res = await responsePromise;
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('native ok');
    expect(capturedNativeOptions?.runtime.kind).toBe('claude');
  });

  it('returns a structured SSE error if the native runtime runner throws', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockRunMindosAgentRuntimeAskSession.mockImplementationOnce(async (options: MindosAgentRuntimeAskOptions) => {
      capturedNativeOptions = options;
      throw new Error('native bridge exploded');
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      mode: 'agent',
      chatSessionId: 'chat-native-throw',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('"type":"error"');
    expect(text).toContain('native bridge exploded');
    expect(capturedNativeOptions?.runtime.kind).toBe('claude');
    expect(listAgentRuns({ kind: 'native-runtime' })).toEqual([
      expect.objectContaining({
        agentKind: 'native-runtime',
        runtimeId: 'claude',
        displayName: 'Claude Code',
        status: 'failed',
        chatSessionId: 'chat-native-throw',
        permissionMode: 'agent',
        error: 'native bridge exploded',
      }),
    ]);
  });

  it('records returned native runtime errors as failed ledger runs', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockRunMindosAgentRuntimeAskSession.mockImplementationOnce(async (options: MindosAgentRuntimeAskOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'partial native output' });
      return { error: new Error('native runtime returned failure'), externalSessionId: 'thr_failed' };
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      mode: 'agent',
      chatSessionId: 'chat-native-error',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('partial native output');
    expect(capturedNativeOptions?.runtime.kind).toBe('codex');
    expect(listAgentRuns({ kind: 'native-runtime' })).toEqual([
      expect.objectContaining({
        agentKind: 'native-runtime',
        runtimeId: 'codex',
        displayName: 'Codex',
        status: 'failed',
        chatSessionId: 'chat-native-error',
        permissionMode: 'agent',
        outputSummary: 'partial native output',
        error: 'native runtime returned failure',
        metadata: expect.objectContaining({
          runtimeKind: 'codex',
          externalSessionId: 'thr_failed',
        }),
      }),
    ]);
  });

  it('falls back to the legacy ACP selection when selectedRuntime is malformed', async () => {
    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use the selected ACP agent' }],
      selectedRuntime: { id: 'broken-runtime' },
      selectedAcpAgent: { id: 'legacy-acp', name: 'Legacy ACP' },
      mode: 'agent',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('acp ok');
    expect(capturedAcpOptions?.agentId).toBe('legacy-acp');
    expect(capturedNativeOptions).toBeNull();
    const acpRuns = listAgentRuns({ kind: 'acp' });
    expect(acpRuns).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'legacy-acp',
        displayName: 'Legacy ACP',
        status: 'completed',
        permissionMode: 'agent',
        outputSummary: 'acp ok',
        metadata: expect.objectContaining({
          source: 'selected-acp-runtime',
        }),
      }),
    ]);
  });

  it('maps selected ACP runtime in organize mode to readonly session permission', async () => {
    mockRunMindosAcpAskSession.mockImplementationOnce(async (options: Record<string, any>) => {
      capturedAcpOptions = options;
      await options.createSession(options.agentId, { cwd: '/tmp/mindos-test' });
      options.send({ type: 'text_delta', delta: 'acp organize ok' });
      options.send({ type: 'done' });
      return {};
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Organize through ACP safely' }],
      selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
      mode: 'organize',
      chatSessionId: 'chat-acp-1',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('acp organize ok');
    expect(capturedAcpOptions?.agentId).toBe('gemini');
    expect(mockCreateAcpSession).toHaveBeenCalledWith('gemini', expect.objectContaining({
      cwd: '/tmp/mindos-test',
      permissionMode: 'readonly',
    }));
    const acpRuns = listAgentRuns({ kind: 'acp' });
    expect(acpRuns).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'gemini',
        displayName: 'Gemini ACP',
        status: 'completed',
        chatSessionId: 'chat-acp-1',
        permissionMode: 'readonly',
        outputSummary: 'acp organize ok',
      }),
    ]);
    expect(acpRuns[0]?.rootRunId).toBe(acpRuns[0]?.id);
    expect(text).toContain('"type":"agent_run_context"');
    expect(text).toContain(`"rootRunId":"${acpRuns[0]?.id}"`);
  });

  it('records selected ACP streaming runtime failures in the run ledger', async () => {
    mockRunMindosAcpAskSession.mockImplementationOnce(async (options: {
      agentId: string;
      send: (event: { type: string; delta?: string }) => void;
    }) => {
      capturedAcpOptions = options;
      options.send({ type: 'text_delta', delta: 'partial acp output' });
      return { error: new Error('acp crashed') };
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use the selected ACP agent' }],
      selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
      mode: 'chat',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('partial acp output');
    expect(listAgentRuns({ kind: 'acp' })).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'gemini',
        displayName: 'Gemini ACP',
        status: 'failed',
        permissionMode: 'readonly',
        outputSummary: 'partial acp output',
        error: 'acp crashed',
      }),
    ]);
  });
});
