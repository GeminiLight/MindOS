import { withPrivateRecordLock } from '../private-records.js';
import { getInquiry } from '../inquiries/index.js';
import {
  createCoevolutionTaskSchema,
  coevolutionCommandSchema,
  coevolutionHash,
  type CoevolutionTask,
  type CoevolutionCommand,
} from './model.js';
import { readTask, writeTask, mutateTask, fail, checkTime } from './storage.js';
import { selectMethod, confirmTaskMethod, pauseTaskMethod } from './methods.js';
import {
  validateTaskEvidence,
  assertTaskAgent,
  coevolutionRuns,
} from './runs.js';
export * from './model.js';
export { listCoevolutionTasks } from './storage.js';
export { coevolutionMethods } from './methods.js';
export { coevolutionContext } from './context.js';
export {
  prepareCoevolutionTaskRun,
  consumeCoevolutionDraft,
  findCoevolutionTaskBySession,
} from './preparations.js';
export { coevolutionRuns } from './runs.js';
export { createCoevolutionInquiry } from './inquiries.js';
export const getCoevolutionTask = readTask;

export function createCoevolutionTask(
  root: string,
  input: unknown,
  now = new Date(),
): CoevolutionTask {
  const parsed = createCoevolutionTaskSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      'invalid',
      'Give this task a title, a concrete goal and a collaboration mode.',
    );
  checkTime(now);
  const command = parsed.data;
  return withPrivateRecordLock(root, () => {
    const id = 'coevolution-' + coevolutionHash(command.requestId).slice(0, 24);
    const existing = readTask(root, id);
    const creationHash = coevolutionHash(command);
    if (existing) {
      if (existing.creationHash !== creationHash)
        fail('conflict', 'This request already belongs to a different task.');
      return existing;
    }
    const at = now.toISOString();
    const task: CoevolutionTask = {
      schemaVersion: 1,
      id,
      version: 1,
      creationHash,
      title: command.title,
      goal: command.goal,
      mode: command.mode,
      ...(command.source ? { source: command.source } : {}),
      createdAt: at,
      updatedAt: at,
      archived: false,
      decisions: [],
      corrections: [],
      applications: [],
      agreements: [],
      preparations: [],
      runs: [],
      modeHistory: [{ mode: command.mode, recordedAt: at }],
      commands: [],
    };
    writeTask(root, task);
    return task;
  });
}
type Actor = CoevolutionTask['decisions'][number]['actor'];
const human: Actor = { kind: 'human' };
function applyCommand(
  root: string,
  task: CoevolutionTask,
  c: CoevolutionCommand,
  now: Date,
  actor: Actor,
) {
  if (task.archived && c.action !== 'archive')
    fail('conflict', 'Restore this task before changing it.');
  const at = now.toISOString();
  switch (c.action) {
    case 'set-mode':
      task.mode = c.mode;
      task.modeHistory.push({ mode: c.mode, recordedAt: at });
      break;
    case 'add-decision':
      task.decisions.push({
        id: 'decision-' + (task.decisions.length + 1),
        question: c.question,
        options: c.options,
        actor,
        createdAt: at,
      });
      break;
    case 'choose-decision': {
      const decision = task.decisions.find((d) => d.id === c.decisionId);
      if (!decision || decision.choice || decision.outcome)
        fail(
          'conflict',
          'Choose an unanswered decision. A saved prediction cannot be rewritten after feedback.',
        );
      if (!decision.options.some((o) => o.id === c.optionId))
        fail('invalid', 'Choose one of this decision’s options.');
      decision.choice = {
        optionId: c.optionId,
        prediction: c.prediction,
        confidence: c.confidence,
        ...(c.reason ? { reason: c.reason } : {}),
        recordedAt: at,
      };
      break;
    }
    case 'observe-decision': {
      const decision = task.decisions.find((d) => d.id === c.decisionId);
      if (!decision?.choice || decision.outcome)
        fail('conflict', 'Record your prediction before attaching a result.');
      validateTaskEvidence(root, task, c.evidence, { completedAfter: decision.choice.recordedAt });
      decision.outcome = {
        observation: c.observation,
        evidence: c.evidence,
        recordedAt: at,
      };
      break;
    }
    case 'draft-correction':
      if (c.before === c.after)
        fail(
          'invalid',
          'Show what actually changed before proposing a standard.',
        );
      task.corrections.push({
        id: 'correction-' + (task.corrections.length + 1),
        before: c.before,
        after: c.after,
        behavior: c.behavior,
        scope: c.scope,
        check: c.check,
        actor,
        status: 'draft',
        createdAt: at,
      });
      break;
    case 'edit-correction': {
      const correction = task.corrections.find(
        (item) => item.id === c.correctionId,
      );
      if (!correction || correction.status !== 'draft')
        fail(
          'conflict',
          'Edit a pending draft; confirmed methods require a new version.',
        );
      if (c.before === c.after)
        fail(
          'invalid',
          'Show a concrete difference before confirming this standard.',
        );
      if ((correction.edits?.length ?? 0) >= 20)
        fail(
          'conflict',
          'This draft has reached its revision limit. Start a new draft.',
        );
      (correction.edits ??= []).push({
        before: correction.before,
        after: correction.after,
        behavior: correction.behavior,
        scope: correction.scope,
        check: correction.check,
        editedAt: at,
      });
      Object.assign(correction, {
        before: c.before,
        after: c.after,
        behavior: c.behavior,
        scope: c.scope,
        check: c.check,
        editedAt: at,
      });
      break;
    }
    case 'confirm-correction':
    case 'reject-correction': {
      const correction = task.corrections.find(
        (item) => item.id === c.correctionId,
      );
      if (
        c.action === 'confirm-correction' &&
        correction?.status === 'confirmed'
      )
        break;
      if (!correction || correction.status !== 'draft')
        fail('conflict', 'Choose a pending standard.');
      if (c.action === 'confirm-correction') {
        correction.learningId = confirmTaskMethod(
          root,
          task,
          correction,
          `User-confirmed correction\nBefore: ${correction.before}\nAfter: ${correction.after}`,
          now,
        );
        correction.status = 'confirmed';
      } else correction.status = 'rejected';
      correction.resolvedAt = at;
      break;
    }
    case 'link-inquiry': {
      const inquiry = getInquiry(root, c.inquiryId);
      if (!inquiry || inquiry.archived)
        fail('invalid', 'Choose an existing active inquiry.');
      if (task.inquiryId && task.inquiryId !== c.inquiryId)
        fail(
          'conflict',
          'This task already has a linked inquiry. Continue its existing evidence trail.',
        );
      task.inquiryId = c.inquiryId;
      break;
    }
    case 'apply-method': {
      if ((c.disposition === 'adjust') !== !!c.adjustment)
        fail(
          'invalid',
          'Provide a scoped adjustment only when adjusting this standard.',
        );
      const method = selectMethod(root, c.method);
      task.applications.push({
        id: 'application-' + (task.applications.length + 1),
        method,
        disposition: c.disposition,
        reason: c.reason,
        ...(c.adjustment ? { adjustment: c.adjustment } : {}),
        createdAt: at,
      });
      break;
    }
    case 'start-agreement':
    case 'propose-agreement':
      task.agreements.push({
        id: 'agreement-' + (task.agreements.length + 1),
        behavior: c.behavior,
        scope: c.scope,
        check: c.check,
        actor,
        status: c.action === 'start-agreement' ? 'trying' : 'proposed',
        createdAt: at,
        ...(c.action === 'start-agreement' ? { trialStartedAt: at } : {}),
        observations: [],
      });
      break;
    case 'try-agreement': {
      const agreement = task.agreements.find((a) => a.id === c.agreementId);
      if (!agreement || agreement.status !== 'proposed')
        fail('conflict', 'Choose a proposed agreement to try.');
      agreement.status = 'trying';
      agreement.trialStartedAt = at;
      break;
    }
    case 'observe-agreement': {
      const agreement = task.agreements.find((a) => a.id === c.agreementId);
      if (!agreement || !['trying', 'kept'].includes(agreement.status))
        fail('conflict', 'Observe an active agreement.');
      validateTaskEvidence(root, task, c.evidence, { startedAfter: agreement.trialStartedAt ?? agreement.createdAt });
      agreement.observations.push({
        id: 'observation-' + (agreement.observations.length + 1),
        observation: c.observation,
        outcome: c.outcome,
        evidence: c.evidence,
        recordedAt: at,
      });
      break;
    }
    case 'resolve-agreement': {
      const agreement = task.agreements.find((a) => a.id === c.agreementId);
      if (
        !agreement ||
        !['trying', 'kept', 'proposed'].includes(agreement.status)
      )
        fail('conflict', 'Choose an active agreement.');
      if ((c.resolution === 'revise') !== !!c.revision)
        fail(
          'invalid',
          'Provide the revised behavior, scope and check when revising.',
        );
      if (
        c.resolution === 'keep' &&
        (agreement.status === 'proposed' ||
          !agreement.observations.length ||
          (agreement.status === 'kept' && agreement.resolution))
      )
        fail(
          'conflict',
          'Try and observe this agreement before deciding to keep it.',
        );
      if (c.resolution === 'keep') {
        agreement.learningId = confirmTaskMethod(
          root,
          task,
          agreement,
          `User-kept collaboration agreement\n${agreement.observations.map((o) => `${o.evidence.kind}: ${o.observation}`).join('\n')}`,
          now,
        );
        agreement.status = 'kept';
      } else {
        if (agreement.learningId) {
          pauseTaskMethod(root, agreement.learningId, c.reason, now);
        }
        agreement.status = c.resolution === 'revise' ? 'revised' : 'withdrawn';
        if (c.revision)
          task.agreements.push({
            id: 'agreement-' + (task.agreements.length + 1),
            ...c.revision,
            actor: human,
            status: 'trying',
            createdAt: at,
            trialStartedAt: at,
            revisionOf: agreement.id,
            observations: [],
          });
      }
      agreement.resolution = { reason: c.reason, recordedAt: at };
      break;
    }
    case 'capture-runs':
      for (const run of coevolutionRuns(root, task))
        if (
          ['completed', 'failed', 'canceled', 'timed_out'].includes(
            run.status,
          ) &&
          !task.runs.some((r) => r.runId === run.runId)
        )
          task.runs.push(run);
      break;
    case 'archive':
      task.archived = c.archived;
      break;
  }
}
export function updateCoevolutionTask(
  root: string,
  id: string,
  input: unknown,
  now = new Date(),
): CoevolutionTask {
  const parsed = coevolutionCommandSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid', 'Complete the required fields with valid content.');
  const c = parsed.data;
  return mutateTask(
    root,
    id,
    c,
    now,
    (task) => applyCommand(root, task, c, now, human),
    (task) =>
      !task.archived &&
      ((c.action === 'confirm-correction' &&
        task.corrections.some(
          (item) => item.id === c.correctionId && item.status === 'confirmed',
        )) ||
        (c.action === 'resolve-agreement' &&
          c.resolution === 'keep' &&
          task.agreements.some(
            (item) =>
              item.id === c.agreementId &&
              item.status === 'kept' &&
              !item.resolution,
          ))),
  ).task;
}
/** The caller supplies the real host run context. Public HTTP commands never accept an actor. */
export function recordCoevolutionAgentSuggestion(
  root: string,
  id: string,
  input: unknown,
  actor: { runId: string; chatSessionId: string },
  now = new Date(),
) {
  const parsed = coevolutionCommandSchema.safeParse(input);
  if (
    !parsed.success ||
    !['add-decision', 'draft-correction', 'propose-agreement'].includes(
      parsed.data.action,
    )
  )
    return fail(
      'invalid',
      'Agents may propose decisions and standards; only the user can confirm or activate them.',
    );
  const command = parsed.data;
  const attributedCommand = { ...command, actor };
  return mutateTask(root, id, attributedCommand, now, (task) => {
    assertTaskAgent(root, task, actor);
    applyCommand(root, task, command, now, { kind: 'agent', ...actor });
  }).task;
}
export const recordCoevolutionAgentDecision = recordCoevolutionAgentSuggestion;
