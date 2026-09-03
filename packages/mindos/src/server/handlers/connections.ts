import {
  bindConnection,
  discoverLarkCliConnections,
  getConnectionBinding,
  listConnectionBindings,
  refreshConnectionBinding,
  unbindConnection,
  type ConnectionBinding,
  type ConnectionCandidate,
} from '../connections/index.js';
import { json, type MindosServerResponse } from '../response.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type ConnectionsPayload = {
  schemaVersion: 1;
  bindings: ConnectionBinding[];
  candidates?: ConnectionCandidate[];
};

export type ConnectionMutationPayload =
  | { action: 'bind'; candidateId: string }
  | { action: 'refresh'; bindingId: string }
  | { action: 'unbind'; bindingId: string };

export type ConnectionBrokerServices = {
  mindRoot: string;
  discoverConnections?(): Promise<ConnectionCandidate[]>;
};

export async function handleConnectionsGet(
  searchParams: URLSearchParams,
  services: ConnectionBrokerServices,
): Promise<MindosServerResponse<ConnectionsPayload | { error: string }>> {
  try {
    const bindings = listConnectionBindings(services.mindRoot);
    if (searchParams.get('discover') !== 'true') {
      return json({ schemaVersion: 1, bindings }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const discovered = await discover(services);
    const provider = searchParams.get('provider')?.trim();
    const candidates = provider
      ? discovered.filter((candidate) => candidate.provider === provider)
      : discovered;
    return json({ schemaVersion: 1, bindings, candidates }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return json({ error: messageOf(error, 'Failed to inspect connections.') }, { status: 500 });
  }
}

export async function handleConnectionsPost(
  body: unknown,
  services: ConnectionBrokerServices,
): Promise<MindosServerResponse<
  | { ok: true; binding: ConnectionBinding }
  | { ok: true; removed: boolean }
  | { error: string }
>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Connection action body must be an object.' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const action = record.action;
  try {
    if (action === 'bind') {
      const candidateId = safeId(record.candidateId);
      if (!candidateId) return json({ error: 'A valid candidateId is required.' }, { status: 400 });
      const candidate = (await discover(services)).find((entry) => entry.id === candidateId);
      if (!candidate) return json({ error: 'Connection candidate was not found; refresh discovery.' }, { status: 404 });
      if (!hasUsableBot(candidate)) {
        return json({ error: candidate.issues[0]?.message ?? 'The candidate bot identity is not ready.' }, { status: 409 });
      }
      const binding = bindConnection(services.mindRoot, candidate);
      return json({ ok: true, binding }, { status: 201 });
    }

    if (action === 'refresh') {
      const bindingId = safeId(record.bindingId);
      if (!bindingId) return json({ error: 'A valid bindingId is required.' }, { status: 400 });
      const existing = getConnectionBinding(services.mindRoot, bindingId);
      if (!existing) return json({ error: 'Connection binding was not found.' }, { status: 404 });
      const candidate = (await discover(services)).find((entry) => (
        entry.id === bindingId
        || entry.credentialRef.profile === existing.credentialRef.profile
      ));
      if (!candidate) return json({ error: 'The bound CLI profile is no longer discoverable.' }, { status: 409 });
      const binding = refreshConnectionBinding(services.mindRoot, bindingId, candidate);
      return json({ ok: true, binding });
    }

    if (action === 'unbind') {
      const bindingId = safeId(record.bindingId);
      if (!bindingId) return json({ error: 'A valid bindingId is required.' }, { status: 400 });
      return json({ ok: true, removed: unbindConnection(services.mindRoot, bindingId) });
    }

    return json({ error: 'action must be bind, refresh, or unbind.' }, { status: 400 });
  } catch (error) {
    const message = messageOf(error, 'Connection operation failed.');
    const status = /not found/i.test(message) ? 404 : /busy|cannot change|does not match/i.test(message) ? 409 : 500;
    return json({ error: message }, { status });
  }
}

function discover(services: ConnectionBrokerServices): Promise<ConnectionCandidate[]> {
  return services.discoverConnections?.() ?? discoverLarkCliConnections();
}

function hasUsableBot(candidate: ConnectionCandidate): boolean {
  return candidate.status !== 'unavailable'
    && candidate.identities.bot.available
    && candidate.identities.bot.verified
    && candidate.capabilities.some((capability) => (
      capability.id === 'message.send'
      && capability.identity === 'bot'
      && capability.status === 'available'
    ));
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
