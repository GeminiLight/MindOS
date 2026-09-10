import { describe, expect, it, vi } from 'vitest';
import type { MindOSSSEvent } from '../turn/index.js';
import type { MindosAcpAgentTurnOptions, MindosAcpSessionUpdate } from '../turn/acp-lane.js';
import type { MindosNativeAgentTurnOptions } from './run-lane-shared.js';
import type { MindosPiAgentRuntime } from '../mindos-pi/session.js';
import type { LaneSession, LaneSink } from './lane-runner.js';
import {
  acpPermissionEventOptionsToRuntimeOptions,
  acpPermissionResponseFromRuntimeResult,
  createAcpRuntimeLane,
  createMindosPiRuntimeLane,
  createNativeRuntimeLane,
  compactStringEnv,
  formatMindosPiExtensionLoadStatus,
  type AcpLaneSessionOpenOptions,
  type AcpRuntimeLaneDeps,
} from './lane-adapters.js';
import type { AcpPermissionEvent } from './acp-types.js';

function createFakeSink(overrides: Partial<LaneSink> = {}) {
  const frames: MindOSSSEvent[] = [];
  const updates: unknown[] = [];
  const sink: LaneSink = {
    send: (event) => frames.push(event),
    requestPermission: vi.fn(async () => ({ decision: 'accept', decisionIntent: 'allow' as const })),
    askUser: vi.fn(async () => ({ answers: [] })),
    permissionRunId: 'perm-run-1',
    runContext: { rootRunId: 'run-1', parentRunId: 'run-1' },
    updateRun: (patch) => updates.push(patch),
    ...overrides,
  };
  return { sink, frames, updates };
}

const baseTurn = { signal: new AbortController().signal, timeoutMs: 42_000 };

describe('createNativeRuntimeLane', () => {
  const runtime = { id: 'codex', name: 'Codex', kind: 'codex' as const };

  it('maps config + turn + sink onto the injected runner and mutates the session from the result', async () => {
    const runTurn = vi.fn(async (options: MindosNativeAgentTurnOptions) => {
      expect(options.timeoutMs).toBe(42_000);
      expect(options.signal).toBe(baseTurn.signal);
      options.send({ type: 'text_delta', delta: 'x' });
      return { externalSessionId: 'thr-9' };
    });
    const lane = createNativeRuntimeLane(
      { runtime, cwd: '/work', prompt: 'hi', permissionMode: 'ask' },
      { runTurn },
    );
    const session = await lane.open({});
    expect(session).toEqual({ kind: 'codex', runtimeId: 'codex', cwd: '/work', metadata: { runtimeKind: 'codex' } });

    const { sink, frames } = createFakeSink();
    const result = await lane.run(session, baseTurn, sink);

    expect(result).toEqual({ externalSessionId: 'thr-9' });
    expect(frames.map((frame) => frame.type)).toEqual(['text_delta']);
    expect(session.externalSessionId).toBe('thr-9');
    expect(session.archive).toEqual({ sessionId: 'thr-9' });
    expect(session.metadata).toEqual({ runtimeKind: 'codex', externalSessionId: 'thr-9' });
    expect(session.capsuleBinding).toEqual(expect.objectContaining({ type: 'codex-thread', externalSessionId: 'thr-9', status: 'active' }));
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it('routes runner services through the sink bridges', async () => {
    let capturedServices: MindosNativeAgentTurnOptions['services'] | undefined;
    const lane = createNativeRuntimeLane(
      { runtime, cwd: '/work', prompt: 'hi' },
      { runTurn: async (options) => { capturedServices = options.services; return {}; } },
    );
    const requestPermission = vi.fn(async () => ({ decision: 'decline', decisionIntent: 'deny' as const }));
    const askUser = vi.fn(async () => ({ answers: [] }));
    const { sink } = createFakeSink({ requestPermission, askUser });
    await lane.run(await lane.open({}), baseTurn, sink);

    const permissionResult = await capturedServices?.requestRuntimePermission?.({
      runtime: 'codex', toolCallId: 't', toolName: 'Bash', input: {}, options: [],
    }, { signal: baseTurn.signal });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(permissionResult).toEqual({ decision: 'decline', decisionIntent: 'deny' });

    await capturedServices?.requestUserQuestion?.({ runtime: 'codex', toolCallId: 'q', questions: [] }, {});
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('builds the Claude permission prompt factory with the caller-generated bridge run id', async () => {
    let capturedServices: MindosNativeAgentTurnOptions['services'] | undefined;
    const promptFactoryContexts: Array<{ permissionRunId: string }> = [];
    const lane = createNativeRuntimeLane(
      {
        runtime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
        cwd: '/work',
        prompt: 'hi',
        createClaudePermissionPrompt: (context) => {
          promptFactoryContexts.push(context);
          return () => ({ toolName: 'mindos_runtime_permission', mcpConfig: { mcpServers: {} } });
        },
      },
      { runTurn: async (options) => { capturedServices = options.services; return {}; } },
    );
    const { sink } = createFakeSink();
    await lane.run(await lane.open({}), baseTurn, sink);

    expect(promptFactoryContexts).toEqual([{ permissionRunId: 'perm-run-1' }]);
    expect(capturedServices?.createClaudePermissionPrompt).toBeTypeOf('function');
  });

  it('does not attach a Claude prompt factory for codex lanes', async () => {
    let capturedServices: MindosNativeAgentTurnOptions['services'] | undefined;
    const lane = createNativeRuntimeLane(
      {
        runtime,
        cwd: '/work',
        prompt: 'hi',
        createClaudePermissionPrompt: () => () => undefined,
      },
      { runTurn: async (options) => { capturedServices = options.services; return {}; } },
    );
    const { sink } = createFakeSink();
    await lane.run(await lane.open({}), baseTurn, sink);
    expect(capturedServices?.createClaudePermissionPrompt).toBeUndefined();
  });
});

describe('createAcpRuntimeLane', () => {
  function permissionEvent(overrides: Partial<AcpPermissionEvent> = {}): AcpPermissionEvent {
    return {
      requestId: 'req-1',
      sessionId: 'sess-1',
      toolCallId: 'tc-1',
      toolName: 'Bash',
      status: 'pending',
      options: [
        { id: 'allow', label: 'Allow', kind: 'allow_once' },
        { id: 'allow-always', label: 'Always allow', kind: 'allow_always' },
        { id: 'reject', label: 'Reject', kind: 'reject_once' },
      ],
      requestedAt: new Date(0).toISOString(),
      ...overrides,
    };
  }

  function createAcpDeps(overrides: Partial<AcpRuntimeLaneDeps> = {}) {
    const createSession = vi.fn(async (_agentId: string, _options: AcpLaneSessionOpenOptions) => ({ id: 'acp-session-1' }));
    const loadSession = vi.fn(async () => ({ id: 'acp-session-1' }));
    const promptStream = vi.fn(async () => {});
    const closeSession = vi.fn(async () => {});
    const setMode = vi.fn(async () => {});
    const setConfigOption = vi.fn(async () => {});
    return {
      deps: { createSession, loadSession, promptStream, closeSession, setMode, setConfigOption, ...overrides } as AcpRuntimeLaneDeps,
      createSession, loadSession, promptStream, closeSession, setMode, setConfigOption,
    };
  }

  const config = {
    agent: { id: 'gemini', name: 'Gemini CLI' },
    cwd: '/work',
    prompt: 'do it',
    attachments: [],
    acpPermissionMode: 'ask' as const,
    runtimeOptions: {},
  };

  it('opens with materialized attachments and keeps the seed capsule binding', async () => {
    const { deps } = createAcpDeps();
    const lane = createAcpRuntimeLane({ ...config, initialCapsuleBinding: null }, deps);
    const session = await lane.open({});
    expect(session.kind).toBe('acp');
    expect(session.runtimeId).toBe('gemini');
    expect(session.capsuleBinding).toBeNull();
    expect((session.handle as { prompt: string }).prompt).toBe('do it');
  });

  it('assembles the pooled ACP turn with env overlay, permission mode, resolver and runtime options', async () => {
    let captured: MindosAcpAgentTurnOptions | null = null;
    const { deps, createSession, setMode, setConfigOption } = createAcpDeps({
      runAcpTurn: async (options) => { captured = options; return {}; },
    });
    const lane = createAcpRuntimeLane({
      ...config,
      envOverlay: { GEMINI_API_KEY: 'runtime-gemini', UNSET: undefined },
      runtimeOptions: { modeId: 'mode-x', configValues: { model: 'gemini-2.5', blank: '' } },
      resumeExternalSessionId: 'ext-1',
    }, deps);
    const session = await lane.open({});
    const { sink } = createFakeSink();
    await lane.run(session, baseTurn, sink);

    expect(captured).toBeTruthy();
    expect(captured!.agentId).toBe('gemini');
    expect(captured!.timeoutMs).toBe(42_000);
    expect(captured!.signal).toBe(baseTurn.signal);
    expect(captured!.permissionRunId).toBe('perm-run-1');
    expect(captured!.externalSessionId).toBe('ext-1');

    const created = await captured!.createSession('gemini', { cwd: '/work' });
    expect(created).toEqual({ id: 'acp-session-1' });
    const openOptions = createSession.mock.calls[0]![1];
    expect(openOptions.env).toEqual({ GEMINI_API_KEY: 'runtime-gemini' });
    expect(openOptions.permissionMode).toBe('ask');
    expect(openOptions.resolvePermissionRequest).toBeTypeOf('function');
    // create/load apply this turn's runtime options to the live session.
    expect(setMode).toHaveBeenCalledWith('acp-session-1', 'mode-x');
    expect(setConfigOption).toHaveBeenCalledWith('acp-session-1', 'model', 'gemini-2.5');
    expect(setConfigOption).not.toHaveBeenCalledWith('acp-session-1', 'blank', '');
  });

  it('routes the ACP permission resolver through sink.requestPermission and maps decisions back', async () => {
    let captured: MindosAcpAgentTurnOptions | null = null;
    const { deps, createSession } = createAcpDeps({
      runAcpTurn: async (options) => { captured = options; return {}; },
    });
    const requestPermission = vi.fn(async () => ({
      decision: 'no-such-option',
      decisionIntent: 'allow' as const,
      decisionScope: 'session' as const,
    }));
    const { sink } = createFakeSink({ requestPermission });
    const lane = createAcpRuntimeLane(config, deps);
    const session = await lane.open({});
    await lane.run(session, baseTurn, sink);

    await captured!.createSession('gemini', { cwd: '/work' });
    const resolver = createSession.mock.calls[0]![1].resolvePermissionRequest!;
    const event = permissionEvent();
    const response = await resolver({ event, params: { toolCall: { rawInput: '{}' } } });

    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'acp',
        toolCallId: 'tc-1',
        toolName: 'Bash',
        input: { rawInput: '{}' },
        options: [
          { id: 'allow', label: 'Allow', intent: 'allow', scope: 'once' },
          { id: 'allow-always', label: 'Always allow', intent: 'allow', scope: 'session' },
          { id: 'reject', label: 'Reject', intent: 'deny', scope: 'once' },
        ],
      }),
      expect.objectContaining({ requestId: 'req-1', emitRequest: false, emitResolved: false }),
    );
    // A session-scope allow without an exact decision id falls back to allow_always.
    expect(response).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-always' } });
  });

  it('updates the ledger and capsule binding when the pooled session is ready', async () => {
    let captured: MindosAcpAgentTurnOptions | null = null;
    const { deps } = createAcpDeps({
      runAcpTurn: async (options) => { captured = options; return {}; },
    });
    const { sink, updates } = createFakeSink();
    const lane = createAcpRuntimeLane({ ...config, initialCapsuleBinding: null }, deps);
    const session = await lane.open({});
    await lane.run(session, baseTurn, sink);

    await captured!.onSessionReady?.({ id: 'acp-session-1' }, { resumed: true, externalSessionId: 'ext-7' });
    expect(updates[0]).toEqual({
      archive: { sessionId: 'ext-7' },
      metadata: { phase: 'prompt', sessionId: 'acp-session-1', resumed: true, externalSessionId: 'ext-7' },
    });
    expect(session.capsuleBinding).toEqual(expect.objectContaining({ type: 'acp-session', externalSessionId: 'ext-7' }));
    expect(session.externalSessionId).toBe('ext-7');
  });

  it('closes a pooled session whose runtime options cannot be applied and resumes fresh', async () => {
    let captured: MindosAcpAgentTurnOptions | null = null;
    const takePooledSession = vi.fn(() => ({ id: 'pooled-1' }));
    const { deps, closeSession, setMode } = createAcpDeps({
      runAcpTurn: async (options) => { captured = options; return {}; },
      takePooledSession,
    });
    setMode.mockRejectedValueOnce(new Error('session is dead'));
    const lane = createAcpRuntimeLane({ ...config, runtimeOptions: { modeId: 'mode-x' } }, deps);
    const session = await lane.open({});
    await lane.run(session, baseTurn, createFakeSink().sink);

    const acquired = await captured!.acquireSession?.({ agentId: 'gemini', cwd: '/work', externalSessionId: 'ext-1' });
    expect(acquired).toBeUndefined();
    expect(closeSession).toHaveBeenCalledWith('pooled-1', { closeAgentSession: false });
  });

  it('passes result.error through and reports terminal lane errors as failures', async () => {
    const { deps } = createAcpDeps({
      runAcpTurn: async () => ({ error: new Error('acp boom') }),
    });
    const lane = createAcpRuntimeLane(config, deps);
    const session = await lane.open({});
    const result = await lane.run(session, baseTurn, createFakeSink().sink);
    expect(result.error?.message).toBe('acp boom');
  });

  it('maps ACP permission events without options to a single cancel option', () => {
    expect(acpPermissionEventOptionsToRuntimeOptions(permissionEvent({ options: [] }))).toEqual([
      { id: 'cancel', label: 'Cancel', intent: 'cancel', scope: 'once' },
    ]);
  });

  it('maps cancelled and deny decisions back to ACP outcomes', () => {
    const event = permissionEvent();
    expect(acpPermissionResponseFromRuntimeResult(event, { decision: 'cancel', cancelled: true, decisionIntent: 'cancel' }))
      .toEqual({ outcome: { outcome: 'cancelled' } });
    expect(acpPermissionResponseFromRuntimeResult(event, { decision: 'reject', decisionIntent: 'deny' }))
      .toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    expect(acpPermissionResponseFromRuntimeResult(event, { decision: 'allow', decisionIntent: 'allow' }))
      .toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
  });

  it('compacts env overlays, dropping undefined values', () => {
    expect(compactStringEnv(undefined)).toBeUndefined();
    expect(compactStringEnv({ A: 'x', B: undefined })).toEqual({ A: 'x' });
    expect(compactStringEnv({ B: undefined })).toBeUndefined();
  });

  it('sends an ACP session update mapping smoke frame through the lane sink', async () => {
    // Guards the injected promptStream wiring: updates flow lane → deps.promptStream.
    const onUpdateSpy = vi.fn();
    const promptStream = vi.fn(async (
      _sessionId: string,
      _prompt: string,
      onUpdate: (update: MindosAcpSessionUpdate) => void,
    ) => {
      onUpdate({ type: 'agent_message_chunk', text: 'hi' });
      onUpdateSpy(onUpdate);
    });
    const lane = createAcpRuntimeLane({
      agent: { id: 'gemini', name: 'Gemini CLI' },
      cwd: '/work',
      prompt: 'p',
      attachments: [],
      acpPermissionMode: 'ask',
      runtimeOptions: {},
    }, {
      promptStream,
      createSession: async () => ({ id: 's-1' }),
      loadSession: async () => ({ id: 's-1' }),
      closeSession: async () => {},
      runAcpTurn: async (options) => {
        await options.promptStream('s-1', 'p', (update) => {
          if (update.type === 'agent_message_chunk') options.send({ type: 'text_delta', delta: update.text ?? '' });
        });
        return {};
      },
    });
    const { sink, frames } = createFakeSink();
    const session = await lane.open({});
    await lane.run(session, baseTurn, sink);
    expect(onUpdateSpy).toHaveBeenCalledTimes(1);
    expect(frames).toContainEqual({ type: 'text_delta', delta: 'hi' });
  });
});

describe('createMindosPiRuntimeLane', () => {
  function createFakeRuntime(overrides: Record<string, unknown> = {}) {
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {}),
      steer: vi.fn(),
      abort: vi.fn(),
      dispose: vi.fn(),
    };
    return {
      runtime: {
        session,
        agentRunContextResource: {},
        llmHistoryMessages: [],
        fallbackTools: [],
        systemPrompt: 'sys',
        turnPrompt: 'turn',
        model: {},
        modelName: 'claude-sonnet',
        apiKey: 'key',
        provider: 'anthropic',
        baseUrl: '',
        lastUserContent: 'hello',
        extensionLoadErrors: [],
        ...overrides,
      },
      session,
    };
  }

  const config = { cwd: '/work', stepLimit: 10, thinkingLevel: 'medium', proxyMessages: { proxyCompatMode: 'compat', proxyCompatDetecting: 'detecting', proxyCompatFailed: (m: string) => `failed ${m}`, proxyCompatAlsoFailed: (m: string) => `also ${m}` } };

  it('shapes the lane session from the opened runtime (capsule patch, archive, terminal metadata)', async () => {
    const { runtime } = createFakeRuntime({
      runtimeSession: { externalSessionId: 'pi-1', sessionDir: '/sessions/pi-1', sessionFile: '/sessions/pi-1.jsonl', resumed: true },
    });
    const lane = createMindosPiRuntimeLane({ ...config, runtime: runtime as unknown as MindosPiAgentRuntime }, {
      readCompatCache: () => ({}),
      resolveCompatMode: () => undefined,
      writeCompat: () => {},
    });
    const session: LaneSession = await lane.open({});
    expect(session.kind).toBe('mindos');
    expect(session.externalSessionId).toBe('pi-1');
    expect(session.capsulePatch).toEqual(expect.objectContaining({ model: 'claude-sonnet', thinkingEffort: 'medium' }));
    expect(session.capsulePatch?.runtimeBinding).toEqual(expect.objectContaining({ type: 'mindos-pi-session', externalSessionId: 'pi-1' }));
    expect(session.archive).toEqual({ sessionId: 'pi-1', path: '/sessions/pi-1.jsonl' });
    expect(session.metadata).toEqual({ externalSessionId: 'pi-1', runtimeSessionDir: '/sessions/pi-1', runtimeSessionResumed: true });
    expect(session.capsuleBinding).toEqual(expect.objectContaining({ type: 'mindos-pi-session' }));
  });

  it('emits pre-run frames in order and maps the session result', async () => {
    const { runtime } = createFakeRuntime({
      runtimeSession: { externalSessionId: 'pi-2', resumed: false },
      contextUsage: { type: 'context_usage', phase: 'preflight', action: 'prompt_compacted', message: 'compacted', percent: 80, usedTokens: 8, contextWindow: 10, budgetTokens: 9, reserveTokens: 1, systemPromptTokens: 1, turnPromptTokens: 1, historyTokens: 1 },
      extensionLoadErrors: [{ path: '/ext/pi-web-access/index.js', error: 'failed' }],
    });
    const runPiSession = vi.fn(async (options: { send(event: MindOSSSEvent): void }) => {
      options.send({ type: 'text_delta', delta: 'ok' });
      options.send({ type: 'done' });
      return { status: 'completed' as const, hasContent: true, lastModelError: '' };
    });
    const lane = createMindosPiRuntimeLane({ ...config, runtime: runtime as unknown as MindosPiAgentRuntime }, {
      runPiSession,
      readCompatCache: () => ({ default: 'non-streaming' }),
      resolveCompatMode: () => 'non-streaming',
      writeCompat: () => {},
    });
    const { sink, frames } = createFakeSink();
    const session = await lane.open({});
    const result = await lane.run(session, baseTurn, sink);

    expect(result).toEqual({});
    expect(frames.map((frame) => frame.type)).toEqual(['runtime_binding', 'context_usage', 'status', 'status', 'text_delta', 'done']);
    const piOptions = runPiSession.mock.calls[0]![0];
    expect(piOptions).toEqual(expect.objectContaining({
      prompt: 'turn',
      stepLimit: 10,
      timeoutMs: 42_000,
      signal: baseTurn.signal,
      provider: 'anthropic',
      effectiveBaseUrlKey: 'default',
      compatMode: 'non-streaming',
    }));
  });

  it('maps a structured Pi session error onto result.error without rethrowing', async () => {
    const { runtime } = createFakeRuntime();
    const lane = createMindosPiRuntimeLane({ ...config, runtime: runtime as unknown as MindosPiAgentRuntime }, {
      runPiSession: async () => ({ status: 'error' as const, message: 'model failed', hasContent: true, lastModelError: 'model failed' }),
      readCompatCache: () => ({}),
      resolveCompatMode: () => undefined,
      writeCompat: () => {},
    });
    const session = await lane.open({});
    const result = await lane.run(session, baseTurn, createFakeSink().sink);
    expect(result.error?.message).toBe('model failed');
  });

  it('prefers the explicit config prompt over the runtime turn prompt', async () => {
    const { runtime } = createFakeRuntime();
    let capturedPrompt: unknown;
    const lane = createMindosPiRuntimeLane({
      ...config,
      prompt: 'post-compaction prompt',
      runtime: runtime as unknown as MindosPiAgentRuntime,
    }, {
      runPiSession: async (options) => {
        capturedPrompt = options.prompt;
        return { status: 'completed' as const, hasContent: true, lastModelError: '' };
      },
      readCompatCache: () => ({}),
      resolveCompatMode: () => undefined,
      writeCompat: () => {},
    });
    const session = await lane.open({});
    await lane.run(session, baseTurn, createFakeSink().sink);
    expect(capturedPrompt).toBe('post-compaction prompt');
  });

  it('falls back to the generic message when a Pi error result has none, disposes on close and aborts on interrupt', async () => {
    const { runtime, session: piSession } = createFakeRuntime();
    const lane = createMindosPiRuntimeLane({ ...config, runtime: runtime as unknown as MindosPiAgentRuntime }, {
      runPiSession: async () => ({ status: 'error' as const, hasContent: false, lastModelError: '' }),
      readCompatCache: () => ({}),
      resolveCompatMode: () => undefined,
      writeCompat: () => {},
    });
    const session = await lane.open({});
    const result = await lane.run(session, baseTurn, createFakeSink().sink);
    expect(result.error?.message).toBe('MindOS agent turn failed.');

    await lane.interrupt(session);
    expect(piSession.abort).toHaveBeenCalledTimes(1);
    await lane.close(session, { keepExternalSession: false });
    expect(piSession.dispose).toHaveBeenCalledTimes(1);
  });

  it('formats extension load status once with the pi-web-access suffix', () => {
    expect(formatMindosPiExtensionLoadStatus(undefined)).toBeNull();
    expect(formatMindosPiExtensionLoadStatus([])).toBeNull();
    const status = formatMindosPiExtensionLoadStatus([
      { path: '/ext/pi-web-access/index.js', error: 'missing export' },
      { path: '/ext/pi-web-access/index.js', error: 'other' },
    ]);
    expect(status).toContain('2 extension issues');
    expect(status).toContain('pi-web-access is unavailable');
    const single = formatMindosPiExtensionLoadStatus([{ path: '/ext/other/index.js', error: 'x' }]);
    expect(single).toContain('1 extension issue');
    expect(single).toContain('Some extension tools may be unavailable.');
  });
});
