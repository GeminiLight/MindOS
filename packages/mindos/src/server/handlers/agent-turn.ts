import {
  MINDOS_SSE_HEADERS,
  type MindOSSSEvent,
} from '../../agent/turn/index.js';
import {
  normalizeMindosAgentSessionTurnBody,
  parseMindosAgentTurnRequest,
  type MindosAgentTurnRequest,
} from '../../agent/turn/request.js';

/**
 * Product Server handler for `POST /api/agent/sessions/:sessionId/turns`.
 *
 * Thin shell over the shared turn-request contract in `agent/turn/request.ts`
 * (single source with the Next host route; spec-runtime-lane-contract). The
 * Product Server provides an executable default backed by the shared runtime
 * lanes. Hosts can inject their own preparation and projection services.
 */

export type {
  MindosAgentRuntimeKind,
  MindosAgentTurnMessage,
  MindosAgentTurnRequest,
  MindosSelectedRuntime,
} from '../../agent/turn/request.js';

export type AgentTurnStreamHandlerServices = {
  agentTurnStream(input: MindosAgentTurnRequest): AsyncIterable<MindOSSSEvent>;
};

export type AgentTurnStreamHandlerResult =
  | { ok: true; status: 200; headers: Record<string, string>; body: AsyncIterable<MindOSSSEvent> }
  | { ok: false; status: number; body: { error: string } };

function invalidRequest(message: string): AgentTurnStreamHandlerResult {
  return { ok: false, status: 400, body: { error: message } };
}

export function handleAgentTurnStream(
  body: unknown,
  services: AgentTurnStreamHandlerServices,
): AgentTurnStreamHandlerResult {
  const parsed = parseMindosAgentTurnRequest(body);
  if (!parsed.ok) return invalidRequest(parsed.message);

  return {
    ok: true,
    status: 200,
    headers: MINDOS_SSE_HEADERS,
    body: services.agentTurnStream(parsed.body),
  };
}

export function handleAgentSessionTurnStream(
  sessionId: string,
  body: unknown,
  services: AgentTurnStreamHandlerServices,
): AgentTurnStreamHandlerResult {
  const normalized = normalizeMindosAgentSessionTurnBody(body, sessionId);
  if (!normalized.ok) return invalidRequest(normalized.message);
  return handleAgentTurnStream(normalized.body, services);
}
