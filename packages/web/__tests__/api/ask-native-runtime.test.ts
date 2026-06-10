import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { seedFile } from '../setup';
import { invalidateCache } from '../../lib/fs';
import type { MindosAgentRuntimeAskOptions } from '@geminilight/mindos/agent-runtime';
import type { AgentRuntimeDescriptor } from '@geminilight/mindos/server';
import { listAgentRuns, resetAgentRunsForTest } from '@/lib/agent/run-ledger';
import {
  rememberAvailableNativeRuntimeDescriptor,
  resetNativeRuntimeDescriptorCacheForTest,
} from '@/lib/agent/native-runtime-descriptor-cache';

let capturedNativeOptions: MindosAgentRuntimeAskOptions | null = null;
let capturedAcpOptions: Record<string, any> | null = null;
const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();
const mockRunMindosAgentRuntimeAskSession = vi.fn();
const mockRunMindosAcpAskSession = vi.fn();
const mockCreateAcpSession = vi.fn();
const originalAgentTimeoutMs = process.env.MINDOS_AGENT_TIMEOUT_MS;

function availableNativeDescriptor(
  input: Pick<AgentRuntimeDescriptor, 'id' | 'name' | 'kind' | 'adapter'> & { binaryPath: string },
): AgentRuntimeDescriptor {
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    adapter: input.adapter,
    modelOwner: 'external',
    authOwner: 'external',
    permissionOwner: 'external',
    sessionOwner: 'external',
    status: 'available',
    binaryPath: input.binaryPath,
    capabilities: {
      ownsModelSelection: true,
      supportsResume: true,
      supportsFreshSession: true,
      supportsListSessions: input.kind === 'codex',
      supportsAttachExisting: input.kind === 'codex',
      supportsFork: input.kind === 'codex',
      supportsArchive: input.kind === 'codex',
      supportsInterrupt: true,
      supportsModelList: false,
      supportsApprovals: true,
      supportsUserInput: true,
      supportsToolEvents: true,
      supportsRuntimeStatus: true,
      supportsDiffs: false,
      supportsCheckpoints: false,
      supportsBackgroundRuns: false,
      supportsMcpConfig: input.kind === 'claude',
    },
    availability: {
      checkedAt: '2026-06-10T00:00:00.000Z',
      sources: ['native-health'],
    },
  };
}

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@geminilight/mindos/agent-runtime', () => ({
  buildAgentRuntimeEnv: vi.fn((input?: { settings?: { keys?: string[] } }) => ({
    env: {
      PATH: '/usr/bin',
      ...(input?.settings?.keys?.includes('CLAUDE_CODE_OAUTH_TOKEN')
        ? { CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' }
        : {}),
    },
    overlay: input?.settings?.keys?.includes('CLAUDE_CODE_OAUTH_TOKEN')
      ? { CLAUDE_CODE_OAUTH_TOKEN: 'runtime-token' }
      : {},
    keys: input?.settings?.keys ?? [],
    injectedKeys: input?.settings?.keys ?? [],
    missingKeys: [],
  })),
  resolveAgentRuntimeEnvOverlay: vi.fn((input?: { settings?: { keys?: string[] } }) => ({
    overlay: input?.settings?.keys?.includes('GEMINI_API_KEY')
      ? { GEMINI_API_KEY: 'runtime-gemini' }
      : {},
    keys: input?.settings?.keys ?? [],
    injectedKeys: input?.settings?.keys ?? [],
    missingKeys: [],
  })),
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
    resetNativeRuntimeDescriptorCacheForTest();
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
    if (originalAgentTimeoutMs === undefined) {
      delete process.env.MINDOS_AGENT_TIMEOUT_MS;
    } else {
      process.env.MINDOS_AGENT_TIMEOUT_MS = originalAgentTimeoutMs;
    }
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
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' },
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
      binaryPath: '/usr/local/bin/codex',
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
  }, 15_000);

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

  it('uses the server-detected native runtime path instead of trusting the request body', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
      mode: 'agent',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    });
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
      binaryPath: '/usr/local/bin/codex',
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
      binaryPath: '/usr/local/bin/codex',
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

  it('uses the last server-verified native runtime path when the forced availability recheck hangs', async () => {
    vi.useFakeTimers();
    rememberAvailableNativeRuntimeDescriptor(availableNativeDescriptor({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      adapter: 'codex-app-server',
      binaryPath: '/opt/homebrew/bin/codex',
    }));
    mockResolveCommandPath.mockImplementation(async () => new Promise(() => {}));
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const responsePromise = POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex even if detection is slow' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
      mode: 'agent',
    }));

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(1500);
    const res = await responsePromise;
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('native ok');
    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/opt/homebrew/bin/codex',
    });
  });

  it('rejects Codex instead of launching without a server-verified path when recheck hangs', async () => {
    vi.useFakeTimers();
    mockResolveCommandPath.mockImplementation(async () => new Promise(() => {}));
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const responsePromise = POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex while detection is slow' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
      mode: 'agent',
    }));

    await vi.advanceTimersByTimeAsync(3000);
    const res = await responsePromise;
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Codex is still being verified. Please retry in a moment.' },
    });
    expect(capturedNativeOptions).toBeNull();
    expect(mockRunMindosAgentRuntimeAskSession).not.toHaveBeenCalled();
  });

  it('uses the bundled Claude SDK path when Claude verification hangs without a cached CLI path', async () => {
    vi.useFakeTimers();
    mockResolveCommandPath.mockImplementation(async () => new Promise(() => {}));
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const responsePromise = POST(askRequest({
      messages: [{ role: 'user', content: 'Use Claude Code even if detection is slow' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude', binaryPath: '/tmp/fake-claude' },
      mode: 'agent',
    }));

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(1500);
    const res = await responsePromise;
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('native ok');
    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      binaryPath: 'sdk:@anthropic-ai/claude-agent-sdk',
    });
  });

  it('resolves a real Claude CLI path before launching when runtime health returned the SDK sentinel', async () => {
    let resolveCalls = 0;
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command !== 'claude') return null;
      resolveCalls += 1;
      if (resolveCalls === 1) {
        return await new Promise<string>((resolve) => setTimeout(() => resolve('/usr/local/bin/claude'), 50));
      }
      return '/usr/local/bin/claude';
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude', binaryPath: '/tmp/fake-claude' },
      mode: 'agent',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      binaryPath: '/usr/local/bin/claude',
    });
  });

  it('passes the configured agent timeout to native runtimes', async () => {
    process.env.MINDOS_AGENT_TIMEOUT_MS = '1234';
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Codex with timeout' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      mode: 'agent',
    }));
    await res.text();

    expect(res.status).toBe(200);
    expect(capturedNativeOptions?.timeoutMs).toBe(1234);
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

  it('records native runtime timeout results as timed out ledger runs', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    const timeoutError = Object.assign(new Error('Native runtime timed out after 1s.'), { code: 'TIMEOUT' });
    mockRunMindosAgentRuntimeAskSession.mockImplementationOnce(async (options: MindosAgentRuntimeAskOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'partial native output' });
      return { error: timeoutError, externalSessionId: 'claude-timeout' };
    });

    const { POST } = await import('../../app/api/ask/route');
    const res = await POST(askRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      mode: 'agent',
      chatSessionId: 'chat-native-timeout',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('partial native output');
    expect(listAgentRuns({ kind: 'native-runtime' })).toEqual([
      expect.objectContaining({
        agentKind: 'native-runtime',
        runtimeId: 'claude',
        displayName: 'Claude Code',
        status: 'timed_out',
        chatSessionId: 'chat-native-timeout',
        error: 'Native runtime timed out after 1s.',
        metadata: expect.objectContaining({
          runtimeKind: 'claude',
          externalSessionId: 'claude-timeout',
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
