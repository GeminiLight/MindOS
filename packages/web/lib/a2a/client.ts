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
  DelegationRecord,
} from './types';
import {
  validateA2aDiscoveryUrl,
  validateA2aEndpointUrl,
  type A2aDiscoveryPolicyOptions,
} from './discovery-policy';

/* ── Constants ─────────────────────────────────────────────────────────── */

const DISCOVERY_TIMEOUT_MS = 5_000;
const RPC_TIMEOUT_MS = 30_000;
const CARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const A2A_TASK_STATES = new Set([
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

export interface DelegateTaskOptions {
  signal?: AbortSignal;
}

/* ── Agent Registry (in-memory cache) ──────────────────────────────────── */

const registry = new Map<string, RemoteAgent>();

/* ── Delegation History ────────────────────────────────────────────────── */

const delegationHistory: DelegationRecord[] = [];

/** Get all delegation history records */
export function getDelegationHistory(): DelegationRecord[] {
  return [...delegationHistory];
}

/** Clear all delegation history records */
export function clearDelegationHistory(): void {
  delegationHistory.length = 0;
}

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

function findJsonRpcEndpoint(card: AgentCard, policyOptions?: A2aDiscoveryPolicyOptions): string | null {
  for (const agentInterface of card.supportedInterfaces) {
    if (!agentInterface || typeof agentInterface !== 'object') continue;
    if (agentInterface.protocolBinding !== 'JSONRPC') continue;

    const endpoint = validateA2aEndpointUrl(agentInterface.url, policyOptions);
    if (endpoint.ok) return endpoint.url;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertA2ATask(value: unknown): A2ATask {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.status)) {
    throw new Error('Invalid A2A task response from remote agent');
  }

  const state = value.status.state;
  if (typeof state !== 'string' || !A2A_TASK_STATES.has(state)) {
    throw new Error('Invalid A2A task response from remote agent');
  }

  return value as unknown as A2ATask;
}

/* ── HTTP helpers ──────────────────────────────────────────────────────── */

function abortErrorFromSignal(signal?: AbortSignal, fallback = 'A2A delegation canceled.'): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  if (typeof DOMException !== 'undefined' && reason instanceof DOMException) return new Error(reason.message);
  const error = new Error(typeof reason === 'string' && reason ? reason : fallback);
  error.name = 'AbortError';
  return error;
}

async function fetchWithTimeout(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = DISCOVERY_TIMEOUT_MS, signal, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let removeAbortListener: (() => void) | undefined;
  try {
    if (signal?.aborted) throw abortErrorFromSignal(signal);
    if (signal) {
      const onAbort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    removeAbortListener?.();
  }
}

async function jsonRpcCall(endpoint: string, method: string, params: unknown, token?: string, options: { signal?: AbortSignal } = {}): Promise<JsonRpcResponse> {
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
    signal: options.signal,
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
export async function discoverAgent(
  baseUrl: string,
  policyOptions?: A2aDiscoveryPolicyOptions,
): Promise<RemoteAgent | null> {
  const policy = validateA2aDiscoveryUrl(baseUrl, policyOptions);
  if (!policy.ok) return null;
  const cleanUrl = policy.url;

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

    // Find a usable JSON-RPC endpoint. Agent cards are remote input, so the
    // endpoint URL needs the same trust-boundary checks as the discovery URL.
    const jsonRpcEndpoint = findJsonRpcEndpoint(card, policyOptions);
    if (!jsonRpcEndpoint) return null;

    const agent: RemoteAgent = {
      id,
      card,
      endpoint: jsonRpcEndpoint,
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
export async function discoverAgents(urls: string[], policyOptions?: A2aDiscoveryPolicyOptions): Promise<RemoteAgent[]> {
  const results = await Promise.allSettled(urls.map((url) => discoverAgent(url, policyOptions)));
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
  options: DelegateTaskOptions = {},
): Promise<A2ATask> {
  const agent = registry.get(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  if (!agent.reachable) throw new Error(`Agent not reachable: ${agent.card.name}`);

  const record: DelegationRecord = {
    id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    agentName: agent.card.name,
    message,
    status: 'pending',
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null,
  };
  delegationHistory.push(record);

  const params: SendMessageParams = {
    message: {
      role: 'ROLE_USER',
      parts: [{ text: message }],
    },
    configuration: { blocking: true },
  };

  try {
    const response = await jsonRpcCall(agent.endpoint, 'SendMessage', params, token, { signal: options.signal });

    if (response.error) {
      record.status = 'failed';
      record.completedAt = new Date().toISOString();
      record.error = `A2A error [${response.error.code}]: ${response.error.message}`;
      throw new Error(record.error);
    }

    const task = assertA2ATask(response.result);
    record.status = 'completed';
    record.completedAt = new Date().toISOString();
    record.result = task.artifacts?.[0]?.parts?.[0]?.text ?? null;
    return task;
  } catch (err) {
    if (options.signal?.aborted) {
      record.status = 'canceled';
      record.completedAt = new Date().toISOString();
      record.error = 'A2A delegation canceled.';
      throw abortErrorFromSignal(options.signal);
    }
    if (record.status === 'pending') {
      record.status = 'failed';
      record.completedAt = new Date().toISOString();
      record.error = (err as Error).message;
    }
    throw err;
  }
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

  return assertA2ATask(response.result);
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
