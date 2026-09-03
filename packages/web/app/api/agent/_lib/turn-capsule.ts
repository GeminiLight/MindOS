import {
  createAgentRunCapsule,
  finalizeAgentRunCapsule,
  type AgentRunCapsuleProvenance,
  type AgentRunCapsuleRequest,
  type AgentRunCapsuleRuntimeBinding,
  type AgentRunCapsuleSource,
  type AgentRunCapsuleStatus,
} from '@geminilight/mindos/agent';
import { appendAgentRunEvent, failAgentRun, type AgentRunRecord } from '@geminilight/mindos/agent/ledger/run-ledger';

export type AgentTurnCapsuleSeed = {
  runId?: string;
  mindRoot: string;
  source: AgentRunCapsuleSource;
  request: AgentRunCapsuleRequest;
  provenance: AgentRunCapsuleProvenance;
};

export function captureAgentTurnCapsule(
  run: AgentRunRecord,
  seed: AgentTurnCapsuleSeed,
  requestPatch: Partial<Pick<AgentRunCapsuleRequest, 'model' | 'thinkingEffort' | 'runtimeBinding'>> = {},
): void {
  try {
    createAgentRunCapsule(seed.mindRoot, {
      id: run.id,
      runId: run.id,
      rootRunId: run.rootRunId ?? run.id,
      ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
      source: seed.source,
      request: { ...seed.request, ...requestPatch },
      provenance: seed.provenance,
      status: run.status,
    });
  } catch (error) {
    failAgentRun(run.id, {
      error,
      metadata: { capsuleCapture: 'failed' },
    });
    throw new Error(
      `MindOS could not create a recovery capsule before starting the run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function finalizeAgentTurnCapsule(input: {
  mindRoot: string;
  runId: string;
  status: AgentRunCapsuleStatus;
  runtimeBinding?: AgentRunCapsuleRuntimeBinding | null;
  outputText?: string;
}): void {
  try {
    finalizeAgentRunCapsule(input.mindRoot, input.runId, {
      status: input.status,
      ...(input.runtimeBinding !== undefined ? { runtimeBinding: input.runtimeBinding } : {}),
      ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
    });
  } catch (error) {
    const message = `Run recovery capsule could not be finalized: ${error instanceof Error ? error.message : String(error)}`;
    appendAgentRunEvent(input.runId, {
      type: 'error',
      category: 'error',
      message,
      data: { kind: 'error', message, code: 'CAPSULE_FINALIZE_FAILED', recoverable: true },
      visibility: 'timeline',
      metadata: { capsuleCoverage: 'degraded' },
    });
    console.error(`[agent-turn] ${message}`);
  }
}

export function capsuleRuntimeBinding(input: {
  kind: AgentRunCapsuleRuntimeBinding['runtime'];
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: AgentRunCapsuleRuntimeBinding['status'];
  updatedAt?: number;
}): AgentRunCapsuleRuntimeBinding | null {
  const externalSessionId = input.externalSessionId?.trim();
  if (!externalSessionId) return null;
  const type = input.kind === 'mindos'
    ? 'mindos-pi-session'
    : input.kind === 'codex'
      ? 'codex-thread'
      : input.kind === 'claude'
        ? 'claude-session'
        : 'acp-session';
  return {
    type,
    runtime: input.kind,
    runtimeId: input.runtimeId,
    externalSessionId,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    status: input.status ?? 'active',
    updatedAt: input.updatedAt ?? Date.now(),
  };
}
