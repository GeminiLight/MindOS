import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestMindRoot, seedFile } from '../setup';
import { invalidateCache } from '../../lib/fs';
import { realpathSync } from 'node:fs';
import type { MindosNativeAgentTurnOptions } from '@geminilight/mindos/agent/runtime';
import type { AgentRuntimeDescriptor } from '@geminilight/mindos/server';
import { listAgentEvents, listAgentRuns, resetAgentRunsForTest, startAgentRun } from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  rememberAvailableNativeRuntimeDescriptor,
  resetNativeRuntimeDescriptorCacheForTest,
} from '@/lib/agent/native-runtime-descriptor-cache';

let capturedNativeOptions: MindosNativeAgentTurnOptions | null = null;
let capturedAcpOptions: Record<string, any> | null = null;
let capturedMindosRuntimeOptions: Record<string, any> | null = null;
const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockResolveCommandPathCandidates = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();
const mockRunMindosNativeAgentTurn = vi.fn();
const mockRunMindosAcpAgentTurn = vi.fn();
const mockRunMindosPiAgentTurnSession = vi.fn();
const mockCreateAcpSession = vi.fn();
const mockCreateMindosAgentRuntime = vi.fn();
const originalAgentTimeoutMs = process.env.MINDOS_AGENT_TIMEOUT_MS;
const TEST_SESSION_ID = 'test-session';
const RAW_CODEX_OPTIONAL_DEPENDENCY_STACK = [
  'file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102',
  'throw new Error(`^ Error: Missing optional dependency @openai/codex-darwin-x64. Reinstall Codex: npm install -g @openai/codex@latest',
  'at findCodexExecutable (file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102:9)',
  'at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
  'at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)',
  'Node.js v22.16.0',
].join('\n');

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
  resolveCommandPathCandidates: mockResolveCommandPathCandidates,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@geminilight/mindos/agent/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/agent/runtime')>();
  return {
    ...actual,
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
    runMindosNativeAgentTurn: mockRunMindosNativeAgentTurn,
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

vi.mock('@/lib/acp/session', () => ({
  createSession: mockCreateAcpSession,
  promptStream: vi.fn(),
  cancelPrompt: vi.fn(),
  closeSession: vi.fn(),
}));

vi.mock('@geminilight/mindos/agent/runtime/adapters/mindos', () => ({
  createMindosAgentRuntime: mockCreateMindosAgentRuntime,
}));

function agentTurnRequest(body: unknown, sessionId = sessionIdFromBody(body)): NextRequest {
  return new NextRequest(`http://localhost/api/agent/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function POST(req: NextRequest): Promise<Response> {
  const route = await import('../../app/api/agent/sessions/[sessionId]/turns/route');
  return route.POST(req, { params: Promise.resolve({ sessionId: sessionIdFromRequest(req) }) });
}

function sessionIdFromBody(body: unknown): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const sessionId = (body as { chatSessionId?: unknown }).chatSessionId;
    if (typeof sessionId === 'string' && sessionId.trim()) return sessionId;
  }
  return TEST_SESSION_ID;
}

function sessionIdFromRequest(req: NextRequest): string {
  const pathname = new URL(req.url).pathname;
  const match = /^\/api\/agent\/sessions\/([^/]+)\/turns$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : TEST_SESSION_ID;
}

describe('/api/agent/sessions/:sessionId/turns native runtime routing', () => {
  beforeEach(() => {
    capturedNativeOptions = null;
    capturedAcpOptions = null;
    capturedMindosRuntimeOptions = null;
    mockDetectLocalAcpAgents.mockReset();
    mockResolveCommandPath.mockReset();
    mockResolveCommandPathCandidates.mockReset();
    mockResolveCommandPathCandidates.mockResolvedValue([]);
    mockCheckNativeRuntimeHealth.mockReset();
    mockRunMindosNativeAgentTurn.mockReset();
    mockRunMindosAcpAgentTurn.mockReset();
    mockRunMindosPiAgentTurnSession.mockReset();
    mockCreateAcpSession.mockReset();
    mockCreateAcpSession.mockResolvedValue({ id: 'acp-session-1' });
    mockCreateMindosAgentRuntime.mockReset();
    mockCreateMindosAgentRuntime.mockImplementation(() => {
      throw new Error('pi runtime should not initialize for native runtime requests');
    });
    resetNativeRuntimeDescriptorCacheForTest();
    mockRunMindosNativeAgentTurn.mockImplementation(async (options: MindosNativeAgentTurnOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'native ok' });
      options.send({ type: 'done' });
      return { externalSessionId: 'thr_123' };
    });
    mockRunMindosAcpAgentTurn.mockImplementation(async (options: {
      agentId: string;
      send: (event: { type: string; delta?: string }) => void;
    }) => {
      capturedAcpOptions = options;
      options.send({ type: 'text_delta', delta: 'acp ok' });
      options.send({ type: 'done' });
      return {};
    });
    mockRunMindosPiAgentTurnSession.mockImplementation(async (options: {
      send: (event: { type: string; delta?: string }) => void;
    }) => {
      options.send({ type: 'text_delta', delta: 'mindos ok' });
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

  it('rejects removed mode field before runtime routing', async () => {
    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Organize these captures' }],
      mode: 'organize',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.objectContaining({
        message: 'Unknown field: mode',
      }),
    });
    expect(mockRunMindosNativeAgentTurn).not.toHaveBeenCalled();
    expect(mockRunMindosAcpAgentTurn).not.toHaveBeenCalled();
    expect(mockCreateMindosAgentRuntime).not.toHaveBeenCalled();
  });

  it('applies per-request MindOS agent options when creating the default PI runtime', async () => {
    mockCreateMindosAgentRuntime.mockImplementation(async (options: Record<string, any>) => {
      capturedMindosRuntimeOptions = options;
      return {
        systemPrompt: options.systemPrompt,
        session: {
          subscribe: vi.fn(),
          prompt: vi.fn(),
          steer: vi.fn(),
          abort: vi.fn(),
        },
        agentRunContextResource: {},
        llmHistoryMessages: [],
        lastUserContent: 'Review the note',
        lastUserImages: undefined,
        fallbackTools: [],
        apiKey: 'test-key',
        modelName: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        baseUrl: '',
      };
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Review the note' }],
      providerOverride: 'anthropic',
      modelOverride: 'claude-sonnet-4-20250514',
      permissionMode: 'read',
      agentOptions: { enableThinking: true, thinkingBudget: 8000 },
    }));

    expect(res.status).toBe(200);
    expect(capturedMindosRuntimeOptions).toMatchObject({
      providerOverride: 'anthropic',
      modelOverride: 'claude-sonnet-4-20250514',
      agentConfig: {
        enableThinking: true,
        thinkingBudget: 8000,
        contextStrategy: 'auto',
      },
      allowProjectBash: false,
    });
  }, 15_000);

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
    seedFile('Research/README.md', '# Research');
    invalidateCache();
    const workDir = process.cwd();

    const res = await POST(agentTurnRequest({
      messages: [{
        role: 'user',
        content: 'Use the attached context',
        skillName: 'third-party',
        images: [{ type: 'image', data: 'aW1n', mimeType: 'image/png', fileName: 'diagram.png' }],
      }],
      currentFile: 'current.md',
      attachedFiles: ['attached.md'],
      uploadedFiles: [{
        name: 'brief.pdf',
        content: '[PDF TEXT EXTRACTED: brief.pdf]\n\nOriginal extracted text',
        mimeType: 'application/pdf',
        size: 1234,
        dataBase64: 'cGRmLWJ5dGVz',
      }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' },
      workDir: { source: 'manual', path: workDir, label: 'web' },
      contextSelection: {
        version: 1,
        spaces: [{ path: 'Research', label: 'Research' }],
        assistants: [],
      },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        status: 'active',
        updatedAt: 1,
      },
      providerOverride: 'anthropic',
      modelOverride: 'claude-test',
      permissionMode: 'read',
      runtimeOptions: {
        modelOverride: 'gpt-5.4-codex',
        reasoningEffort: 'high',
      },
      chatSessionId: 'chat-native-1',
    }));

    expect(res.status).toBe(200);
    const text = await res.text();

    expect(capturedNativeOptions?.runtime).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    });
    expect(capturedNativeOptions?.permissionMode).toBe('read');
    expect(capturedNativeOptions?.cwd).toBe(realpathSync(workDir));
    expect(capturedNativeOptions?.modelOverride).toBe('gpt-5.4-codex');
    expect(capturedNativeOptions?.reasoningEffort).toBe('high');
    expect(capturedNativeOptions?.selectedSkills).toEqual([
      { name: 'third-party', source: 'user-selected' },
    ]);
    expect(capturedNativeOptions?.prompt).toContain('MindOS Turn Context');
    expect(capturedNativeOptions?.prompt).toContain('## Session Context');
    expect(capturedNativeOptions?.prompt).toContain(realpathSync(workDir));
    expect(capturedNativeOptions?.prompt).toContain('Research');
    expect(capturedNativeOptions?.prompt).toContain('Use the attached context');
    expect(capturedNativeOptions?.prompt).not.toContain('## Active Skill Request');
    expect(capturedNativeOptions?.prompt).not.toContain('load_skill("third-party")');
    expect(capturedNativeOptions?.prompt).toContain('current.md');
    expect(capturedNativeOptions?.prompt).toContain('Current file body');
    expect(capturedNativeOptions?.prompt).toContain('attached.md');
    expect(capturedNativeOptions?.prompt).toContain('Attached file body');
    expect(capturedNativeOptions?.prompt).toContain('brief.pdf');
    expect(capturedNativeOptions?.attachments).toEqual([
      {
        kind: 'uploaded_file',
        name: 'brief.pdf',
        content: '[PDF TEXT EXTRACTED: brief.pdf]\n\nOriginal extracted text',
        mimeType: 'application/pdf',
        size: 1234,
        dataBase64: 'cGRmLWJ5dGVz',
      },
      {
        kind: 'image',
        name: 'diagram.png',
        data: 'aW1n',
        mimeType: 'image/png',
      },
    ]);
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
        cwd: realpathSync(workDir),
        permissionMode: 'read',
        outputSummary: 'native ok',
        metadata: expect.objectContaining({
          runtimeKind: 'codex',
          externalSessionId: 'thr_123',
          sessionWorkDir: realpathSync(workDir),
          sessionSpaces: ['Research'],
        }),
      }),
    ]);
    expect(nativeRuns[0]?.rootRunId).toBe(nativeRuns[0]?.id);
    expect(text).toContain('"type":"agent_run_context"');
    expect(text).toContain(`"rootRunId":"${nativeRuns[0]?.id}"`);
  }, 15_000);

  it('omits unchanged session context after its signature has been recorded', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    seedFile('Research/README.md', '# Research');
    invalidateCache();
    const workDir = process.cwd();
    const baseBody = {
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' },
      workDir: { source: 'manual', path: workDir, label: 'web' },
      contextSelection: {
        version: 1,
        spaces: [{ path: 'Research', label: 'Research' }],
        assistants: [],
      },
      permissionMode: 'read',
      chatSessionId: 'chat-session-context-signature',
    };

    const first = await POST(agentTurnRequest({
      ...baseBody,
      messages: [{ role: 'user', content: 'first turn' }],
    }));

    expect(first.status).toBe(200);
    await first.text();
    expect(capturedNativeOptions?.prompt).toContain('## Session Context');
    const firstRun = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(firstRun.metadata?.sessionContextSignature).toEqual(expect.any(String));
    expect(firstRun.metadata?.sessionContextInjected).toBe(true);
    const firstSignature = firstRun.metadata?.sessionContextSignature;

    capturedNativeOptions = null;
    const second = await POST(agentTurnRequest({
      ...baseBody,
      messages: [{ role: 'user', content: 'second turn' }],
    }));

    expect(second.status).toBe(200);
    await second.text();
    expect(capturedNativeOptions?.prompt).toContain('## Now');
    expect(capturedNativeOptions?.prompt).not.toContain('## Session Context');
    const secondRun = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(secondRun.metadata?.sessionContextSignature).toBe(firstSignature);
    expect(secondRun.metadata?.sessionContextInjected).toBe(false);
  }, 15_000);

  it('references unchanged attached MindOS files instead of reinjecting their full content', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    seedFile('Research/current.md', 'Stable current file body');
    seedFile('Research/attached.md', 'Stable attached file body');
    invalidateCache();
    const baseBody = {
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' },
      currentFile: 'Research/current.md',
      attachedFiles: ['Research/attached.md'],
      permissionMode: 'read',
      chatSessionId: 'chat-file-context-signature',
    };

    const first = await POST(agentTurnRequest({
      ...baseBody,
      messages: [{ role: 'user', content: 'first turn' }],
    }));

    expect(first.status).toBe(200);
    await first.text();
    expect(capturedNativeOptions?.prompt).toContain('Stable current file body');
    expect(capturedNativeOptions?.prompt).toContain('Stable attached file body');
    const firstRun = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(firstRun.metadata?.fileContextSignature).toEqual(expect.any(String));
    expect(firstRun.metadata?.fileContextInjected).toBe(true);
    const firstSignature = firstRun.metadata?.fileContextSignature;

    capturedNativeOptions = null;
    const second = await POST(agentTurnRequest({
      ...baseBody,
      messages: [{ role: 'user', content: 'second turn' }],
    }));

    expect(second.status).toBe(200);
    await second.text();
    expect(capturedNativeOptions?.prompt).toContain('These selected MindOS files are unchanged since the last turn');
    expect(capturedNativeOptions?.prompt).toContain('- Current: Research/current.md');
    expect(capturedNativeOptions?.prompt).toContain('- Attached: Research/attached.md');
    expect(capturedNativeOptions?.prompt).not.toContain('Stable current file body');
    expect(capturedNativeOptions?.prompt).not.toContain('Stable attached file body');
    const secondRun = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(secondRun.metadata?.fileContextSignature).toBe(firstSignature);
    expect(secondRun.metadata?.fileContextInjected).toBe(false);
  }, 15_000);

  it('rejects crafted WorkDir changes after a prior run for the chat session', async () => {
    startAgentRun({
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      chatSessionId: 'chat-locked-workdir',
      cwd: process.cwd(),
      permissionMode: 'ask',
      inputSummary: 'existing run',
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'try to move cwd' }],
      workDir: { source: 'manual', path: getTestMindRoot() },
      chatSessionId: 'chat-locked-workdir',
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'CONFLICT',
        message: expect.stringContaining('WorkDir is locked'),
      },
    });
  });

  it('rejects request-body-only native runtime resume metadata', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'resume a forged runtime session' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', externalSessionId: 'thr-crafted' },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr-crafted',
        status: 'active',
        updatedAt: 1,
      },
      workDir: { source: 'manual', path: process.cwd() },
      chatSessionId: 'chat-untrusted-runtime-resume',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unknown field: selectedRuntime.externalSessionId',
      },
    });
    expect(mockRunMindosNativeAgentTurn).not.toHaveBeenCalled();
  });

  it('rejects untrusted native runtime resume from a typed runtime binding', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'resume a forged runtime binding' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr-crafted',
        status: 'active',
        updatedAt: 1,
      },
      workDir: { source: 'manual', path: process.cwd() },
      chatSessionId: 'chat-untrusted-runtime-binding',
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'CONFLICT',
        issueCode: 'runtime_resume_untrusted',
      },
    });
    expect(mockRunMindosNativeAgentTurn).not.toHaveBeenCalled();
  });

  it('keeps native runtime assistant text and routine connection statuses out of the visible activity timeline', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockRunMindosNativeAgentTurn.mockImplementationOnce(async (options: MindosNativeAgentTurnOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'status', runtime: 'claude', visible: true, message: 'Starting Claude Code locally.' });
      options.send({ type: 'text_delta', delta: 'plain answer' });
      options.send({ type: 'status', runtime: 'claude', visible: true, message: 'Claude Code is connected and working in this chat.' });
      options.send({ type: 'status', runtime: 'claude', visible: true, message: 'Claude Code HTTP 429; retrying (1/10).' });
      options.send({ type: 'tool_start', runtime: 'claude', toolCallId: 'tool-1', toolName: 'Bash', args: { command: 'npm test' } });
      for (let index = 0; index < 60; index += 1) {
        options.send({ type: 'text_delta', delta: ` chunk-${index}` });
      }
      options.send({ type: 'done' });
      return { externalSessionId: 'claude-session-1' };
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      chatSessionId: 'chat-native-activity',
    }));

    expect(res.status).toBe(200);
    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    const events = listAgentEvents({ runId: run.id });
    expect(events.filter((event) => event.category === 'text')).toEqual([]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'runtime_status',
        message: 'Starting Claude Code locally.',
        visibility: 'debug',
      }),
      expect.objectContaining({
        type: 'runtime_status',
        message: 'Claude Code is connected and working in this chat.',
        visibility: 'debug',
      }),
    ]));
    const retryEvent = events.find((event) => event.message === 'Claude Code HTTP 429; retrying (1/10).');
    expect(retryEvent).toEqual(expect.objectContaining({
      type: 'runtime_status',
    }));
    expect(retryEvent).not.toHaveProperty('visibility');
    const toolEvent = events.find((event) => event.type === 'tool_started');
    expect(toolEvent).toEqual(expect.objectContaining({
      category: 'tool',
    }));
    expect(toolEvent).not.toHaveProperty('visibility');
  });

  it('maps readonly permission requests to readonly native runtime mode', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Read the workspace only' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      permissionMode: 'read',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime.kind).toBe('claude');
    expect(capturedNativeOptions?.permissionMode).toBe('read');
  });

  it('uses the server-detected native runtime path instead of trusting the request body', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
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

  it('maps Inbox Organizer assistant native runtime requests to trusted-write ask permission mode', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Organize with full assistant access' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      assistantId: 'inbox-organizer',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.runtime.kind).toBe('codex');
    expect(capturedNativeOptions?.permissionMode).toBe('ask');
  });

  it('keeps Inbox Organizer assistant runs on ask permission when native runtime options request agent permissions', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Organize safely' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      permissionMode: 'ask',
      runtimeOptions: { modelOverride: 'gpt-5.4-codex', reasoningEffort: 'xhigh' },
      assistantId: 'inbox-organizer',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.permissionMode).toBe('ask');
    expect(capturedNativeOptions?.modelOverride).toBe('gpt-5.4-codex');
    expect(capturedNativeOptions?.reasoningEffort).toBe('xhigh');
  });

  it('honors explicit readonly permission for registered assistant preview runs', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Preview without writes' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      permissionMode: 'read',
      assistantId: 'inbox-organizer',
    }));

    expect(res.status).toBe(200);
    await res.text();

    expect(capturedNativeOptions?.permissionMode).toBe('read');
  });

  it('rejects nested runtime permission options', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      runtimeOptions: {
        permissionMode: 'read',
        modelOverride: 'claude-sonnet-4-20250514',
        reasoningEffort: 'xhigh',
      },
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Unknown field: runtimeOptions.permissionMode',
      },
    });
    expect(capturedNativeOptions).toBeNull();
  });

  it('does not resume a native runtime when the matching session binding is non-active', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Start fresh if old thread failed' }],
      selectedRuntime: {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
      },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_stale',
        status: 'failed',
        updatedAt: 1,
      },
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

  it('rejects a typed runtime binding that does not match the selected runtime', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Do not resume a mismatched thread' }],
      selectedRuntime: {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
      },
      runtimeBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'claude_session',
        status: 'active',
        updatedAt: 1,
      },
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'runtimeBinding must match selectedRuntime',
      },
    });
    expect(capturedNativeOptions).toBeNull();
  });

  it('rejects a MindOS runtime binding with the wrong session kind', async () => {
    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Do not accept a mismatched Pi binding' }],
      selectedRuntime: {
        id: 'mindos',
        name: 'MindOS',
        kind: 'mindos',
      },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'mindos',
        runtimeId: 'mindos',
        externalSessionId: 'pi-session-1',
        status: 'active',
        updatedAt: 1,
      },
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'INVALID_REQUEST',
        message: 'runtimeBinding.kind must be mindos-pi-session for MindOS',
      },
    });
    expect(mockCreateMindosAgentRuntime).not.toHaveBeenCalled();
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

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Codex is signed out. Run codex login first.' },
    });
    expect(capturedNativeOptions).toBeNull();
  });

  it('rejects Codex with a compact message when forced recheck hits an optional dependency stack', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/opt/homebrew/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({
      status: 'error',
      reason: RAW_CODEX_OPTIONAL_DEPENDENCY_STACK,
    });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: {
        message: 'Codex is unavailable. Codex is installed but incomplete. Reinstall Codex with "npm install -g @openai/codex@latest", then restart MindOS.',
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('file:///opt/homebrew');
    expect(serialized).not.toContain('throw new Error');
    expect(serialized).not.toContain('ModuleJob.run');
    expect(serialized).not.toContain('node:internal');
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

    const responsePromise = POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex even if detection is slow' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
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

    const responsePromise = POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex while detection is slow' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/tmp/fake-codex' },
    }));

    await vi.advanceTimersByTimeAsync(3000);
    const res = await responsePromise;
    const body = await res.json();
    vi.useRealTimers();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Codex is still being verified. Please retry in a moment.' },
    });
    expect(capturedNativeOptions).toBeNull();
    expect(mockRunMindosNativeAgentTurn).not.toHaveBeenCalled();
  });

  it('does not start Claude when verification hangs without a cached local CLI path', async () => {
    vi.useFakeTimers();
    mockResolveCommandPath.mockImplementation(async () => new Promise(() => {}));
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const responsePromise = POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude Code even if detection is slow' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude', binaryPath: '/tmp/fake-claude' },
    }));

    await vi.advanceTimersByTimeAsync(3000);
    const res = await responsePromise;
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { message: 'Claude Code is still being verified. Please retry in a moment.' },
    });
    expect(capturedNativeOptions).toBeNull();
    expect(mockRunMindosNativeAgentTurn).not.toHaveBeenCalled();
  });

  it('uses the real Claude CLI path returned by runtime health before launching', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command !== 'claude') return null;
      return '/usr/local/bin/claude';
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude', binaryPath: '/tmp/fake-claude' },
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

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex with timeout' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    }));
    await res.text();

    expect(res.status).toBe(200);
    expect(capturedNativeOptions?.timeoutMs).toBe(1234);
  });

  it('returns a structured SSE error if the native runtime runner throws', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'claude' ? '/usr/local/bin/claude' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockRunMindosNativeAgentTurn.mockImplementationOnce(async (options: MindosNativeAgentTurnOptions) => {
      capturedNativeOptions = options;
      throw new Error('native bridge exploded');
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
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
        permissionMode: 'ask',
        error: 'native bridge exploded',
      }),
    ]);
  });

  it('records returned native runtime errors as failed ledger runs', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => command === 'codex' ? '/usr/local/bin/codex' : null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });
    mockRunMindosNativeAgentTurn.mockImplementationOnce(async (options: MindosNativeAgentTurnOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'partial native output' });
      return { error: new Error('native runtime returned failure'), externalSessionId: 'thr_failed' };
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Codex' }],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
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
        permissionMode: 'ask',
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
    mockRunMindosNativeAgentTurn.mockImplementationOnce(async (options: MindosNativeAgentTurnOptions) => {
      capturedNativeOptions = options;
      options.send({ type: 'text_delta', delta: 'partial native output' });
      return { error: timeoutError, externalSessionId: 'claude-timeout' };
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use Claude Code' }],
      selectedRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
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
    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use the selected ACP agent' }],
      selectedRuntime: { id: 'broken-runtime' },
      selectedAcpAgent: { id: 'legacy-acp', name: 'Legacy ACP' },
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
        permissionMode: 'ask',
        outputSummary: 'acp ok',
        metadata: expect.objectContaining({
          source: 'selected-acp-runtime',
        }),
      }),
    ]);
  });

  it('maps selected ACP runtime in Inbox Organizer assistant runs to agent session permission', async () => {
    mockRunMindosAcpAgentTurn.mockImplementationOnce(async (options: Record<string, any>) => {
      capturedAcpOptions = options;
      await options.createSession(options.agentId, { cwd: '/tmp/mindos-test' });
      options.send({ type: 'text_delta', delta: 'acp assistant ok' });
      options.send({ type: 'done' });
      return {};
    });

    const workDir = process.cwd();
    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Organize through ACP safely' }],
      selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
      workDir: { source: 'manual', path: workDir, label: 'repo' },
      assistantId: 'inbox-organizer',
      chatSessionId: 'chat-acp-1',
    }));
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toContain('acp assistant ok');
    expect(capturedAcpOptions?.agentId).toBe('gemini');
    expect(capturedAcpOptions?.cwd).toBe(realpathSync(workDir));
    expect(mockCreateAcpSession).toHaveBeenCalledWith('gemini', expect.objectContaining({
      cwd: '/tmp/mindos-test',
      permissionMode: 'agent',
    }));
    const acpRuns = listAgentRuns({ kind: 'acp' });
    expect(acpRuns).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'gemini',
        displayName: 'Gemini ACP',
        status: 'completed',
        chatSessionId: 'chat-acp-1',
        cwd: realpathSync(workDir),
        permissionMode: 'ask',
        outputSummary: 'acp assistant ok',
      }),
    ]);
    expect(acpRuns[0]?.rootRunId).toBe(acpRuns[0]?.id);
    expect(text).toContain('"type":"agent_run_context"');
    expect(text).toContain(`"rootRunId":"${acpRuns[0]?.id}"`);
  });

  it('records selected ACP streaming runtime failures in the run ledger', async () => {
    mockRunMindosAcpAgentTurn.mockImplementationOnce(async (options: {
      agentId: string;
      send: (event: { type: string; delta?: string }) => void;
    }) => {
      capturedAcpOptions = options;
      options.send({ type: 'text_delta', delta: 'partial acp output' });
      return { error: new Error('acp crashed') };
    });

    const res = await POST(agentTurnRequest({
      messages: [{ role: 'user', content: 'Use the selected ACP agent' }],
      selectedRuntime: { id: 'gemini', name: 'Gemini ACP', kind: 'acp' },
      permissionMode: 'read',
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
        permissionMode: 'read',
        outputSummary: 'partial acp output',
        error: 'acp crashed',
      }),
    ]);
  });
});
