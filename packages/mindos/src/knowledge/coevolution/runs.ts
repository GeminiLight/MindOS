import fs from 'node:fs';
import { effectiveMindRoot } from '../../foundation/mind-root/index.js';
import { listKnowledgeAgentRuns } from '../agent-run-data.js';
import {
  coevolutionRunSchema,
  coevolutionTextHash,
  coevolutionReceiptSchema,
  type CoevolutionEvidence,
  type CoevolutionTask,
  type CoevolutionRun,
} from './model.js';
import { fail } from './storage.js';
import { coevolutionRunOutput } from './output.js';

export function coevolutionRuns(
  root: string,
  task: CoevolutionTask,
): CoevolutionRun[] {
  const result = new Map(task.runs.map((run) => [run.runId, run]));
  const sessions = new Map<string, string>();
  for (const preparation of task.preparations) {
    if (
      preparation.chatSessionId &&
      (!sessions.has(preparation.chatSessionId) ||
        preparation.preparedAt < sessions.get(preparation.chatSessionId)!)
    )
      sessions.set(preparation.chatSessionId, preparation.preparedAt);
  }
  if (
    !sessions.size ||
    fs.realpathSync(root) !== fs.realpathSync(effectiveMindRoot())
  )
    return [...result.values()];
  for (const run of listKnowledgeAgentRuns({ limit: 1000 })) {
    if (result.has(run.id) || !run.chatSessionId) continue;
    const since = sessions.get(run.chatSessionId);
    if (!since || run.startedAt < Date.parse(since)) continue;
    const output = coevolutionRunOutput(root, run);
    const receipt = coevolutionReceiptSchema.safeParse(run.metadata?.coevolutionReceipt);
    const parsed = coevolutionRunSchema.safeParse({
      runId: run.id,
      chatSessionId: run.chatSessionId,
      runtimeId: run.runtimeId,
      model:
        typeof run.metadata?.model === 'string'
          ? run.metadata.model
          : undefined,
      status: run.status,
      output,
      error: run.error?.slice(0, 5000),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      capturedAt: new Date().toISOString(),
      outputHash: coevolutionTextHash(output),
      ...(receipt.success && receipt.data.taskId === task.id ? { collaboration: receipt.data } : {}),
    });
    if (parsed.success) result.set(run.id, parsed.data);
  }
  return [...result.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 100);
}
export function validateTaskEvidence(
  root: string,
  task: CoevolutionTask,
  evidence: CoevolutionEvidence,
  timing: { completedAfter?: string; startedAfter?: string } = {},
) {
  if (evidence.kind === 'manual') return;
  const run = coevolutionRuns(root, task).find(
    (run) => run.runId === evidence.runId,
  );
  if (
    !run ||
    run.status !== 'completed' ||
    !run.completedAt ||
    run.error ||
    !run.output.includes(evidence.quote) ||
    (timing.completedAfter && run.completedAt < Date.parse(timing.completedAfter)) ||
    (timing.startedAfter && run.startedAt < Date.parse(timing.startedAfter))
  )
    fail(
      'conflict',
      'Quote an actual completed run from this task, after the relevant decision or trial started.',
    );
  if (!task.runs.some((saved) => saved.runId === run.runId))
    task.runs.push(run);
}
export function assertTaskAgent(
  root: string,
  task: CoevolutionTask,
  actor: { runId: string; chatSessionId: string },
) {
  if (task.chatSessionId !== actor.chatSessionId || task.archived)
    fail('conflict', 'This Agent session is not bound to the active task.');
  if (fs.realpathSync(root) !== fs.realpathSync(effectiveMindRoot()))
    fail(
      'conflict',
      'Open the corresponding knowledge base before using this task.',
    );
  const run = listKnowledgeAgentRuns({ limit: 1000 }).find(
    (r) => r.id === actor.runId && r.chatSessionId === actor.chatSessionId,
  );
  if (
    !run ||
    !['running', 'streaming'].includes(run.status) ||
    run.startedAt < Date.parse(task.createdAt)
  )
    fail('conflict', 'This proposal needs an active, attributable Agent run.');
}
