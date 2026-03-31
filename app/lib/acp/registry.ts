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

  // Extract transport/command/args from the `distribution` field (ACP registry v1 format)
  const { transport, command, packageName, args: distArgs } = extractDistribution(entry);

  return {
    id: id || name,
    name: name || id,
    description: String(entry.description ?? ''),
    version: entry.version ? String(entry.version) : undefined,
    transport,
    command,
    packageName,
    args: distArgs ?? (Array.isArray(entry.args) ? entry.args.map(String) : undefined),
    env: entry.env && typeof entry.env === 'object' ? entry.env as Record<string, string> : undefined,
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : undefined,
    homepage: entry.homepage ?? entry.website ? String(entry.homepage ?? entry.website) : undefined,
  };
}

/**
 * Extract transport type, command, packageName, and args from
 * the registry's `distribution` field. Falls back to legacy
 * `transport`/`command` fields if `distribution` is absent.
 */
function extractDistribution(entry: Record<string, unknown>): {
  transport: AcpRegistryEntry['transport'];
  command: string;
  packageName?: string;
  args?: string[];
} {
  const dist = entry.distribution as Record<string, unknown> | undefined;

  if (dist && typeof dist === 'object') {
    // npx transport: { npx: { package: "@scope/name@version", args?: [...] } }
    if (dist.npx && typeof dist.npx === 'object') {
      const npx = dist.npx as Record<string, unknown>;
      const fullPkg = String(npx.package ?? '');
      // Strip version suffix: "@scope/name@1.2.3" -> "@scope/name"
      const packageName = stripVersion(fullPkg);
      const args = Array.isArray(npx.args) ? npx.args.map(String) : undefined;
      // Also extract env if present at npx level
      return { transport: 'npx', command: packageName, packageName, args };
    }

    // uvx transport: { uvx: { package: "name@version", args?: [...] } }
    if (dist.uvx && typeof dist.uvx === 'object') {
      const uvx = dist.uvx as Record<string, unknown>;
      const fullPkg = String(uvx.package ?? '');
      const packageName = stripVersion(fullPkg);
      const args = Array.isArray(uvx.args) ? uvx.args.map(String) : undefined;
      return { transport: 'uvx', command: packageName, packageName, args };
    }

    // binary transport: { binary: { "linux-x86_64": { cmd, args } } }
    if (dist.binary && typeof dist.binary === 'object') {
      return { transport: 'binary', command: '' };
    }
  }

  // Legacy fallback: read flat `transport`/`command` fields
  return {
    transport: normalizeTransport(entry.transport),
    command: String(entry.command ?? entry.cmd ?? ''),
  };
}

/** Strip trailing @version from a package name. "@scope/pkg@1.0" -> "@scope/pkg" */
function stripVersion(pkg: string): string {
  if (!pkg) return '';
  // Scoped: @scope/name@version — find the last @ that isn't position 0
  const lastAt = pkg.lastIndexOf('@');
  if (lastAt > 0) return pkg.slice(0, lastAt);
  return pkg;
}

function normalizeTransport(raw: unknown): AcpRegistryEntry['transport'] {
  const t = String(raw ?? 'stdio').toLowerCase();
  if (t === 'npx' || t === 'uvx' || t === 'binary') return t;
  return 'stdio';
}
