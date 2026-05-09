import { LocalFileSystem } from '../../knowledge/storage/local.js';
import { listAgentAuditEvents, type AgentAuditEvent } from '../../knowledge/audit/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

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
  const result = await listAgentAuditEvents(new LocalFileSystem(), services.mindRoot, limit);
  return result.ok
    ? json({ events: result.value }, { headers: privateCacheHeaders(30) })
    : json({ error: result.error.message }, { status: 500 });
}

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.max(1, Math.min(parsed, 500));
}
