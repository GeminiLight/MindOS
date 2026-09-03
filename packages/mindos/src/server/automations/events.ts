import crypto from 'node:crypto';
import { redactSensitiveObject, redactSensitiveText } from '../../agent/redaction.js';
import { applyRuntimeControlPlaneMutation } from '../handlers/runtime-control-plane.js';
import {
  STUDIO_AUTOMATION_MAX_EVENTS,
  isTerminalStudioAutomationEvent,
  mutateStudioAutomationState,
} from './store.js';
import type {
  StudioAutomationEvent,
  StudioAutomationEventDelivery,
  StudioAutomationEventTrigger,
  StudioAutomationJob,
} from './types.js';

const MAX_EVENT_FIELD = 500;
const MAX_EVENT_PAYLOAD_BYTES = 16 * 1024;
const SAFE_SOURCE_TYPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export type EmitStudioAutomationEventInput = {
  source: string;
  key: string;
  type: string;
  occurredAt?: Date;
  receivedAt?: Date;
  payload?: Record<string, unknown>;
};

export type EmitStudioAutomationEventResult = {
  created: boolean;
  event: StudioAutomationEvent;
};

export function recordStudioAutomationEventSourceFailure(
  mindRoot: string,
  input: { source: string; key: string; error: unknown; now?: Date },
): void {
  const source = safeSourceType(input.source, 'source');
  const now = validDate(input.now ?? new Date(), 'failure timestamp');
  const digest = crypto.createHash('sha256').update(`${source}\0${input.key}`).digest('hex').slice(0, 32);
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const message = redactSensitiveText(rawMessage).slice(0, 800);
  try {
    const result = applyRuntimeControlPlaneMutation(mindRoot, {
      action: 'record-failure',
      failure: {
        id: `failure-event-source-${digest}`,
        runtimeId: 'mindos',
        kind: 'runtime',
        summary: `Automation event source ${source} could not enqueue: ${message || 'unknown error'}`,
        recoverable: true,
        createdAt: now.toISOString(),
      },
    }, now);
    if ('error' in result) throw new Error(result.error);
  } catch (auditError) {
    console.error(
      `[automation/event-source] ${source} enqueue failed and its durable audit could not be written:`,
      auditError instanceof Error ? auditError.message : String(auditError),
    );
  }
}

export function emitStudioAutomationEvent(
  mindRoot: string,
  input: EmitStudioAutomationEventInput,
): EmitStudioAutomationEventResult {
  const source = safeSourceType(input.source, 'source');
  const type = safeSourceType(input.type, 'type');
  const key = boundedKey(input.key);
  const occurredAt = validDate(input.occurredAt ?? new Date(), 'occurredAt');
  const receivedAt = validDate(input.receivedAt ?? new Date(), 'receivedAt');
  const rawPayload = input.payload ?? {};
  const serialized = JSON.stringify(rawPayload);
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_EVENT_PAYLOAD_BYTES) {
    throw new Error(`Automation event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes.`);
  }
  const payload = redactSensitiveObject(structuredClone(rawPayload)) as Record<string, unknown>;
  const id = `event-${crypto.createHash('sha256').update(`${source}\0${key}`).digest('hex').slice(0, 40)}`;

  return mutateStudioAutomationState(mindRoot, (state) => {
    const existing = state.events.find((event) => event.id === id);
    if (existing) return { created: false, event: structuredClone(existing) };

    if (state.events.length >= STUDIO_AUTOMATION_MAX_EVENTS) {
      const terminalIndex = oldestTerminalEventIndex(state.events);
      if (terminalIndex < 0) {
        throw new Error(
          `Automation event inbox is full with ${STUDIO_AUTOMATION_MAX_EVENTS} events containing active deliveries; retry after they finish.`,
        );
      }
      state.events.splice(terminalIndex, 1);
    }

    const event: StudioAutomationEvent = {
      schemaVersion: 1,
      id,
      source,
      key,
      type,
      occurredAt: occurredAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      payload,
      deliveries: [],
    };
    for (const job of state.automations) {
      const trigger = eventTrigger(job);
      if (job.status !== 'active' || !trigger || !matches(trigger, event)) continue;
      event.deliveries.push(createDelivery(state.events, job, trigger, event));
    }
    state.events = [event, ...state.events];
    state.updatedAt = receivedAt.toISOString();
    return { created: true, event: structuredClone(event) };
  });
}

function oldestTerminalEventIndex(events: StudioAutomationEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isTerminalStudioAutomationEvent(events[index]!)) return index;
  }
  return -1;
}

function createDelivery(
  priorEvents: StudioAutomationEvent[],
  job: StudioAutomationJob,
  trigger: StudioAutomationEventTrigger,
  event: StudioAutomationEvent,
): StudioAutomationEventDelivery {
  const acceptedInWindow = priorEvents
    .filter((prior) => (
      event.receivedAt.localeCompare(prior.receivedAt) >= 0
      && Date.parse(event.receivedAt) - Date.parse(prior.receivedAt) <= trigger.storm.windowMs
    ))
    .flatMap((prior) => prior.deliveries)
    .filter((delivery) => delivery.jobId === job.id && delivery.status !== 'suppressed')
    .length;
  const id = `delivery-${crypto.createHash('sha256').update(`${event.id}\0${job.id}`).digest('hex').slice(0, 40)}`;
  const base: StudioAutomationEventDelivery = {
    id,
    jobId: job.id,
    status: 'pending',
    attempt: 1,
    createdAt: event.receivedAt,
    updatedAt: event.receivedAt,
    nextAttemptAt: event.receivedAt,
  };
  if (acceptedInWindow >= trigger.storm.maxEvents) {
    return { ...base, status: 'suppressed', reason: 'Event storm limit reached.' };
  }

  if (trigger.debounceMs > 0) {
    for (const prior of priorEvents) {
      if (prior.source !== event.source || prior.type !== event.type) continue;
      const receivedDelta = Date.parse(event.receivedAt) - Date.parse(prior.receivedAt);
      if (receivedDelta < 0 || receivedDelta > trigger.debounceMs) continue;
      const previous = prior.deliveries.find((delivery) => delivery.jobId === job.id && delivery.status === 'pending');
      if (!previous) continue;
      previous.status = 'superseded';
      previous.reason = `Superseded by ${event.id} during debounce window.`;
      previous.updatedAt = event.receivedAt;
      delete previous.nextAttemptAt;
    }
  }
  return base;
}

function eventTrigger(job: StudioAutomationJob): StudioAutomationEventTrigger | null {
  return job.trigger?.type === 'event' ? job.trigger : null;
}

function matches(trigger: StudioAutomationEventTrigger, event: StudioAutomationEvent): boolean {
  return (trigger.sources.includes('*') || trigger.sources.includes(event.source))
    && (trigger.events.includes('*') || trigger.events.includes(event.type))
    && Object.entries(trigger.where ?? {}).every(([path, expected]) => payloadValueAtPath(event.payload, path) === expected);
}

function payloadValueAtPath(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!isPlainRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeSourceType(value: string, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!SAFE_SOURCE_TYPE.test(normalized)) throw new Error(`Automation event ${label} is invalid.`);
  return normalized;
}

function boundedKey(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > MAX_EVENT_FIELD) {
    throw new Error(`Automation event key must contain 1-${MAX_EVENT_FIELD} characters.`);
  }
  return normalized;
}

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) throw new Error(`Automation event ${label} must be valid.`);
  return value;
}
