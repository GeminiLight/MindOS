/**
 * ACP Registry Client — Fetch and cache the ACP agent registry.
 * The registry lists available ACP agents (Gemini CLI, Claude, Copilot, etc.)
 * with their transport type, command, and metadata.
 */

import type { AcpRegistry, AcpRegistryEntry } from './types';

/* ── Constants ─────────────────────────────────────────────────────────── */

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 10_000;

/* ── Cache ─────────────────────────────────────────────────────────────── */

let cachedRegistry: AcpRegistry | null = null;

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Fetch the ACP registry from the CDN. Caches for 1 hour.
 * Returns null if the fetch fails.
 */
export async function fetchAcpRegistry(): Promise<AcpRegistry | null> {
  // Return cached if still valid
  if (cachedRegistry && Date.now() - new Date(cachedRegistry.fetchedAt).getTime() < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return cachedRegistry ?? null;

    const data = await res.json();

    // The registry JSON may have varying shapes; normalize it
    const agents: AcpRegistryEntry[] = parseRegistryEntries(data);

    cachedRegistry = {
      version: data.version ?? '1',
      agents,
      fetchedAt: new Date().toISOString(),
    };

    return cachedRegistry;
  } catch {
    // Return stale cache if available, otherwise null
    return cachedRegistry ?? null;
  }
}

/**
 * Get all available ACP agents from the registry.
 */
export async function getAcpAgents(): Promise<AcpRegistryEntry[]> {
  const registry = await fetchAcpRegistry();
  return registry?.agents ?? [];
}

/**
 * Find a specific ACP agent by ID.
 */
export async function findAcpAgent(id: string): Promise<AcpRegistryEntry | null> {
  const agents = await getAcpAgents();
  return agents.find(a => a.id === id) ?? null;
}

/**
 * Clear the registry cache (useful for testing).
 */
export function clearRegistryCache(): void {
  cachedRegistry = null;
}

/* ── Internal ──────────────────────────────────────────────────────────── */

/**
 * Parse raw registry JSON into typed entries.
 * Handles both array and object-keyed formats.
 */
function parseRegistryEntries(data: unknown): AcpRegistryEntry[] {
  if (!data || typeof data !== 'object') return [];

  // If data has an `agents` array, use that
  const obj = data as Record<string, unknown>;
  let rawAgents: unknown[];

  if (Array.isArray(obj.agents)) {
    rawAgents = obj.agents;
  } else if (Array.isArray(data)) {
    rawAgents = data;
  } else {
    // Object-keyed format: { "agent-id": { ... }, ... }
    rawAgents = Object.entries(obj)
      .filter(([key]) => key !== 'version' && key !== '$schema')
      .map(([key, val]) => ({ ...(val as object), id: key }));
  }

  return rawAgents
    .map(normalizeEntry)
    .filter((e): e is AcpRegistryEntry => e !== null);
}

function normalizeEntry(raw: unknown): AcpRegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;

  const id = String(entry.id ?? entry.name ?? '');
  const name = String(entry.name ?? entry.id ?? '');
  if (!id && !name) return null;

  return {
    id: id || name,
    name: name || id,
    description: String(entry.description ?? ''),
    version: entry.version ? String(entry.version) : undefined,
    transport: normalizeTransport(entry.transport),
    command: String(entry.command ?? entry.cmd ?? ''),
    args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
    env: entry.env && typeof entry.env === 'object' ? entry.env as Record<string, string> : undefined,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : undefined,
    homepage: entry.homepage ? String(entry.homepage) : undefined,
  };
}

function normalizeTransport(raw: unknown): AcpRegistryEntry['transport'] {
  const t = String(raw ?? 'stdio').toLowerCase();
  if (t === 'npx' || t === 'uvx' || t === 'binary') return t;
  return 'stdio';
}
