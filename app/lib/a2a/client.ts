/**
 * A2A Client — Discover external agents and delegate tasks via A2A protocol.
 * Phase 2: MindOS as an A2A Client (orchestrator).
 */

import type {
  AgentCard,
  RemoteAgent,
  A2ATask,
  JsonRpcRequest,
  JsonRpcResponse,
  SendMessageParams,
} from './types';

/* ── Constants ─────────────────────────────────────────────────────────── */

const DISCOVERY_TIMEOUT_MS = 5_000;
const RPC_TIMEOUT_MS = 30_000;
const CARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/* ── Agent Registry (in-memory cache) ──────────────────────────────────── */

const registry = new Map<string, RemoteAgent>();

/** Derive a stable ID from a URL (includes protocol to avoid collisions) */
function urlToId(url: string): string {
  try {
    const u = new URL(url);
    const proto = u.protocol.replace(':', '');
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${proto}-${u.hostname}-${port}`;
  } catch {
    return url.replace(/[^a-zA-Z0-9]/g, '-');
  }
}

/* ── HTTP helpers ──────────────────────────────────────────────────────── */

async function fetchWithTimeout(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = DISCOVERY_TIMEOUT_MS, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRpcCall(endpoint: string, method: string, params: unknown, token?: string): Promise<JsonRpcResponse> {
  const body: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: `mindos-${Date.now()}`,
    method,
    params: params as Record<string, unknown>,
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'A2A-Version': '1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeoutMs: RPC_TIMEOUT_MS,
  });

  if (!res.ok) {
    throw new Error(`A2A RPC failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/* ── Discovery ─────────────────────────────────────────────────────────── */

/**
 * Discover an A2A agent at the given base URL.
 * Fetches /.well-known/agent-card.json and caches the result.
 */
export async function discoverAgent(baseUrl: string): Promise<RemoteAgent | null> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const cardUrl = `${cleanUrl}/.well-known/agent-card.json`;
  const id = urlToId(cleanUrl);

  // Check cache
  const cached = registry.get(id);
  if (cached && Date.now() - new Date(cached.discoveredAt).getTime() < CARD_CACHE_TTL_MS) {
    return cached;
  }

  try {
    const res = await fetchWithTimeout(cardUrl);
    if (!res.ok) return null;

    const card: AgentCard = await res.json();
    // Validate minimum required fields
    if (!card || typeof card.name !== 'string' || !card.name ||
        !Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
      return null;
    }

    // Find JSON-RPC endpoint
    const jsonRpcInterface = card.supportedInterfaces.find(i => i.protocolBinding === 'JSONRPC');
    if (!jsonRpcInterface) return null;

    const agent: RemoteAgent = {
      id,
      card,
      endpoint: jsonRpcInterface.url,
      discoveredAt: new Date().toISOString(),
      reachable: true,
    };

    registry.set(id, agent);
    return agent;
  } catch {
    // Mark as unreachable if previously cached
    if (cached) {
      cached.reachable = false;
      return cached;
    }
    return null;
  }
}

/**
 * Discover agents from a list of URLs (concurrent, best-effort).
 */
export async function discoverAgents(urls: string[]): Promise<RemoteAgent[]> {
  const results = await Promise.allSettled(urls.map(discoverAgent));
  return results
    .filter((r): r is PromiseFulfilledResult<RemoteAgent | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((a): a is RemoteAgent => a !== null);
}

/* ── Task Delegation ───────────────────────────────────────────────────── */

/**
 * Send a message to a remote agent via A2A JSON-RPC.
 * Returns the resulting task.
 */
export async function delegateTask(
  agentId: string,
  message: string,
  token?: string,
): Promise<A2ATask> {
  const agent = registry.get(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  if (!agent.reachable) throw new Error(`Agent not reachable: ${agent.card.name}`);

  const params: SendMessageParams = {
    message: {
      role: 'ROLE_USER',
      parts: [{ text: message }],
    },
    configuration: { blocking: true },
  };

  const response = await jsonRpcCall(agent.endpoint, 'SendMessage', params, token);

  if (response.error) {
    throw new Error(`A2A error [${response.error.code}]: ${response.error.message}`);
  }

  return response.result as A2ATask;
}

/**
 * Check the status of a task on a remote agent.
 */
export async function checkRemoteTaskStatus(
  agentId: string,
  taskId: string,
  token?: string,
): Promise<A2ATask> {
  const agent = registry.get(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const response = await jsonRpcCall(agent.endpoint, 'GetTask', { id: taskId }, token);

  if (response.error) {
    throw new Error(`A2A error [${response.error.code}]: ${response.error.message}`);
  }

  return response.result as A2ATask;
}

/* ── Registry Access ───────────────────────────────────────────────────── */

/** Get all discovered agents */
export function getDiscoveredAgents(): RemoteAgent[] {
  return [...registry.values()];
}

/** Get a specific agent by ID */
export function getAgent(id: string): RemoteAgent | undefined {
  return registry.get(id);
}

/** Clear the agent registry cache */
export function clearRegistry(): void {
  registry.clear();
}
