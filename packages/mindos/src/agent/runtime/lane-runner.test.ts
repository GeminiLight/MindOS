import { executeAgentTurn } from '../turn/execute.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import { createMindosAgentModeContract } from '../mode.js';
import {
  getAgentRun,
  listAgentEvents,
  listAgentRuns,
  resetAgentRunsForTest,
} from '../ledger/run-ledger.js';
import { cancelAgentRunWithHandlers } from '../ledger/run-cancellation.js';
import { listAgentRunCapsules } from '../capsules/store.js';
import { resolveRuntimePermission } from '../bridges/runtime-permission-bridge.js';
import type { MindOSSSEvent } from '../turn/index.js';
import {
  buildRuntimePermissionRequest,
  classifyLaneTerminalStatus,
  laneCapsuleRuntimeBinding,
  runRuntimeLaneTurn,
  runtimePermissionDecisionOption,
  type AgentTurnCapsuleSeed,
  type LaneRunResult,
  type LaneSession,
  type LaneSink,
  type LaneTurnRequest,
  type RuntimeLane,
  type RuntimeLaneTurnInput,
} from './lane-runner.js';

type FakeLaneOptions = {
  behavior?(session: LaneSession, turn: LaneTurnRequest, sink: LaneSink): Promise<LaneRunResult>;
  session?: Partial<LaneSession>;
};

function createFakeLane(options: FakeLaneOptions = {}) {
  const calls: string[] = [];
  const lane: RuntimeLane = {
    kind: 'codex',
    async open() {
      calls.push('open');
      return {
        kind: 'codex',
        runtimeId: 'codex',
        cwd: '/tmp/work',
        ...options.session,
      };
    },
    async run(session, turn, sink) {
      calls.push('run');
      if (options.behavior) return options.behavior(session, turn, sink);
      sink.send({ type: 'text_delta', delta: 'hello' });
      sink.send({ type: 'done' });
      return {};
    },
    async interrupt() {
      calls.push('interrupt');
    },
    async close(_session, opts) {
      calls.push(`close:${opts.keepExternalSession}`);
    },
  };
  return { lane, calls };
}

function capsuleSeed(mindRoot: string): AgentTurnCapsuleSeed {
  return {
    mindRoot,
    source: 'interactive',
    request: {
      messages: [{ role: 'user', content: 'do things' }],
      runtime: { kind: 'codex', id: 'codex', name: 'Codex' },
      runtimeBinding: null,
      context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] },
    },
    provenance: { cwd: '/tmp/work' },
  };
}

function baseInput(mindRoot: string): RuntimeLaneTurnInput {
  return {
    chatSessionId: 'chat-lane-runner',
    ledger: {
      agentKind: 'native-runtime',
      runtimeId: 'codex',
      displayName: 'Codex',
      permissionMode: 'ask',
      inputSummary: 'do things',
      metadata: { seed: 'start-metadata' },
    },
    capsule: capsuleSeed(mindRoot),
    modeContract: createMindosAgentModeContract({ mode: 'default', prompt: 'do things' }),
    completionMetadata: { completion: 'extra' },
    failureMetadata: { failure: 'extra' },
  };
}

function collectSend() {
  const frames: MindOSSSEvent[] = [];
  return { frames, send: (event: MindOSSSEvent) => frames.push(event) };
}

describe('runRuntimeLaneTurn', () => {
  let mindRoot = '';

  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-lane-runner-'));
    setMindRootResolverForTests(() => mindRoot);
    resetAgentRunsForTest();
  });

  afterEach(() => {
    resetAgentRunsForTest();
    setMindRootResolverForTests(null);
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('runs the lifecycle once: open → ledger start → capsule capture → context frame → run → complete + finalize + close', async () => {
    const { lane, calls } = createFakeLane();
    const { frames, send } = collectSend();

    await runRuntimeLaneTurn(lane, baseInput(mindRoot), send);

    expect(calls).toEqual(['open', 'run', 'close:true']);
    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('completed');
    expect(run.outputSummary).toBe('hello');
    expect(run.chatSessionId).toBe('chat-lane-runner');
    expect(run.metadata).toEqual(expect.objectContaining({ seed: 'start-metadata', completion: 'extra' }));
    // The first frame on the raw send is the run context; lane frames follow.
    expect(frames[0]).toEqual(expect.objectContaining({ type: 'agent_run_context', rootRunId: run.id }));
    expect(frames.slice(1).map((frame) => frame.type)).toEqual(['text_delta', 'done']);
    // Ledger timeline saw the streamed frames.
    expect(listAgentEvents({ runId: run.id }).length).toBeGreaterThan(0);

    const capsules = listAgentRunCapsules(mindRoot);
    expect(capsules).toHaveLength(1);
    expect(capsules[0]).toEqual(expect.objectContaining({
      runId: run.id,
      status: 'completed',
      result: { outputText: 'hello' },
    }));
  });

  it('skips open for a pre-opened session (Pi JSON init-error path)', async () => {
    const { lane, calls } = createFakeLane();
    const preOpened: LaneSession = { kind: 'mindos', runtimeId: 'mindos', cwd: '/tmp/work' };

    await runRuntimeLaneTurn(lane, { ...baseInput(mindRoot), session: preOpened }, collectSend().send);

    expect(calls).toEqual(['run', 'close:true']);
  });

  it('applies session archive, terminal metadata and capsule binding on completion', async () => {
    const { lane } = createFakeLane({
      behavior: async (session) => {
        session.externalSessionId = 'thr-1';
        session.archive = { sessionId: 'thr-1' };
        session.metadata = { externalSessionId: 'thr-1' };
        session.capsuleBinding = laneCapsuleRuntimeBinding({
          kind: 'codex',
          runtimeId: 'codex',
          externalSessionId: 'thr-1',
          cwd: '/tmp/work',
        });
        return { externalSessionId: 'thr-1' };
      },
    });

    await runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send);

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.archive).toEqual({ sessionId: 'thr-1' });
    expect(run.metadata).toEqual(expect.objectContaining({ externalSessionId: 'thr-1', completion: 'extra' }));
    const capsule = listAgentRunCapsules(mindRoot)[0]!;
    expect(capsule.request.runtimeBinding).toEqual(expect.objectContaining({
      type: 'codex-thread',
      externalSessionId: 'thr-1',
    }));
  });

  it('rejects a headless caller when a lane fails without emitting an error frame', async () => {
    const { lane } = createFakeLane({ behavior: async () => ({ error: new Error('runtime failed') }) });
    await expect(executeAgentTurn(lane, baseInput(mindRoot))).rejects.toThrow('runtime failed');
  });

  it('records a failure without rethrowing when the lane reports result.error', async () => {
    const { lane, calls } = createFakeLane({
      behavior: async (session, _turn, sink) => {
        sink.send({ type: 'text_delta', delta: 'partial' });
        session.metadata = { externalSessionId: 'thr-2' };
        session.archive = { sessionId: 'thr-2' };
        return { error: new Error('runtime said no'), externalSessionId: 'thr-2' };
      },
    });

    await expect(runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send)).resolves.toBeUndefined();

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('failed');
    expect(run.error).toBe('runtime said no');
    expect(run.outputSummary).toBe('partial');
    expect(run.archive).toEqual({ sessionId: 'thr-2' });
    expect(run.metadata).toEqual(expect.objectContaining({ failure: 'extra', externalSessionId: 'thr-2' }));
    expect(listAgentRunCapsules(mindRoot)[0]!.status).toBe('failed');
    expect(calls).toContain('close:false');
  });

  it('records a failure when a streamed error frame arrives without a result error (unified across lanes)', async () => {
    const { lane } = createFakeLane({
      behavior: async (_session, _turn, sink) => {
        sink.send({ type: 'error', message: 'streamed failure' });
        return {};
      },
    });

    await expect(runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send)).resolves.toBeUndefined();

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('failed');
    expect(run.error).toBe('streamed failure');
    expect(listAgentRunCapsules(mindRoot)[0]!.status).toBe('failed');
  });

  it('classifies an abort-like throw as canceled, records failure metadata and rethrows', async () => {
    const abortError = new Error('canceled by user');
    abortError.name = 'AbortError';
    const { lane } = createFakeLane({
      behavior: async () => {
        throw abortError;
      },
    });

    await expect(runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send)).rejects.toBe(abortError);

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('canceled');
    expect(run.metadata).toEqual(expect.objectContaining({ failure: 'extra' }));
    expect(listAgentRunCapsules(mindRoot)[0]!.status).toBe('canceled');
  });

  it('classifies a TIMEOUT throw as timed_out and rethrows', async () => {
    const timeoutError = Object.assign(new Error('turn timed out'), { code: 'TIMEOUT' });
    const { lane } = createFakeLane({ behavior: async () => { throw timeoutError; } });

    await expect(runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send)).rejects.toBe(timeoutError);
    expect(listAgentRuns({ kind: 'native-runtime' })[0]!.status).toBe('timed_out');
  });

  it('aborts the caller-owned signal through the ledger cancel handler and records canceled', async () => {
    const { lane } = createFakeLane({
      behavior: async (_session, turn, sink) => {
        const runId = sink.runContext.parentRunId!;
        const aborted = new Promise<void>((resolve) => {
          turn.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        void Promise.resolve().then(() => {
          void cancelAgentRunWithHandlers(runId, { reason: 'explicit user cancel' });
        });
        await aborted;
        const reason = turn.signal.reason;
        return { error: reason instanceof Error ? reason : new Error('aborted') };
      },
    });

    await expect(runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send)).resolves.toBeUndefined();

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('canceled');
    expect(run.error).toContain('explicit user cancel');
  });

  it('arms the disconnect grace port with the run identity and releases it at the end', async () => {
    const armCalls: Array<{ runId: string; rootRunId: string; requestSignal: AbortSignal }> = [];
    const release = vi.fn();
    const requestSignal = new AbortController().signal;
    const { lane } = createFakeLane({
      behavior: async (_session, _turn, sink) => {
        expect(armCalls[0]?.runId).toBe(sink.runContext.parentRunId);
        return {};
      },
    });

    await runRuntimeLaneTurn(
      lane,
      { ...baseInput(mindRoot), requestSignal, disconnect: { arm: (input) => { armCalls.push(input); return release; } } },
      collectSend().send,
    );

    expect(armCalls).toHaveLength(1);
    expect(armCalls[0]!.requestSignal).toBe(requestSignal);
    expect(armCalls[0]!.rootRunId).toBe(armCalls[0]!.runId);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('registers the turn deadline for the bridge run and pauses it while a permission request is pending', async () => {
    const observed: { pausedDuringWait?: boolean; resumedAfter?: boolean; decision?: string } = {};
    const { lane } = createFakeLane({
      behavior: async (_session, _turn, sink) => {
        const pending = sink.requestPermission(
          buildRuntimePermissionRequest({
            runtime: 'codex',
            toolCallId: 'tool-1',
            toolName: 'Bash',
            input: { command: 'ls' },
          }),
          { requestId: 'lane-req-1' },
        );
        await Promise.resolve();
        const { getTurnDeadlineForRun } = await import('../turn/turn-deadline.js');
        const deadline = getTurnDeadlineForRun(sink.permissionRunId);
        observed.pausedDuringWait = deadline?.isPaused();
        resolveRuntimePermission({ runId: sink.permissionRunId, requestId: 'lane-req-1', decision: 'acceptForSession' });
        const result = await pending;
        observed.resumedAfter = deadline ? !deadline.isPaused() : undefined;
        observed.decision = result.decision;
        return {};
      },
    });

    await runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send);

    expect(observed.pausedDuringWait).toBe(true);
    expect(observed.resumedAfter).toBe(true);
    expect(observed.decision).toBe('acceptForSession');
  });

  it('fails the run and rethrows when capsule capture fails, without running the lane', async () => {
    // A regular file as mind root makes mkdir (and thus capsule creation) fail.
    const filePath = path.join(mindRoot, 'not-a-dir');
    fs.writeFileSync(filePath, 'x');
    const { lane, calls } = createFakeLane();
    const input = baseInput(mindRoot);

    await expect(runRuntimeLaneTurn(
      lane,
      { ...input, capsule: { ...input.capsule, mindRoot: filePath } },
      collectSend().send,
    )).rejects.toThrow(/could not create a recovery capsule/i);

    expect(calls).toEqual(['open', 'close:false']);
    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('failed');
    expect(run.metadata).toEqual(expect.objectContaining({ capsuleCapture: 'failed' }));
  });

  it('degrades to a CAPSULE_FINALIZE_FAILED timeline event when finalize cannot persist', async () => {
    const { lane } = createFakeLane({
      behavior: async (_session, _turn, sink) => {
        // Remove the capsule file behind the store's back so finalize fails.
        const runId = sink.runContext.parentRunId!;
        const capsuleDir = path.join(fs.realpathSync(mindRoot), '.mindos', 'agent-run-capsules');
        for (const entry of fs.readdirSync(capsuleDir, { recursive: true })) {
          const full = path.join(capsuleDir, String(entry));
          if (fs.statSync(full).isFile() && full.includes(runId)) fs.rmSync(full);
        }
        return {};
      },
    });

    await runRuntimeLaneTurn(lane, baseInput(mindRoot), collectSend().send);

    const run = listAgentRuns({ kind: 'native-runtime' })[0]!;
    expect(run.status).toBe('completed');
    const degradeEvent = listAgentEvents({ runId: run.id }).find(
      (event) => (event.data as { code?: string } | undefined)?.code === 'CAPSULE_FINALIZE_FAILED',
    );
    expect(degradeEvent).toBeDefined();
    expect(getAgentRun(run.id)?.status).toBe('completed');
  });
});

describe('classifyLaneTerminalStatus', () => {
  it('prefers cancel when the signal aborted or the error is abort-like', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyLaneTerminalStatus(new Error('whatever'), controller.signal)).toBe('canceled');
    const abortError = new Error('stopped');
    abortError.name = 'AbortError';
    expect(classifyLaneTerminalStatus(abortError)).toBe('canceled');
  });

  it('maps TIMEOUT-coded errors to timed_out and everything else to failed', () => {
    expect(classifyLaneTerminalStatus(Object.assign(new Error('t'), { code: 'TIMEOUT' }))).toBe('timed_out');
    expect(classifyLaneTerminalStatus(new Error('boom'))).toBe('failed');
    expect(classifyLaneTerminalStatus('string failure')).toBe('failed');
  });
});

describe('buildRuntimePermissionRequest (single-source shaping)', () => {
  it('shapes the standard three-option set for every runtime source', () => {
    for (const runtime of ['codex', 'claude', 'acp'] as const) {
      const request = buildRuntimePermissionRequest({
        runtime,
        toolCallId: 'tc-1',
        toolName: 'Bash',
        input: { command: 'ls' },
      });
      expect(request.runtime).toBe(runtime);
      expect(request.options).toEqual([
        { id: 'accept', label: 'Allow once', description: 'Run this action one time.', intent: 'allow', scope: 'once' },
        { id: 'acceptForSession', label: 'Allow for session', description: 'Allow matching actions for the rest of this session.', intent: 'allow', scope: 'session' },
        { id: 'decline', label: 'Deny', description: 'Reject this action.', intent: 'deny' },
      ]);
    }
  });

  it('drops acceptForSession when the runtime has no session-scope support', () => {
    const request = buildRuntimePermissionRequest({
      runtime: 'claude',
      toolCallId: 'tc-2',
      toolName: 'Write',
      input: {},
      allowSessionScope: false,
    });
    expect(request.options.map((option) => option.id)).toEqual(['accept', 'decline']);
  });

  it('passes through reason, action, resource and risk', () => {
    const risk = { level: 'high' as const, summary: 'danger', reasons: ['rm'] };
    const request = buildRuntimePermissionRequest({
      runtime: 'codex',
      toolCallId: 'tc-3',
      toolName: 'Bash',
      input: {},
      reason: 'because',
      action: 'command',
      resource: 'rm -rf /tmp/x',
      risk,
    });
    expect(request).toEqual(expect.objectContaining({ reason: 'because', action: 'command', resource: 'rm -rf /tmp/x', risk }));
  });

  it('maps known decision ids and degrades unknown ids to bare options', () => {
    expect(runtimePermissionDecisionOption('acceptForSession')).toEqual({
      id: 'acceptForSession',
      label: 'Allow for session',
      description: 'Allow matching actions for the rest of this session.',
      intent: 'allow',
      scope: 'session',
    });
    expect(runtimePermissionDecisionOption('approve_once')).toEqual({ id: 'approve_once', label: 'approve_once' });
  });
});
