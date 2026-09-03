import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioAutomationApprovalRequiredError, resolveStudioAutomationApproval } from './approvals.js';
import { emitStudioAutomationEvent, recordStudioAutomationEventSourceFailure } from './events.js';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';
import { readRuntimeControlPlane } from '../handlers/runtime-control-plane.js';
import type { StudioAutomationJob } from './types.js';
import {
  claimNextDueStudioAutomation,
  recoverStaleStudioAutomationLeases,
  tickStudioAutomationWorker,
} from './worker.js';

let mindRoot = '';
const base = new Date('2026-09-03T12:00:00.000Z');

describe('event-driven studio automations', () => {
  beforeEach(() => {
    mindRoot = mkdtempSync(join(tmpdir(), 'mindos-event-automation-'));
    mkdirSync(join(mindRoot, '.mindos'), { recursive: true });
  });
  afterEach(() => rmSync(mindRoot, { recursive: true, force: true }));

  it('deduplicates by source + key and creates one matching delivery', () => {
    seed(job());
    const first = emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'om_message_1', type: 'im.message.receive_v1', occurredAt: base,
      payload: { text: 'ship it', access_token: 'must-not-leak' },
    });
    const duplicate = emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'om_message_1', type: 'im.message.receive_v1', occurredAt: new Date(base.getTime() + 1_000),
      payload: { text: 'duplicate' },
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.event.id).toBe(first.event.id);
    const state = readStudioAutomationState(mindRoot);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.deliveries).toEqual([
      expect.objectContaining({ jobId: 'studio-event', status: 'pending', attempt: 1 }),
    ]);
    expect(JSON.stringify(state.events)).not.toContain('must-not-leak');
  });

  it('matches exact bounded payload metadata filters before creating a delivery', () => {
    seed(job({ where: { chatType: 'dm', mentionsBot: true } } as never));
    const wrong = emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'group-1', type: 'im.message.receive_v1', occurredAt: base,
      payload: { chatType: 'group', mentionsBot: true },
    });
    const matching = emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'dm-1', type: 'im.message.receive_v1', occurredAt: base,
      payload: { chatType: 'dm', mentionsBot: true, text: 'run' },
    });
    expect(wrong.event.deliveries).toEqual([]);
    expect(matching.event.deliveries).toEqual([expect.objectContaining({ status: 'pending' })]);
  });

  it('rejects large inline payloads and never evicts active deliveries at queue capacity', () => {
    seed(job());
    expect(() => emitStudioAutomationEvent(mindRoot, {
      source: 'api', key: 'large', type: 'large.event', payload: { text: 'x'.repeat(17 * 1024) },
    })).toThrow(/payload exceeds/i);

    mutateStudioAutomationState(mindRoot, (state) => {
      state.events = Array.from({ length: 500 }, (_, index) => ({
        schemaVersion: 1 as const,
        id: `event-cap-${index}`,
        source: 'api', key: `cap-${index}`, type: 'capacity.event',
        occurredAt: new Date(base.getTime() - index).toISOString(), receivedAt: new Date(base.getTime() - index).toISOString(),
        payload: {},
        deliveries: [{
          id: `delivery-cap-${index}`, jobId: 'studio-event', status: 'pending' as const, attempt: 1,
          createdAt: base.toISOString(), updatedAt: base.toISOString(), nextAttemptAt: base.toISOString(),
        }],
      }));
    });
    expect(() => emitStudioAutomationEvent(mindRoot, {
      source: 'api', key: 'over-capacity', type: 'capacity.event', payload: {},
    })).toThrow(/inbox is full|active deliveries/i);
    expect(readStudioAutomationState(mindRoot).events).toHaveLength(500);
  });

  it('records a redacted failure audit when an optional source cannot enqueue', () => {
    recordStudioAutomationEventSourceFailure(mindRoot, {
      source: 'knowledge', key: 'change-1', error: new Error('queue failed with Bearer secret-token'), now: base,
    });
    expect(readRuntimeControlPlane(mindRoot).failureAudits[0]).toMatchObject({
      id: expect.stringMatching(/^failure-event-source-/),
      runtimeId: 'mindos',
      kind: 'runtime',
      recoverable: true,
      summary: expect.stringContaining('knowledge'),
    });
    expect(JSON.stringify(readRuntimeControlPlane(mindRoot).failureAudits)).not.toContain('secret-token');
  });

  it('debounces pending deliveries and suppresses an event storm deterministically', () => {
    seed(job({ debounceMs: 5_000, storm: { windowMs: 60_000, maxEvents: 2 } }));
    for (let index = 0; index < 3; index += 1) {
      emitStudioAutomationEvent(mindRoot, {
        source: 'feishu', key: `om_${index}`, type: 'im.message.receive_v1',
        occurredAt: new Date(base.getTime() + index * 1_000), payload: { index },
      });
    }
    const [third, second, first] = readStudioAutomationState(mindRoot).events;
    expect(first?.deliveries[0]?.status).toBe('superseded');
    expect(second?.deliveries[0]?.status).toBe('pending');
    expect(third?.deliveries[0]).toMatchObject({ status: 'suppressed', reason: 'Event storm limit reached.' });
  });

  it('uses host receive time for debounce when source timestamps arrive out of order', () => {
    seed(job({ debounceMs: 5_000 }));
    emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'newer-source-time', type: 'im.message.receive_v1',
      occurredAt: base, receivedAt: base, payload: {},
    });
    emitStudioAutomationEvent(mindRoot, {
      source: 'feishu', key: 'late-old-source-time', type: 'im.message.receive_v1',
      occurredAt: new Date(base.getTime() - 86_400_000),
      receivedAt: new Date(base.getTime() + 10_000),
      payload: {},
    });

    const [late, first] = readStudioAutomationState(mindRoot).events;
    expect(late?.deliveries[0]?.status).toBe('pending');
    expect(first?.deliveries[0]?.status).toBe('pending');
  });

  it('leases and executes each delivery exactly once with its event context', async () => {
    seed(job());
    emitStudioAutomationEvent(mindRoot, {
      source: 'api', key: 'release-1', type: 'release.ready', occurredAt: base,
      payload: { tag: 'v1.2.3' },
    });
    const executor = vi.fn(async (_job, context) => ({ text: `handled ${context.event?.payload.tag}` }));
    const first = await tickStudioAutomationWorker({ mindRoot, executor, now: () => base });
    const second = await tickStudioAutomationWorker({ mindRoot, executor, now: () => new Date(base.getTime() + 1_000) });

    expect(first).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(second).toMatchObject({ claimed: 0 });
    expect(executor).toHaveBeenCalledOnce();
    expect(executor.mock.calls[0]?.[1].event).toMatchObject({ source: 'api', key: 'release-1', type: 'release.ready' });
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]).toMatchObject({ status: 'succeeded' });
  });

  it('recovers an expired event lease and retries the same delivery once', async () => {
    seed(job());
    emitStudioAutomationEvent(mindRoot, {
      source: 'inbox', key: 'note-1', type: 'inbox.created', occurredAt: base, payload: {},
    });
    const claimed = claimNextDueStudioAutomation(mindRoot, { ownerId: 'crashed-worker', now: base, leaseMs: 1_000 });
    expect(claimed?.lease?.eventDeliveryId).toBeTruthy();
    const recovered = recoverStaleStudioAutomationLeases(mindRoot, new Date(base.getTime() + 41_000));
    expect(recovered).toHaveLength(1);
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]).toMatchObject({ status: 'pending', attempt: 2 });

    const result = await tickStudioAutomationWorker({
      mindRoot,
      executor: async () => ({ text: 'recovered' }),
      now: () => new Date(base.getTime() + 42_000),
    });
    expect(result.succeeded).toBe(1);
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]).toMatchObject({ status: 'succeeded', attempt: 2 });
  });

  it('keeps an event delivery waiting for approval and resumes it after the decision', async () => {
    seed(job({}, { model: 'codex', runtime: 'codex', permissionMode: 'ask' }));
    emitStudioAutomationEvent(mindRoot, {
      source: 'agent', key: 'run-1', type: 'agent.run.completed', occurredAt: base, payload: {},
    });
    const executor = vi.fn()
      .mockRejectedValueOnce(new StudioAutomationApprovalRequiredError('approval-event'))
      .mockResolvedValueOnce({ text: 'approved' });
    await tickStudioAutomationWorker({ mindRoot, executor, now: () => base });
    mutateStudioAutomationState(mindRoot, (state) => {
      state.approvals.push({
        id: 'approval-event', jobId: 'studio-event', runId: state.automations[0]?.history[0]?.id,
        fingerprint: 'fingerprint', runtime: 'codex', status: 'pending', toolName: 'write',
        allowDecision: 'allow_once', denyDecision: 'deny', createdAt: base.toISOString(),
      });
    });
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]?.status).toBe('waiting_approval');

    expect(resolveStudioAutomationApproval(mindRoot, 'approval-event', 'allow', new Date(base.getTime() + 1_000)).kind).toBe('resolved');
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]?.status).toBe('pending');
    await tickStudioAutomationWorker({ mindRoot, executor, now: () => new Date(base.getTime() + 2_000) });
    expect(readStudioAutomationState(mindRoot).events[0]?.deliveries[0]?.status).toBe('succeeded');
  });
});

function seed(value: StudioAutomationJob) {
  mutateStudioAutomationState(mindRoot, (state) => { state.automations.push(value); });
}

function job(
  triggerOverrides: Partial<Extract<StudioAutomationJob['trigger'], { type: 'event' }>> = {},
  overrides: Partial<StudioAutomationJob> = {},
): StudioAutomationJob {
  return {
    id: 'studio-event', title: 'Event automation', prompt: 'Handle the incoming event.',
    scope: 'mind', schedule: 'manual', timezone: 'Asia/Shanghai', model: 'mindos-auto',
    effort: 'normal', permissionMode: 'read', status: 'active', retry: 'once', timeoutMs: 10_000,
    overlap: 'skip', runtime: 'mindos-pi', source: 'mindos-durable',
    controlPlaneScheduleId: 'studio-automation-event', createdAt: base.toISOString(), updatedAt: base.toISOString(),
    runCount: 0, lastStatus: 'pending', history: [],
    trigger: {
      type: 'event', sources: ['feishu', 'api', 'inbox', 'agent'],
      events: ['im.message.receive_v1', 'release.ready', 'inbox.created', 'agent.run.completed'],
      debounceMs: 0, storm: { windowMs: 60_000, maxEvents: 20 }, ...triggerOverrides,
    },
    ...overrides,
  };
}
