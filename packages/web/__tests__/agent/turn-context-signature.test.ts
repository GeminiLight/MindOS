/**
 * Context-omission signature keyed on the runtime session
 * (spec-runtime-lane-correctness, item 3). The session/file context may only
 * be omitted when a completed run on the same runtime and the same external
 * session already carried the identical signature; switching runtimes, a
 * failed spawn, or a fresh native session must re-send WorkDir / Spaces /
 * attachments.
 */
import { describe, expect, it } from 'vitest';
import type { AgentRunRecord } from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  shouldInjectFileContext,
  shouldInjectSessionContext,
  type ContextSignatureTarget,
} from '@/app/api/agent/_lib/turn-context';

const SIGNATURE = JSON.stringify({ workDir: '/work', spaces: ['Research'] });
const FILE_SIGNATURE = JSON.stringify({ files: [{ path: 'a.md', hash: 'h1' }], failed: [] });

function run(input: {
  runtimeId: string;
  status?: AgentRunRecord['status'];
  externalSessionId?: string;
  sessionContextSignature?: string;
  fileContextSignature?: string;
  startedAt?: number;
}): AgentRunRecord {
  return {
    id: `run-${Math.random().toString(36).slice(2)}`,
    rootRunId: undefined,
    parentRunId: undefined,
    chatSessionId: 'chat-1',
    agentKind: input.runtimeId === 'mindos' ? 'mindos-main' : 'native-runtime',
    runtimeId: input.runtimeId,
    displayName: input.runtimeId,
    cwd: '/work',
    permissionMode: 'ask',
    status: input.status ?? 'completed',
    startedAt: input.startedAt ?? 1,
    inputSummary: 'prompt',
    metadata: {
      ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
      ...(input.sessionContextSignature ? { sessionContextSignature: input.sessionContextSignature } : {}),
      ...(input.fileContextSignature ? { fileContextSignature: input.fileContextSignature } : {}),
    },
  } as unknown as AgentRunRecord;
}

const codexThread: ContextSignatureTarget = { runtimeId: 'codex', externalSessionId: 'thr_1' };
const pi: ContextSignatureTarget = { runtimeId: 'mindos', resumesChatSession: true };

describe('shouldInjectSessionContext', () => {
  it('always injects without a signature or outside a chat session', () => {
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: null, priorRuns: [], target: codexThread })).toBe(false);
    expect(shouldInjectSessionContext({ chatSessionId: undefined, signature: SIGNATURE, priorRuns: [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })], target: codexThread })).toBe(true);
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns: [], target: codexThread })).toBe(true);
  });

  it('omits the context when the same runtime session already completed a run with the same signature', () => {
    const priorRuns = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(false);
  });

  it('re-sends the context after switching runtimes', () => {
    const priorRuns = [run({ runtimeId: 'mindos', externalSessionId: 'pi-1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(true);
  });

  it('re-sends the context when the previous run on the same session failed, was canceled or timed out', () => {
    for (const status of ['failed', 'canceled', 'timed_out', 'running'] as const) {
      const priorRuns = [run({ runtimeId: 'codex', status, externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })];
      expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(true);
    }
  });

  it('looks past a failed run to an earlier completed run on the same session', () => {
    const priorRuns = [
      run({ runtimeId: 'codex', status: 'failed', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE, startedAt: 2 }),
      run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE, startedAt: 1 }),
    ];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(false);
  });

  it('re-sends the context for a fresh native session or a different external session', () => {
    const priorRuns = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: { runtimeId: 'codex' } })).toBe(true);
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: { runtimeId: 'codex', externalSessionId: 'thr_2' } })).toBe(true);
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: { runtimeId: 'codex', externalSessionId: '' } })).toBe(true);
  });

  it('re-sends the context when the signature changed on the same session', () => {
    const priorRuns = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: 'old' })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(true);
  });

  it('matches embedded Pi runs by chat session because the runtime session is resumed server-side', () => {
    const priorRuns = [run({ runtimeId: 'mindos', externalSessionId: 'pi-1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: pi })).toBe(false);
    const failedPi = [run({ runtimeId: 'mindos', status: 'failed', externalSessionId: 'pi-1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns: failedPi, target: pi })).toBe(true);
    const codexRuns = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns: codexRuns, target: pi })).toBe(true);
  });

  it('ignores runs without a signature and unrelated runtimes when scanning for the latest signature', () => {
    const priorRuns = [
      run({ runtimeId: 'codex', externalSessionId: 'thr_1', startedAt: 3 }),
      run({ runtimeId: 'claude', externalSessionId: 'thr_1', sessionContextSignature: 'other', startedAt: 2 }),
      run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE, startedAt: 1 }),
    ];
    expect(shouldInjectSessionContext({ chatSessionId: 'chat-1', signature: SIGNATURE, priorRuns, target: codexThread })).toBe(false);
  });
});

describe('shouldInjectFileContext', () => {
  it('applies the same runtime-session keying to attached file context', () => {
    const same = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', fileContextSignature: FILE_SIGNATURE })];
    expect(shouldInjectFileContext({ chatSessionId: 'chat-1', signature: FILE_SIGNATURE, priorRuns: same, target: codexThread })).toBe(false);

    const otherRuntime = [run({ runtimeId: 'mindos', externalSessionId: 'pi-1', fileContextSignature: FILE_SIGNATURE })];
    expect(shouldInjectFileContext({ chatSessionId: 'chat-1', signature: FILE_SIGNATURE, priorRuns: otherRuntime, target: codexThread })).toBe(true);

    const failed = [run({ runtimeId: 'codex', status: 'failed', externalSessionId: 'thr_1', fileContextSignature: FILE_SIGNATURE })];
    expect(shouldInjectFileContext({ chatSessionId: 'chat-1', signature: FILE_SIGNATURE, priorRuns: failed, target: codexThread })).toBe(true);

    expect(shouldInjectFileContext({ chatSessionId: 'chat-1', signature: null, priorRuns: same, target: codexThread })).toBe(false);
    expect(shouldInjectFileContext({ chatSessionId: undefined, signature: FILE_SIGNATURE, priorRuns: same, target: codexThread })).toBe(true);
  });
});
