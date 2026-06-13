import type { AgentAuditEvent } from '../../knowledge/audit/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';
import { listAgentAuditEventsFromLog } from './audit-log.js';

export type AgentActivityHandlerServices = {
  mindRoot: string;
};

export type AgentActivityPayload = {
  events: AgentAuditEvent[];
};

export async function handleAgentActivity(
  query: MindosRequestQuery | undefined,
  services: AgentActivityHandlerServices,
): Promise<MindosServerResponse<AgentActivityPayload | { error: string }>> {
  const limit = parseLimit(queryValue(query, 'limit'));
  try {
    const events = listAgentAuditEventsFromLog(services.mindRoot, limit);
    return json({ events }, { headers: privateCacheHeaders(30) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 500));
}
