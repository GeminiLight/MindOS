/**
 * Server-side assembly of the pending-actions payload
 * (spec-cross-process-run-events D). SERVER ONLY — imports bridges, the
 * cross-process prompt store and the automation state; clients must use the
 * pure `pending-actions.ts` projection instead.
 *
 * Sources, in precedence order:
 * 1. This process's in-memory bridge maps (freshest, authoritative for runs
 *    this host executes).
 * 2. Open rows in the shared pending-prompt store written by OTHER processes
 *    (dead owners and expired rows are already filtered by the store read).
 * 3. Durable automation approvals from `<mindRoot>/.mindos/automations/state.json`.
 *
 * The union is deduplicated by prompt key (in-process wins) and then run
 * through the one shared normalization so every host answers identically.
 */

import {
  listPendingRuntimePermissions,
  type PendingRuntimePermissionSnapshot,
} from '../../agent/bridges/runtime-permission-bridge.js';
import {
  listPendingAskUserQuestions,
  type PendingAskUserQuestionSnapshot,
} from '../../agent/bridges/user-question-bridge.js';
import { listOpenPendingPrompts } from '../../agent/bridges/pending-prompt-store.js';
import { readStudioAutomationState } from '../automations/store.js';
import {
  normalizePendingAgentActions,
  type PendingAutomationApprovalAction,
  type PendingAgentActionsPayload,
} from './pending-actions.js';

export type PendingAgentActionsSourceServices = {
  mindRoot?: string;
  /** Epoch ms used for expiry filtering and `generatedAt`. Defaults to Date.now(). */
  now?: number;
};

export function buildPendingAgentActionsPayload(
  services: PendingAgentActionsSourceServices = {},
): PendingAgentActionsPayload {
  const now = services.now ?? Date.now();
  const permissions: PendingRuntimePermissionSnapshot[] = [...listPendingRuntimePermissions()];
  const questions: PendingAskUserQuestionSnapshot[] = [...listPendingAskUserQuestions()];
  const seen = new Set<string>([
    ...permissions.map((permission) => `runtime-permission:${permission.runId}:${permission.requestId}`),
    ...questions.map((question) => `user-question:${question.runId}:${question.toolCallId}`),
  ]);
  try {
    for (const row of listOpenPendingPrompts(now)) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      if (row.snapshot.kind === 'runtime-permission') permissions.push(row.snapshot);
      else questions.push(row.snapshot);
    }
  } catch {
    // The store is best-effort; in-process prompts are still served.
  }
  const automationApprovals = projectAutomationApprovals(services.mindRoot);
  return normalizePendingAgentActions(
    { permissions, questions, automationApprovals, generatedAt: now },
    now,
  );
}

function projectAutomationApprovals(mindRoot: string | undefined): PendingAutomationApprovalAction[] {
  if (!mindRoot) return [];
  try {
    const state = readStudioAutomationState(mindRoot);
    const jobs = new Map(state.automations.map((job) => [job.id, job]));
    return state.approvals
      .filter((approval) => approval.status === 'pending')
      .map((approval) => ({
        kind: 'automation-approval' as const,
        approvalId: approval.id,
        jobId: approval.jobId,
        ...(approval.runId ? { runId: approval.runId } : {}),
        jobTitle: jobs.get(approval.jobId)?.title ?? 'Automation',
        runtime: approval.runtime,
        toolName: approval.toolName,
        ...(approval.action ? { action: approval.action } : {}),
        ...(approval.resource ? { resource: approval.resource } : {}),
        ...(approval.inputPreview ? { inputPreview: approval.inputPreview } : {}),
        ...(approval.risk ? { risk: approval.risk } : {}),
        createdAt: new Date(approval.createdAt).getTime(),
      }))
      .sort((left, right) => left.createdAt - right.createdAt || left.approvalId.localeCompare(right.approvalId));
  } catch {
    return [];
  }
}
