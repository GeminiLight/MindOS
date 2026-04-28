/**
 * ACP Registry Client — Fetch and cache the ACP agent registry.
 * The registry lists available ACP agents (Gemini CLI, Claude, Copilot, etc.)
 * with their transport type, command, and metadata.
 *
 * Strategy: Built-in registry from AGENT_DESCRIPTORS is always available as a
 * baseline. CDN registry is fetched in the background and merged on top —
 * CDN entries update existing ones, new CDN-only entries are appended.
 * If CDN is unreachable (e.g. in China), the built-in list still works.
 */

import type { AcpRegistry, AcpRegistryEntry } from './types.js';
import { AGENT_DESCRIPTORS, getDescriptorDisplayName, getDescriptorDescription, resolveAlias } from './agent-descriptors.js';

/* ── Constants ─────────────────────────────────────────────────────────── */

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — registry updates very rarely
const FETCH_TIMEOUT_MS = 3_000;

/* ── Built-in Registry (from AGENT_DESCRIPTORS) ────────────────────────── */

/**
 * Generate a baseline registry from the local AGENT_DESCRIPTORS.
 * AGENT_DESCRIPTORS contains only canonical entries (aliases are in AGENT_ALIASES),
 * so no deduplication is needed.
 */
function buildBuiltinRegistry(): AcpRegistryEntry[] {
  return Object.entries(AGENT_DESCRIPTORS).map(([id, desc]) => ({
    id,
    name: desc.displayName ?? id,
    description: desc.description ?? '',
    transport: (desc.cmd === 'npx' ? 'npx' : 'stdio') as AcpRegistryEntry['transport'],
    command: desc.cmd,
    args: desc.args,
    packageName: desc.installCmd?.match(/npm install -g (.+)/)?.[1],
  }));
}

let builtinAgents: AcpRegistryEntry[] | null = null;

function getBuiltinAgents(): AcpRegistryEntry[] {
  if (!builtinAgents) builtinAgents = buildBuiltinRegistry();
  return builtinAgents;
}

/* ── Cache ─────────────────────────────────────────────────────────────── */

let cachedRegistry: AcpRegistry | null = null;

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Fetch the ACP registry from the CDN and merge with built-in entries.
 * Caches for 7 days. Falls back to built-in registry if CDN is unreachable.
 */
export async function fetchAcpRegistry(): Promise<AcpRegistry> {
  // Return cached if still valid
  if (cachedRegistry && Date.now() - new Date(cachedRegistry.fetchedAt).getTime() < CACHE_TTL_MS) {
    return cachedRegistry;
  }

  const builtin = getBuiltinAgents();

  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return cachedRegistry ?? makeRegistry(builtin, 'builtin');
    }

    const data = await res.json();

    // The registry JSON may have varying shapes; normalize it
    const cdnAgents: AcpRegistryEntry[] = parseRegistryEntries(data);

    // Merge: CDN entries take precedence, built-in entries fill gaps
    const merged = mergeRegistries(builtin, cdnAgents);

    cachedRegistry = {
      version: data.version ?? '1',
      agents: merged,
      fetchedAt: new Date().toISOString(),
    };

    return cachedRegistry;
  } catch {
    // CDN unreachable — use built-in as baseline
    return cachedRegistry ?? makeRegistry(builtin, 'builtin');
  }
}

/**
 * Merge built-in and CDN registries.
 * - Same ID: keep built-in core fields, supplement with CDN metadata (tags, homepage, version)
 * - CDN alias of built-in entry: skip (avoids duplicate agents in UI)
 * - New CDN-only entry: add as-is
 */
function mergeRegistries(builtin: AcpRegistryEntry[], cdn: AcpRegistryEntry[]): AcpRegistryEntry[] {
  const byId = new Map<string, AcpRegistryEntry>();

  for (const entry of builtin) byId.set(entry.id, entry);

  for (const cdnEntry of cdn) {
    const existing = byId.get(cdnEntry.id);
    const canonicalId = resolveAlias(cdnEntry.id);
    const canonicalExisting = canonicalId !== cdnEntry.id ? byId.get(canonicalId) : undefined;

    if (existing) {
      // Same ID in both — keep built-in core, supplement with CDN metadata
      byId.set(cdnEntry.id, {
        ...existing,
        tags: cdnEntry.tags ?? existing.tags,
        homepage: cdnEntry.homepage ?? existing.homepage,
        version: cdnEntry.version ?? existing.version,
      });
    } else if (canonicalExisting) {
      // CDN entry is an alias of a built-in entry — skip to avoid duplicates
    } else {
      byId.set(cdnEntry.id, cdnEntry);
    }
  }

  return Array.from(byId.values());
}

function makeRegistry(agents: AcpRegistryEntry[], version: string): AcpRegistry {
  return { version, agents, fetchedAt: new Date().toISOString() };
}

/**
 * Get all available ACP agents from the registry.
 * Always returns at least the built-in agents, even if CDN is unreachable.
 */
export async function getAcpAgents(): Promise<AcpRegistryEntry[]> {
  const registry = await fetchAcpRegistry();
  return registry.agents;
}

/**
 * Find a specific ACP agent by ID (supports alias resolution).
 */
export async function findAcpAgent(id: string): Promise<AcpRegistryEntry | null> {
  const agents = await getAcpAgents();
  const canonical = resolveAlias(id);
  return agents.find(a => a.id === id || a.id === canonical) ?? null;
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

  const agentId = id || name;

  // Apply curated display name and description from local descriptors (if available)
  const curatedName = getDescriptorDisplayName(agentId);
  const curatedDesc = getDescriptorDescription(agentId);

  return {
    id: agentId,
    name: curatedName ?? name ?? id,
    description: curatedDesc ?? String(entry.description ?? ''),
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
