import crypto from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from '../../agent/redaction.js';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { registerContextAsset } from '../../knowledge/context-assets/index.js';
import { applyRuntimeControlPlaneMutation } from '../handlers/runtime-control-plane.js';
import { nextAutomationRunAt } from './schedule.js';
import {
  appendStudioAutomationNotification,
  StudioAutomationApprovalRequiredError,
} from './approvals.js';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';
import type {
  StudioAutomationExecutor,
  StudioAutomationExecutorContext,
  StudioAutomationExecutorResult,
  StudioAutomationEvent,
  StudioAutomationJob,
  StudioAutomationRun,
  StudioAutomationRunStatus,
} from './types.js';

const DEFAULT_LEASE_MS = 15 * 60_000;
const LEASE_TIMEOUT_BUFFER_MS = 30_000;
const MAX_LEASE_MS = 2 * 60 * 60_000;
const MAX_RUNS_PER_TICK = 20;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_PREVIEW_CHARS = 600;

export type ClaimStudioAutomationOptions = {
  ownerId: string;
  now?: Date;
  leaseMs?: number;
  excludeIds?: ReadonlySet<string>;
};

export type TickStudioAutomationWorkerOptions = {
  mindRoot: string;
  executor: StudioAutomationExecutor;
  ownerId?: string;
  now?(): Date;
  leaseMs?: number;
  maxRuns?: number;
};

export type TickStudioAutomationWorkerResult = {
  recovered: number;
  claimed: number;
  completed: number;
  succeeded: number;
  failed: number;
  timedOut: number;
  retried: number;
  waitingApproval: number;
};

export function claimNextDueStudioAutomation(
  mindRoot: string,
  options: ClaimStudioAutomationOptions,
): StudioAutomationJob | null {
  const now = options.now ?? new Date();
  const requestedLeaseMs = Math.max(1_000, Math.min(MAX_LEASE_MS, options.leaseMs ?? DEFAULT_LEASE_MS));
  return mutateStudioAutomationState(mindRoot, (state) => {
    const scheduled = state.automations
      .filter((item) => (
        item.status === 'active'
        && !item.lease
        && !options.excludeIds?.has(item.id)
        && item.nextRunAt
        && Date.parse(item.nextRunAt) <= now.getTime()
      ))
      .map((job) => ({ job, occurrenceAt: job.nextRunAt!, event: undefined, delivery: undefined }));
    const eventDriven = state.events.flatMap((event) => event.deliveries.flatMap((delivery) => {
      if (delivery.status !== 'pending' || Date.parse(delivery.nextAttemptAt ?? delivery.createdAt) > now.getTime()) return [];
      const job = state.automations.find((item) => item.id === delivery.jobId);
      if (!job || job.status !== 'active' || job.lease || options.excludeIds?.has(job.id)) return [];
      return [{ job, occurrenceAt: event.occurredAt, event, delivery }];
    }));
    const candidate = [...scheduled, ...eventDriven]
      .sort((left, right) => Date.parse(left.occurrenceAt) - Date.parse(right.occurrenceAt) || left.job.id.localeCompare(right.job.id))[0];
    if (!candidate) return null;
    const { job, event, delivery } = candidate;
    // A live run must never look stale before its own timeout can fire.
    const leaseMs = Math.max(
      requestedLeaseMs,
      Math.min(MAX_LEASE_MS, job.timeoutMs + LEASE_TIMEOUT_BUFFER_MS),
    );
    const attempt = Math.max(1, delivery?.attempt ?? job.retryAttempt ?? 1);
    const runId = `automation-run-${now.getTime().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
    job.lease = {
      runId,
      ownerId: normalizeOwnerId(options.ownerId),
      occurrenceAt: candidate.occurrenceAt,
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      attempt,
      ...(event ? { eventId: event.id } : {}),
      ...(delivery ? { eventDeliveryId: delivery.id } : {}),
    };
    if (delivery) {
      delivery.status = 'claimed';
      delivery.runId = runId;
      delivery.ownerId = job.lease.ownerId;
      delivery.leaseExpiresAt = job.lease.expiresAt;
      delivery.updatedAt = now.toISOString();
      delete delivery.nextAttemptAt;
    } else {
      delete job.nextRunAt;
    }
    job.lastStatus = 'running';
    job.updatedAt = now.toISOString();
    state.updatedAt = now.toISOString();
    return structuredClone(job);
  });
}

export function recoverStaleStudioAutomationLeases(
  mindRoot: string,
  now = new Date(),
): StudioAutomationRun[] {
  const recoveredJobs: StudioAutomationJob[] = [];
  const runs = mutateStudioAutomationState(mindRoot, (state) => {
    const recovered: StudioAutomationRun[] = [];
    for (const job of state.automations) {
      const lease = job.lease;
      if (!lease || Date.parse(lease.expiresAt) > now.getTime()) continue;
      const error = 'Automation worker lease expired before the run completed.';
      const run: StudioAutomationRun = {
        id: lease.runId,
        status: 'interrupted',
        attempt: lease.attempt,
        occurrenceAt: lease.occurrenceAt,
        startedAt: lease.claimedAt,
        finishedAt: now.toISOString(),
        durationMs: Math.max(0, now.getTime() - Date.parse(lease.claimedAt)),
        error,
        ...(lease.eventId ? { eventId: lease.eventId } : {}),
        ...(lease.eventDeliveryId ? { eventDeliveryId: lease.eventDeliveryId } : {}),
      };
      job.history = [run, ...job.history].slice(0, 50);
      job.runCount += 1;
      job.lastRun = now.toISOString();
      job.lastStatus = 'interrupted';
      job.lastError = error;
      delete job.lease;
      if (lease.eventDeliveryId) {
        const delivery = findEventDelivery(state.events, lease.eventId, lease.eventDeliveryId);
        if (delivery) settleFailedEventDelivery(delivery, job, lease.attempt, now, error);
      } else {
        scheduleAfterFailure(job, lease.attempt, now);
      }
      job.updatedAt = now.toISOString();
      recovered.push(run);
      recoveredJobs.push(structuredClone(job));
    }
    if (recovered.length > 0) state.updatedAt = now.toISOString();
    return recovered;
  });
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]!;
    let job = recoveredJobs[index]!;
    try {
      const artifactPath = writeRunArtifact(mindRoot, job, run);
      run.artifactPath = artifactPath;
      job = attachRecoveredArtifact(mindRoot, job.id, run.id, artifactPath, now) ?? job;
    } catch {
      // The interrupted state and failure audit are more important than its
      // optional artifact; a later run must still be able to proceed.
    }
    recordWake(mindRoot, job, run, 'missed', now, run.error);
    recordFailure(mindRoot, job, run, 'runtime', job.retry === 'once' && run.attempt === 1, run.error!, now);
    appendStudioAutomationNotification(mindRoot, {
      id: `notify-interrupted-${run.id}`,
      jobId: job.id,
      runId: run.id,
      kind: 'interrupted',
      title: `${job.title} was interrupted`,
      body: run.error ?? 'The automation worker stopped before the run completed.',
      createdAt: now.toISOString(),
    });
    updateControlPlaneAfterRun(mindRoot, job, run.id, now);
  }
  return runs;
}

function attachRecoveredArtifact(
  mindRoot: string,
  jobId: string,
  runId: string,
  artifactPath: string,
  now: Date,
): StudioAutomationJob | null {
  return mutateStudioAutomationState(mindRoot, (state) => {
    const job = state.automations.find((item) => item.id === jobId);
    const run = job?.history.find((item) => item.id === runId);
    if (!job || !run) return null;
    run.artifactPath = artifactPath;
    job.updatedAt = now.toISOString();
    state.updatedAt = now.toISOString();
    return structuredClone(job);
  });
}

export async function tickStudioAutomationWorker(
  options: TickStudioAutomationWorkerOptions,
): Promise<TickStudioAutomationWorkerResult> {
  const ownerId = normalizeOwnerId(options.ownerId ?? `worker-${process.pid}`);
  const now = options.now ?? (() => new Date());
  const recovered = recoverStaleStudioAutomationLeases(options.mindRoot, now());
  const result: TickStudioAutomationWorkerResult = {
    recovered: recovered.length,
    claimed: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    waitingApproval: 0,
    retried: recovered.filter((run) => {
      const state = readStudioAutomationState(options.mindRoot);
      if (run.eventDeliveryId) {
        return state.events.some((event) => event.deliveries.some((delivery) => (
          delivery.id === run.eventDeliveryId && delivery.status === 'pending' && delivery.attempt === 2
        )));
      }
      const job = state.automations.find((item) => item.history.some((itemRun) => itemRun.id === run.id));
      return job?.retryAttempt === 2;
    }).length,
  };
  const maxRuns = Math.max(1, Math.min(MAX_RUNS_PER_TICK, options.maxRuns ?? MAX_RUNS_PER_TICK));
  const claimedJobIds = new Set<string>();

  for (let index = 0; index < maxRuns; index += 1) {
    const job = claimNextDueStudioAutomation(options.mindRoot, {
      ownerId,
      now: now(),
      leaseMs: options.leaseMs,
      excludeIds: claimedJobIds,
    });
    if (!job?.lease) break;
    claimedJobIds.add(job.id);
    result.claimed += 1;
    const lease = job.lease;
    const startedWallClock = Date.now();
    recordWake(options.mindRoot, job, runFromLease(job), 'claimed', now());

    let status: StudioAutomationRunStatus = 'success';
    let execution: StudioAutomationExecutorResult | undefined;
    let error: string | undefined;
    try {
      assertExecutable(job);
      execution = await executeWithTimeout(
        job,
        lease.runId,
        lease.attempt,
        options.executor,
        eventContextForLease(options.mindRoot, lease.eventId),
      );
    } catch (caught) {
      status = caught instanceof StudioAutomationApprovalRequiredError
        ? 'waiting_approval'
        : caught instanceof AutomationTimeoutError
          ? 'timed_out'
          : 'error';
      error = status === 'waiting_approval' ? undefined : redactError(caught);
    }

    const finishedAt = now();
    let artifactPath: string | undefined;
    try {
      artifactPath = writeRunArtifact(options.mindRoot, job, {
        id: lease.runId,
        status,
        attempt: lease.attempt,
        occurrenceAt: lease.occurrenceAt,
        startedAt: lease.claimedAt,
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, Date.now() - startedWallClock),
        ...(execution?.text ? { outputPreview: execution.text.slice(0, MAX_PREVIEW_CHARS) } : {}),
        ...(error ? { error } : {}),
        ...(lease.eventId ? { eventId: lease.eventId } : {}),
        ...(lease.eventDeliveryId ? { eventDeliveryId: lease.eventDeliveryId } : {}),
      }, execution);
    } catch (artifactError) {
      status = 'error';
      error = `Run artifact could not be persisted: ${redactError(artifactError)}`.slice(0, 1_000);
      artifactPath = undefined;
    }

    const completion = completeClaim(options.mindRoot, job.id, lease.runId, {
      status,
      finishedAt,
      durationMs: Math.max(0, Date.now() - startedWallClock),
      artifactPath,
      outputPreview: execution?.text,
      error,
    });
    if (!completion) continue;
    result.completed += 1;
    if (status === 'success') result.succeeded += 1;
    else if (status === 'waiting_approval') {
      result.waitingApproval += 1;
    } else {
      result.failed += 1;
      if (status === 'timed_out') result.timedOut += 1;
      const retryScheduled = lease.eventDeliveryId
        ? isEventDeliveryRetryPending(options.mindRoot, lease.eventDeliveryId)
        : completion.retryAttempt === 2;
      if (retryScheduled) result.retried += 1;
      recordFailure(
        options.mindRoot,
        completion,
        completion.history[0]!,
        status === 'timed_out' ? 'timeout' : isPermissionFailure(error) ? 'permission' : 'runtime',
        retryScheduled,
        error ?? 'Automation run failed.',
        finishedAt,
      );
      appendStudioAutomationNotification(options.mindRoot, {
        id: `notify-${status === 'timed_out' ? 'timeout' : 'failure'}-${lease.runId}`,
        jobId: completion.id,
        runId: lease.runId,
        kind: status === 'timed_out' ? 'timeout' : 'failure',
        title: status === 'timed_out' ? `${completion.title} timed out` : `${completion.title} failed`,
        body: error ?? 'Automation run failed.',
        createdAt: finishedAt.toISOString(),
      });
    }
    recordWake(options.mindRoot, completion, completion.history[0]!, 'completed', finishedAt, error);
    updateControlPlaneAfterRun(options.mindRoot, completion, lease.runId, finishedAt);
  }
  return result;
}

function completeClaim(
  mindRoot: string,
  jobId: string,
  runId: string,
  input: {
    status: StudioAutomationRunStatus;
    finishedAt: Date;
    durationMs: number;
    artifactPath?: string;
    outputPreview?: string;
    error?: string;
  },
): StudioAutomationJob | null {
  return mutateStudioAutomationState(mindRoot, (state) => {
    const job = state.automations.find((item) => item.id === jobId);
    if (!job?.lease || job.lease.runId !== runId) return null;
    const lease = job.lease;
    const run: StudioAutomationRun = {
      id: runId,
      status: input.status,
      attempt: lease.attempt,
      occurrenceAt: lease.occurrenceAt,
      startedAt: lease.claimedAt,
      finishedAt: input.finishedAt.toISOString(),
      durationMs: input.durationMs,
      ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
      ...(input.outputPreview ? { outputPreview: normalizePreview(input.outputPreview) } : {}),
      ...(input.error ? { error: redactSensitiveText(input.error).slice(0, 1_000) } : {}),
      ...(lease.eventId ? { eventId: lease.eventId } : {}),
      ...(lease.eventDeliveryId ? { eventDeliveryId: lease.eventDeliveryId } : {}),
    };
    job.history = [run, ...job.history].slice(0, 50);
    job.runCount += 1;
    job.lastRun = input.finishedAt.toISOString();
    job.lastStatus = input.status;
    if (input.error) job.lastError = redactSensitiveText(input.error).slice(0, 1_000);
    else delete job.lastError;
    delete job.lease;
    if (lease.eventDeliveryId) {
      const delivery = findEventDelivery(state.events, lease.eventId, lease.eventDeliveryId);
      if (delivery) settleEventDelivery(delivery, job, lease.attempt, input.status, input.finishedAt, input.error);
      delete job.nextRunAt;
      delete job.retryAttempt;
    } else if (input.status === 'success') scheduleAfterSuccess(job, input.finishedAt);
    else if (input.status === 'waiting_approval') {
      delete job.nextRunAt;
      job.retryAttempt = lease.attempt;
    } else scheduleAfterFailure(job, lease.attempt, input.finishedAt);
    job.updatedAt = input.finishedAt.toISOString();
    state.updatedAt = input.finishedAt.toISOString();
    return structuredClone(job);
  });
}

function scheduleAfterSuccess(job: StudioAutomationJob, now: Date): void {
  delete job.retryAttempt;
  if (job.status !== 'active') {
    delete job.nextRunAt;
    return;
  }
  const next = nextAutomationRunAt(job.schedule, now, job.timezone);
  if (next) job.nextRunAt = next;
  else delete job.nextRunAt;
}

function scheduleAfterFailure(job: StudioAutomationJob, attempt: number, now: Date): void {
  if (job.status === 'active' && job.retry === 'once' && attempt === 1) {
    job.nextRunAt = now.toISOString();
    job.retryAttempt = 2;
    return;
  }
  scheduleAfterSuccess(job, now);
}

async function executeWithTimeout(
  job: StudioAutomationJob,
  runId: string,
  attempt: number,
  executor: StudioAutomationExecutor,
  event?: StudioAutomationExecutorContext['event'],
): Promise<StudioAutomationExecutorResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executor(job, { runId, attempt, signal: controller.signal, ...(event ? { event } : {}) }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new AutomationTimeoutError(`Automation exceeded its ${job.timeoutMs}ms timeout.`));
          controller.abort();
        }, job.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertExecutable(job: StudioAutomationJob): void {
  if (job.runtime === 'mindos-pi') {
    if (job.permissionMode !== 'read' && job.permissionMode !== 'auto') {
      throw new Error('MindOS Pi automations only support read or explicit auto permission.');
    }
    if (job.model !== 'mindos-auto' && job.model !== 'gpt-5.5') {
      throw new Error(`Automation model ${job.model} does not match the MindOS Pi runtime.`);
    }
    return;
  }
  if (job.permissionMode !== 'read' && job.permissionMode !== 'ask' && job.permissionMode !== 'auto') {
    throw new Error('Native automation permission mode is not supported.');
  }
  if ((job.runtime === 'codex' && job.model !== 'codex') || (job.runtime === 'claude' && job.model !== 'claude-code')) {
    throw new Error(`Automation model ${job.model} does not match runtime ${job.runtime}.`);
  }
}

function writeRunArtifact(
  mindRoot: string,
  job: StudioAutomationJob,
  run: StudioAutomationRun,
  result?: StudioAutomationExecutorResult,
): string {
  const date = new Date(run.startedAt);
  const relativePath = `.mindos/automations/runs/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${run.id}.md`;
  const file = resolveExistingSafe(mindRoot, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  const markdown = renderRunArtifact(job, run, result);
  let createdFile = false;
  if (existsSync(file)) {
    if (!statSync(file).isFile() || readFileSync(file, 'utf-8') !== markdown) {
      throw new Error(`Automation artifact collision: ${relativePath}`);
    }
  } else {
    writeFileSync(file, markdown, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    createdFile = true;
  }
  try {
    registerContextAsset(mindRoot, {
      kind: 'automation-run',
      status: 'active',
      title: `${job.title} · ${run.status}`,
      path: relativePath,
      contentHash: crypto.createHash('sha256').update(markdown).digest('hex'),
      source: { kind: 'automation-run', ref: `automation-run:${run.id}` },
      metadata: { automationId: job.id, runStatus: run.status, attempt: run.attempt },
    }, new Date(run.finishedAt ?? run.startedAt));
  } catch (error) {
    if (createdFile) {
      try { unlinkSync(file); } catch { /* best-effort rollback */ }
    }
    throw error;
  }
  return relativePath;
}

function renderRunArtifact(job: StudioAutomationJob, run: StudioAutomationRun, result?: StudioAutomationExecutorResult): string {
  const output = redactSensitiveText(result?.text ?? '').slice(0, MAX_OUTPUT_CHARS);
  const toolCalls = (result?.toolCalls ?? []).slice(0, 100);
  const lines = [
    '---',
    'type: automation.run',
    `automationId: ${JSON.stringify(job.id)}`,
    `runId: ${JSON.stringify(run.id)}`,
    `status: ${run.status}`,
    `attempt: ${run.attempt}`,
    `permissionMode: ${job.permissionMode}`,
    `startedAt: ${run.startedAt}`,
    `finishedAt: ${run.finishedAt ?? ''}`,
    '---',
    '',
    `# ${job.title}`,
    '',
    '## Result',
    '',
    output || (run.error ? redactSensitiveText(run.error) : '_No text output._'),
  ];
  if (toolCalls.length > 0) {
    lines.push('', '## Tool calls', '');
    for (const tool of toolCalls) {
      lines.push(`- ${tool.isError ? 'Failed' : 'Completed'}: ${redactSensitiveText(tool.toolName).slice(0, 120)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function recordWake(
  mindRoot: string,
  job: StudioAutomationJob,
  run: StudioAutomationRun,
  status: 'claimed' | 'completed' | 'missed',
  now: Date,
  summary?: string,
): void {
  applyRuntimeControlPlaneMutation(mindRoot, {
    action: 'record-wake',
    wake: {
      id: `wake-${run.id}`,
      runtimeId: 'mindos',
      scheduleId: job.controlPlaneScheduleId,
      runId: run.id,
      status,
      triggerAt: run.occurrenceAt,
      ...(status === 'claimed' ? { claimedAt: now.toISOString() } : {}),
      ...(status === 'completed' || status === 'missed' ? { completedAt: now.toISOString() } : {}),
      ...(summary ? { summary: redactSensitiveText(summary).slice(0, 1_000) } : {}),
    },
  }, now);
}

function recordFailure(
  mindRoot: string,
  job: StudioAutomationJob,
  run: StudioAutomationRun,
  kind: 'runtime' | 'permission' | 'timeout',
  recoverable: boolean,
  summary: string,
  now: Date,
): void {
  applyRuntimeControlPlaneMutation(mindRoot, {
    action: 'record-failure',
    failure: {
      id: `failure-${run.id}`,
      runtimeId: 'mindos',
      scheduleId: job.controlPlaneScheduleId,
      runId: run.id,
      kind,
      summary: redactSensitiveText(summary).slice(0, 1_000),
      recoverable,
      createdAt: now.toISOString(),
    },
  }, now);
}

function updateControlPlaneAfterRun(mindRoot: string, job: StudioAutomationJob, runId: string, now: Date): void {
  applyRuntimeControlPlaneMutation(mindRoot, {
    action: 'update-schedule',
    scheduleId: job.controlPlaneScheduleId,
    patch: {
      status: job.status === 'paused' ? 'paused' : 'enabled',
      nextRunAt: job.nextRunAt ?? null,
      lastRunId: runId,
    },
  }, now);
}

function runFromLease(job: StudioAutomationJob): StudioAutomationRun {
  const lease = job.lease!;
  return {
    id: lease.runId,
    status: 'running',
    attempt: lease.attempt,
    occurrenceAt: lease.occurrenceAt,
    startedAt: lease.claimedAt,
    ...(lease.eventId ? { eventId: lease.eventId } : {}),
    ...(lease.eventDeliveryId ? { eventDeliveryId: lease.eventDeliveryId } : {}),
  };
}

function eventContextForLease(
  mindRoot: string,
  eventId: string | undefined,
): StudioAutomationExecutorContext['event'] | undefined {
  if (!eventId) return undefined;
  const event = readStudioAutomationState(mindRoot).events.find((item) => item.id === eventId);
  if (!event) return undefined;
  return {
    id: event.id,
    source: event.source,
    key: event.key,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: structuredClone(event.payload),
  };
}

function findEventDelivery(
  events: StudioAutomationEvent[],
  eventId: string | undefined,
  deliveryId: string,
) {
  const event = eventId ? events.find((item) => item.id === eventId) : undefined;
  return event?.deliveries.find((delivery) => delivery.id === deliveryId);
}

function settleEventDelivery(
  delivery: NonNullable<ReturnType<typeof findEventDelivery>>,
  job: StudioAutomationJob,
  attempt: number,
  status: StudioAutomationRunStatus,
  now: Date,
  error?: string,
): void {
  delivery.updatedAt = now.toISOString();
  delete delivery.ownerId;
  delete delivery.leaseExpiresAt;
  if (status === 'success') {
    delivery.status = 'succeeded';
    delivery.finishedAt = now.toISOString();
    delete delivery.error;
    return;
  }
  if (status === 'waiting_approval') {
    delivery.status = 'waiting_approval';
    return;
  }
  settleFailedEventDelivery(delivery, job, attempt, now, error ?? 'Automation delivery failed.');
}

function settleFailedEventDelivery(
  delivery: NonNullable<ReturnType<typeof findEventDelivery>>,
  job: StudioAutomationJob,
  attempt: number,
  now: Date,
  error: string,
): void {
  delivery.updatedAt = now.toISOString();
  delivery.error = redactSensitiveText(error).slice(0, 1_000);
  delete delivery.ownerId;
  delete delivery.leaseExpiresAt;
  if (job.status === 'active' && job.retry === 'once' && attempt === 1) {
    delivery.status = 'pending';
    delivery.attempt = 2;
    delivery.nextAttemptAt = now.toISOString();
    return;
  }
  delivery.status = 'failed';
  delivery.finishedAt = now.toISOString();
  delete delivery.nextAttemptAt;
}

function isEventDeliveryRetryPending(mindRoot: string, deliveryId: string): boolean {
  return readStudioAutomationState(mindRoot).events.some((event) => event.deliveries.some((delivery) => (
    delivery.id === deliveryId && delivery.status === 'pending' && delivery.attempt === 2
  )));
}

function redactError(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

function normalizePreview(value: string): string {
  return redactSensitiveText(value).replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW_CHARS);
}

function normalizeOwnerId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return normalized || `worker-${process.pid}`;
}

function isPermissionFailure(error: string | undefined): boolean {
  return /permission|approval/i.test(error ?? '');
}

class AutomationTimeoutError extends Error {}
