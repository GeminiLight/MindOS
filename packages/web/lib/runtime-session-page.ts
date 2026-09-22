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
export interface RuntimeSessionPage { entries: RuntimeSessionEntry[]; nextCursor: string | null; warning?: string }

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
  return parsePage(await response.json(), runtime, runtime.kind === 'codex' ? 'data' : 'sessions');
}


function parsePage(body: unknown, runtime: AgentRuntimeIdentity, key: 'data' | 'sessions'): RuntimeSessionPage {
  const invalid = () => new Error(`Unexpected ${runtime.name} session response. Refresh or check the Agent connection.`);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  const record = body as Record<string, unknown>;
  const rows = record[key];
  if (!Array.isArray(rows) || (record.nextCursor != null && typeof record.nextCursor !== 'string')) throw invalid();
  const entries = rows.map(row => normalizeRuntimeSessionEntry(row, runtime));
  if (entries.some(row => row === null)) throw invalid();
  return { entries: entries as RuntimeSessionEntry[], nextCursor: (record.nextCursor as string | undefined) || null };
}


type CombinedCursor = { version: 1; runtime: string; query: string; cwd: string; protocol: string | null; native: string | null };

function combinedCursor(runtime: AgentRuntimeIdentity, options: RuntimeSessionPageOptions, cwd?: string): CombinedCursor {
  const initial: CombinedCursor = { version: 1, runtime: runtime.id, query: options.query?.trim() ?? '', cwd: cwd ?? '', protocol: '', native: '' };
  if (!options.cursor) return initial;
  try {
    const value = JSON.parse(options.cursor) as CombinedCursor;
    if (value.version !== 1 || value.runtime !== initial.runtime || value.query !== initial.query || value.cwd !== initial.cwd
      || ![value.protocol, value.native].every(cursor => cursor === null || typeof cursor === 'string')) throw new Error();
    return value;
  } catch { throw new Error('Invalid session page cursor. Refresh the session list.'); }
}

async function listAcpWithTranscripts(runtime: AgentRuntimeIdentity, options: RuntimeSessionPageOptions, cwd?: string, signal?: AbortSignal): Promise<RuntimeSessionPage> {
  const cursor = combinedCursor(runtime, options, cwd);
  const params = new URLSearchParams({ runtimeId: runtime.id, page: '1', limit: '30' });
  if (cwd) params.set('cwd', cwd);
  if (options.query?.trim()) params.set('query', options.query.trim());
  if (cursor.native) params.set('cursor', cursor.native);
  type SourcePage = RuntimeSessionPage & { unsupported?: boolean; skipped?: boolean };
  const read = async (url: string, init: RequestInit): Promise<SourcePage> => {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(new Error(`${runtime.name} session source timed out. Retry to load the remaining sessions.`)), 12_000);
    try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const body = await response.json();
    if (response.status === 501) return { entries: [], nextCursor: null, unsupported: true };
    if (!response.ok) throw new Error(body?.error || `Cannot list ${runtime.name} sessions (${response.status}).`);
    return parsePage(body, runtime, 'sessions');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  const skipped = (): Promise<SourcePage> => Promise.resolve({ entries: [], nextCursor: null, skipped: true });
  const results = await Promise.allSettled([
    cursor.protocol === null ? skipped() : read('/api/acp/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_sessions', agentId: runtime.id, ...(cwd ? { cwd } : {}), ...(cursor.protocol ? { cursor: cursor.protocol } : {}) }),
    }),
    cursor.native === null ? skipped() : read(`/api/agent-runtimes/external-sessions?${params}`, {}),
  ]);
  if (signal?.aborted) throw signal.reason;
  const entries = new Map<string, RuntimeSessionEntry>();
  const failures: string[] = [];
  let completedSource = false;
  let supportedSource = false;
  for (const [index, result] of results.entries()) {
    const source = index === 0 ? 'protocol' : 'native';
    if (result.status === 'rejected') {
      failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      continue; // Retain the failed source's cursor, including its first page.
    }
    const page = result.value;
    if (!page.skipped) completedSource = true;
    if (!page.skipped && !page.unsupported) supportedSource = true;
    if (page.nextCursor && page.nextCursor === cursor[source]) throw new Error('The Agent returned a repeated page. Refresh the session list.');
    cursor[source] = page.nextCursor;
    for (const entry of page.entries) {
      const defined = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined && value !== null));
      entries.set(entry.id, { ...entries.get(entry.id), ...defined } as RuntimeSessionEntry);
    }
  }
  if (failures.length && !supportedSource) throw new Error(failures.join(' '));
  if (completedSource && !supportedSource && !entries.size) throw new Error(`${runtime.name} does not expose session history through either connected source.`);
  const nextCursor = cursor.protocol !== null || cursor.native !== null ? JSON.stringify(cursor) : null;
  return { entries: [...entries.values()], nextCursor, ...(failures.length ? { warning: failures.join(' ') } : {}) };
}
