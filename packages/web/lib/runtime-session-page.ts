import type { AgentRuntimeIdentity } from '@/lib/types';
import { normalizeRuntimeSessionEntry, type RuntimeSessionEntry } from './runtime-session-entry';

export interface RuntimeSessionPageOptions {
  scope?: 'all' | 'project';
  cwd?: string;
  cursor?: string;
  query?: string;
  archived?: boolean;
  signal?: AbortSignal;
}
export interface RuntimeSessionPage { entries: RuntimeSessionEntry[]; nextCursor: string | null }

/** Page metadata first. Native histories are fetched only when a user opens one. */
export async function listRuntimeSessionPage(runtime: AgentRuntimeIdentity, options: RuntimeSessionPageOptions = {}): Promise<RuntimeSessionPage> {
  const scope = options.scope ?? 'all';
  if (scope === 'project' && !options.cwd?.trim()) throw new Error('Select a working directory before browsing this project.');
  const cwd = scope === 'project' ? options.cwd?.trim() : undefined;
  const native = runtime.kind === 'claude' || runtime.id === 'opencode';
  let url: string;
  const init: RequestInit = { cache: 'no-store', signal: options.signal ?? AbortSignal.timeout(20_000) };
  if (runtime.kind === 'codex' || native) {
    const params = new URLSearchParams({ limit: '30' });
    if (options.cursor) params.set('cursor', options.cursor);
    if (cwd) params.set('cwd', cwd);
    if (runtime.kind === 'codex') {
      params.set('scope', scope);
      params.set('useStateDbOnly', '0');
      params.set('archived', String(options.archived ?? false));
      if (options.query?.trim()) params.set('searchTerm', options.query.trim());
      url = `/api/agent-runtimes/codex/threads?${params}`;
    } else {
      params.set('runtimeId', runtime.id); params.set('page', '1');
      if (options.query?.trim()) params.set('query', options.query.trim());
      url = `/api/agent-runtimes/external-sessions?${params}`;
    }
  } else {
    return listAcpWithTranscripts(runtime, options, cwd, init.signal ?? undefined);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(body.error || body.message || `Cannot load ${runtime.name} sessions (${response.status}).`);
  }
  const body = await response.json() as { data?: unknown[]; sessions?: unknown[]; nextCursor?: string };
  const rows = runtime.kind === 'codex' ? body.data : body.sessions;
  return {
    entries: (Array.isArray(rows) ? rows : []).map(row => normalizeRuntimeSessionEntry(row, runtime)).filter((row): row is RuntimeSessionEntry => row !== null),
    nextCursor: body.nextCursor || null,
  };
}


async function listAcpWithTranscripts(runtime: AgentRuntimeIdentity, options: RuntimeSessionPageOptions, cwd?: string, signal?: AbortSignal): Promise<RuntimeSessionPage> {
  const params = new URLSearchParams({ runtimeId: runtime.id, limit: '30' });
  if (cwd) params.set('cwd', cwd);
  const read = async (url: string, init: RequestInit) => {
    const response = await fetch(url, { ...init, signal, cache: 'no-store' });
    const body = await response.json() as { sessions?: unknown[]; nextCursor?: string; error?: string };
    if (!response.ok) throw new Error(body.error || `Cannot list ${runtime.name} sessions (${response.status}).`);
    return body;
  };
  const [protocol, native] = await Promise.allSettled([
    read('/api/acp/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list_sessions', agentId: runtime.id, ...(cwd ? { cwd } : {}), ...(options.cursor ? { cursor: options.cursor } : {}) }) }),
    options.cursor ? Promise.resolve({ sessions: [] }) : read(`/api/agent-runtimes/external-sessions?${params}`, {}),
  ]);
  if (signal?.aborted) throw signal.reason;
  const nativeRows = native.status === 'fulfilled' ? native.value.sessions ?? [] : [];
  if (protocol.status === 'rejected' && nativeRows.length === 0) throw protocol.reason;
  const protocolRows = protocol.status === 'fulfilled' ? protocol.value.sessions ?? [] : [];
  const entries = new Map<string, RuntimeSessionEntry>();
  for (const row of [...protocolRows, ...nativeRows]) {
    const entry = normalizeRuntimeSessionEntry(row, runtime);
    if (entry) {
      const previous = entries.get(entry.id);
      const defined = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== null));
      entries.set(entry.id, { ...previous, ...defined } as RuntimeSessionEntry);
    }
  }
  return { entries: [...entries.values()], nextCursor: protocol.status === 'fulfilled' ? protocol.value.nextCursor || null : null };
}
