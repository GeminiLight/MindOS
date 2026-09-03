import { emitStudioAutomationEvent } from '../automations/events.js';
import { readStudioAutomationState } from '../automations/store.js';
import type { StudioAutomationEvent } from '../automations/types.js';
import { json, type MindosServerResponse } from '../response.js';

export type AutomationEventServices = { mindRoot: string };

export function handleAutomationEventsGet(
  searchParams: URLSearchParams,
  services: AutomationEventServices,
): MindosServerResponse<{
  schemaVersion: 1;
  events: StudioAutomationEvent[];
  summary: { total: number; pending: number; failed: number; suppressed: number };
} | { error: string }> {
  try {
    const source = searchParams.get('source')?.trim();
    const type = searchParams.get('type')?.trim();
    const limit = boundedLimit(searchParams.get('limit'));
    const all = readStudioAutomationState(services.mindRoot).events
      .filter((event) => !source || event.source === source)
      .filter((event) => !type || event.type === type);
    const deliveries = all.flatMap((event) => event.deliveries);
    return json({
      schemaVersion: 1,
      events: all.slice(0, limit).map((event) => structuredClone(event)),
      summary: {
        total: all.length,
        pending: deliveries.filter((delivery) => delivery.status === 'pending' || delivery.status === 'claimed' || delivery.status === 'waiting_approval').length,
        failed: deliveries.filter((delivery) => delivery.status === 'failed').length,
        suppressed: deliveries.filter((delivery) => delivery.status === 'suppressed' || delivery.status === 'superseded').length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ error: messageOf(error) }, { status: 500 });
  }
}

export function handleAutomationEventsPost(
  body: unknown,
  services: AutomationEventServices,
): MindosServerResponse<{ schemaVersion: 1; created: boolean; event: StudioAutomationEvent } | { error: string }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Automation event body must be an object.' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (record.payload !== undefined && (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload))) {
    return json({ error: 'Automation event payload must be an object.' }, { status: 400 });
  }
  let occurredAt: Date | undefined;
  if (record.occurredAt !== undefined) {
    if (typeof record.occurredAt !== 'string' || !Number.isFinite(Date.parse(record.occurredAt))) {
      return json({ error: 'Automation event occurredAt must be an ISO timestamp.' }, { status: 400 });
    }
    occurredAt = new Date(record.occurredAt);
  }
  try {
    const result = emitStudioAutomationEvent(services.mindRoot, {
      source: typeof record.source === 'string' ? record.source : '',
      key: typeof record.key === 'string' ? record.key : '',
      type: typeof record.type === 'string' ? record.type : '',
      ...(occurredAt ? { occurredAt } : {}),
      payload: record.payload as Record<string, unknown> | undefined,
    });
    return json({ schemaVersion: 1, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return json({ error: messageOf(error) }, { status: 400 });
  }
}

function boundedLimit(value: string | null): number {
  const parsed = Number(value ?? 100);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.floor(parsed))) : 100;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Automation event operation failed.';
}
