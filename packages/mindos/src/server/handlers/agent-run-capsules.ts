import {
  createAgentRunCapsuleRecoveryPlan,
  getAgentRunCapsule,
  listAgentRunCapsules,
  projectAgentRunCapsule,
} from '../../agent/capsules/store.js';
import type { AgentRunCapsuleRecoveryAction } from '../../agent/capsules/types.js';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

const RECOVERY_ACTIONS = new Set<AgentRunCapsuleRecoveryAction>(['retry', 'fork', 'resume', 'rollback']);

export type AgentRunCapsuleHandlerServices = {
  mindRoot: string;
  now?(): Date;
};

export function handleAgentRunCapsulesGet(
  searchParams: URLSearchParams,
  services: AgentRunCapsuleHandlerServices,
): MindosServerResponse<unknown> {
  try {
    const runId = boundedText(searchParams.get('runId'), 160);
    const rootRunId = boundedText(searchParams.get('rootRunId'), 160);
    const chatSessionId = boundedText(searchParams.get('chatSessionId'), 160);
    const status = boundedText(searchParams.get('status'), 32);
    const limit = parseLimit(searchParams.get('limit'));
    const capsules = listAgentRunCapsules(services.mindRoot)
      .filter((capsule) => !runId || capsule.runId === runId)
      .filter((capsule) => !rootRunId || capsule.rootRunId === rootRunId)
      .filter((capsule) => !chatSessionId || capsule.chatSessionId === chatSessionId)
      .filter((capsule) => !status || capsule.status === status)
      .slice(0, limit)
      .map(projectAgentRunCapsule);
    return json({
      schemaVersion: 1,
      capsules,
      summary: {
        total: capsules.length,
        recoverable: capsules.filter((capsule) => capsule.recovery.retry.supported).length,
        resumable: capsules.filter((capsule) => capsule.recovery.resume.supported).length,
        rollbackReady: capsules.filter((capsule) => capsule.recovery.rollback.supported).length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAgentRunCapsuleRecoveryPost(
  capsuleId: string,
  body: unknown,
  services: AgentRunCapsuleHandlerServices,
): MindosServerResponse<unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Expected an object payload.' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const action = typeof record.action === 'string' && RECOVERY_ACTIONS.has(record.action as AgentRunCapsuleRecoveryAction)
    ? record.action as AgentRunCapsuleRecoveryAction
    : null;
  const idempotencyKey = typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : '';
  if (!action || !idempotencyKey) {
    return json({ error: 'Recovery requires action and idempotencyKey.' }, { status: 400 });
  }
  try {
    if (!getAgentRunCapsule(services.mindRoot, capsuleId)) {
      return json({ error: `Agent run capsule not found: ${capsuleId}` }, { status: 404 });
    }
    const plan = createAgentRunCapsuleRecoveryPlan(services.mindRoot, capsuleId, {
      action,
      idempotencyKey,
      now: services.now?.() ?? new Date(),
    });
    return json({ schemaVersion: 1, plan }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not supported|no reusable runtime session|no checkpoint artifact|no verified rollback executor|different action/i.test(message)) {
      return json({ error: message }, { status: 409 });
    }
    return errorResponse(error);
  }
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : 100;
}

function boundedText(value: string | null, max: number): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}
