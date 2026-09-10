import type { AgentRunRecord } from '../ledger/run-ledger-types.js';
import type { MindosAgentFileContext } from './index.js';

/**
 * Context-omission signatures for one agent turn (spec-runtime-lane-correctness
 * item 3, moved from packages/web/app/api/agent/_lib/turn-context.ts so both
 * hosts share one implementation — spec-runtime-lane-contract).
 *
 * The runtime session the current turn will talk to decides whether the
 * session/file context may be omitted: only a completed prior run on the same
 * `runtimeId` bound to the same external session proves the context was
 * already delivered. Lanes that resume their runtime session from the chat
 * session itself (embedded Pi) set `resumesChatSession` because the request
 * carries no binding.
 */

export type ContextSignatureTarget = {
  runtimeId: string;
  externalSessionId?: string;
  resumesChatSession?: boolean;
};

export function shouldInjectSessionContext(input: {
  chatSessionId?: string;
  signature: string | null;
  priorRuns: AgentRunRecord[];
  target: ContextSignatureTarget;
}): boolean {
  if (!input.signature) return false;
  if (!input.chatSessionId) return true;
  return latestContextSignature(input.priorRuns, 'sessionContextSignature', input.target) !== input.signature;
}

export function shouldInjectFileContext(input: {
  chatSessionId?: string;
  signature: string | null;
  priorRuns: AgentRunRecord[];
  target: ContextSignatureTarget;
}): boolean {
  if (!input.signature) return false;
  if (!input.chatSessionId) return true;
  return latestContextSignature(input.priorRuns, 'fileContextSignature', input.target) !== input.signature;
}

export function sessionContextRunMetadata(signature: string | null, injected: boolean): Record<string, unknown> {
  return signature
    ? {
      sessionContextSignature: signature,
      sessionContextInjected: injected,
    }
    : {};
}

export function fileContextRunMetadata(
  signature: string | null,
  injected: boolean,
  context: MindosAgentFileContext,
): Record<string, unknown> {
  return signature
    ? {
      fileContextSignature: signature,
      fileContextInjected: injected,
      fileContextPaths: (context.fileReferences ?? []).map((file) => file.path),
    }
    : {};
}

export function createMindosFileContextSignature(context: MindosAgentFileContext): string | null {
  const references = context.fileReferences ?? [];
  if (references.length === 0 && context.failedFiles.length === 0) return null;
  return JSON.stringify({
    files: references.map((file) => ({
      label: file.label,
      path: file.path,
      hash: file.contentHash ?? null,
      size: file.size ?? null,
    })),
    failed: [...context.failedFiles].sort(),
  });
}

export function fileContextForPrompt(context: MindosAgentFileContext, injectFull: boolean): MindosAgentFileContext {
  if (injectFull) return { ...context, mode: 'full' };
  return {
    ...context,
    mode: 'reference',
    contextParts: [],
  };
}

function runBelongsToContextTarget(run: AgentRunRecord, target: ContextSignatureTarget): boolean {
  // Only a completed run proves the runtime session saw the context; a
  // failed spawn or a canceled turn may never have delivered the prompt.
  if (run.status !== 'completed') return false;
  if (run.runtimeId !== target.runtimeId) return false;
  if (target.resumesChatSession) return true;
  if (!target.externalSessionId) return false;
  return run.metadata?.externalSessionId === target.externalSessionId;
}

function latestContextSignature(
  runs: AgentRunRecord[],
  key: 'sessionContextSignature' | 'fileContextSignature',
  target: ContextSignatureTarget,
): string | null {
  for (const run of runs) {
    if (!runBelongsToContextTarget(run, target)) continue;
    const signature = run.metadata?.[key];
    if (typeof signature === 'string' && signature) return signature;
  }
  return null;
}
