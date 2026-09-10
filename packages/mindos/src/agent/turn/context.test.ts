import { describe, expect, it } from 'vitest';
import type { AgentRunRecord } from '../ledger/run-ledger-types.js';
import type { MindosAgentFileContext } from './index.js';
import {
  createMindosFileContextSignature,
  fileContextForPrompt,
  fileContextRunMetadata,
  sessionContextRunMetadata,
  shouldInjectFileContext,
  shouldInjectSessionContext,
  type ContextSignatureTarget,
} from './context.js';

function run(input: {
  runtimeId: string;
  status?: AgentRunRecord['status'];
  externalSessionId?: string;
  sessionContextSignature?: string;
  fileContextSignature?: string;
}): AgentRunRecord {
  return {
    id: `run-${Math.random().toString(36).slice(2)}`,
    rootRunId: undefined,
    parentRunId: undefined,
    chatSessionId: undefined,
    agentKind: 'native-runtime',
    runtimeId: input.runtimeId,
    displayName: input.runtimeId,
    status: input.status ?? 'completed',
    startedAt: Date.now(),
    metadata: {
      ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
      ...(input.sessionContextSignature ? { sessionContextSignature: input.sessionContextSignature } : {}),
      ...(input.fileContextSignature ? { fileContextSignature: input.fileContextSignature } : {}),
    },
  } as unknown as AgentRunRecord;
}

const TARGET: ContextSignatureTarget = { runtimeId: 'codex', externalSessionId: 'thr_1' };
const SIGNATURE = 'sig-a';

describe('shouldInjectSessionContext', () => {
  it('never injects without a signature and always injects without a chat session', () => {
    expect(shouldInjectSessionContext({ signature: null, priorRuns: [], target: TARGET })).toBe(false);
    expect(shouldInjectSessionContext({ signature: SIGNATURE, priorRuns: [], target: TARGET })).toBe(true);
  });

  it('omits the context only after a completed run on the same runtime session carried the same signature', () => {
    const prior = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })];
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat', signature: SIGNATURE, priorRuns: prior, target: TARGET,
    })).toBe(false);
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat', signature: 'sig-b', priorRuns: prior, target: TARGET,
    })).toBe(true);
  });

  it('re-injects after a failed run, a runtime switch, or a fresh external session', () => {
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat',
      signature: SIGNATURE,
      priorRuns: [run({ runtimeId: 'codex', status: 'failed', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })],
      target: TARGET,
    })).toBe(true);
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat',
      signature: SIGNATURE,
      priorRuns: [run({ runtimeId: 'claude', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })],
      target: TARGET,
    })).toBe(true);
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat',
      signature: SIGNATURE,
      priorRuns: [run({ runtimeId: 'codex', externalSessionId: 'thr_2', sessionContextSignature: SIGNATURE })],
      target: TARGET,
    })).toBe(true);
  });

  it('keys the embedded Pi lane on the chat session because it carries no binding', () => {
    const piTarget: ContextSignatureTarget = { runtimeId: 'mindos', resumesChatSession: true };
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat',
      signature: SIGNATURE,
      priorRuns: [run({ runtimeId: 'mindos', sessionContextSignature: SIGNATURE })],
      target: piTarget,
    })).toBe(false);
    // A native run bound to an external session never satisfies a binding-less target.
    expect(shouldInjectSessionContext({
      chatSessionId: 'chat',
      signature: SIGNATURE,
      priorRuns: [run({ runtimeId: 'codex', externalSessionId: 'thr_1', sessionContextSignature: SIGNATURE })],
      target: { runtimeId: 'codex' },
    })).toBe(true);
  });
});

describe('file context signatures', () => {
  const context: MindosAgentFileContext = {
    contextParts: ['### Attached file: a.md\n\ntext'],
    failedFiles: ['z.md', 'b.md'],
    fileReferences: [
      { path: 'a.md', label: 'attached', contentHash: 'h1', size: 4 },
      { path: 'cur.md', label: 'current' },
    ],
    mode: 'full',
  };

  it('builds a stable signature with sorted failures and null placeholders', () => {
    const signature = createMindosFileContextSignature(context);
    expect(signature).toBe(JSON.stringify({
      files: [
        { label: 'attached', path: 'a.md', hash: 'h1', size: 4 },
        { label: 'current', path: 'cur.md', hash: null, size: null },
      ],
      failed: ['b.md', 'z.md'],
    }));
  });

  it('returns null for an empty context so nothing is injected or recorded', () => {
    expect(createMindosFileContextSignature({ contextParts: [], failedFiles: [] })).toBeNull();
  });

  it('omits unchanged files only for a completed run on the same runtime session', () => {
    const signature = createMindosFileContextSignature(context);
    const prior = [run({ runtimeId: 'codex', externalSessionId: 'thr_1', fileContextSignature: signature ?? undefined })];
    expect(shouldInjectFileContext({ chatSessionId: 'chat', signature, priorRuns: prior, target: TARGET })).toBe(false);
    expect(shouldInjectFileContext({ chatSessionId: 'chat', signature, priorRuns: [], target: TARGET })).toBe(true);
  });

  it('switches the prompt context to reference mode without full content', () => {
    const reference = fileContextForPrompt(context, false);
    expect(reference.mode).toBe('reference');
    expect(reference.contextParts).toEqual([]);
    expect(reference.fileReferences).toEqual(context.fileReferences);
    expect(fileContextForPrompt(context, true)).toEqual({ ...context, mode: 'full' });
  });
});

describe('run metadata projections', () => {
  it('records signature and injection flag only when a signature exists', () => {
    expect(sessionContextRunMetadata(null, true)).toEqual({});
    expect(sessionContextRunMetadata('sig', false)).toEqual({
      sessionContextSignature: 'sig',
      sessionContextInjected: false,
    });
  });

  it('records file context paths alongside the file signature', () => {
    const context: MindosAgentFileContext = {
      contextParts: [],
      failedFiles: [],
      fileReferences: [{ path: 'a.md', label: 'attached' }],
    };
    expect(fileContextRunMetadata(null, true, context)).toEqual({});
    expect(fileContextRunMetadata('fsig', true, context)).toEqual({
      fileContextSignature: 'fsig',
      fileContextInjected: true,
      fileContextPaths: ['a.md'],
    });
  });
});
