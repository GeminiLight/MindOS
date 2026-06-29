import type { AgentRuntimeIdentity, ChatSession, CodexThreadListResponse, Message, RuntimeSessionBinding } from '@/lib/types';
import {
  compactAgentRuntimeIdentity,
  getMatchingRuntimeSessionBinding,
} from '@/lib/ask-agent';
import {
  codexThreadToRuntimeSessionEntry,
  readCodexThreadHistory,
  runtimeSessionEntryToCodexThread,
} from '@/lib/codex-thread-import';
import {
  normalizeRuntimeSessionEntry,
  runtimeSessionEntryAttachBinding,
  runtimeSessionEntryTurnsToMessages,
  runtimeSessionEntryTitle,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';

type AttachRuntimeSession = (
  runtime: AgentRuntimeIdentity,
  binding: {
    externalSessionId: string;
    cwd?: string;
    status?: RuntimeSessionBinding['status'];
    updatedAt?: number | string;
  },
  metadata?: { title?: string; messages?: Message[] },
) => boolean;

export interface RuntimeSessionListOptions {
  cwd?: string;
  sessionId?: string;
  limit?: number;
}

export type RuntimeSessionHistoryImportResult =
  | { status: 'skipped'; reason: 'unsupported-runtime' | 'has-local-messages' | 'missing-binding' | 'missing-history' }
  | { status: 'imported'; messageCount: number }
  | { status: 'refused' };

export interface RuntimeSessionAdapterCapabilities {
  supportsList: boolean;
  supportsReadHistory: boolean;
  supportsAttachExisting: boolean;
  supportsFork: boolean;
  supportsArchive: boolean;
}

interface RuntimeSessionHistoryAdapter {
  capabilities: RuntimeSessionAdapterCapabilities;
  list?: (runtime: AgentRuntimeIdentity, options?: RuntimeSessionListOptions) => Promise<RuntimeSessionEntry[]>;
  readHistory?: (entry: RuntimeSessionEntry, runtime: AgentRuntimeIdentity) => Promise<{
    entry: RuntimeSessionEntry;
    messages: Message[];
  }>;
  fork?: (entry: RuntimeSessionEntry, runtime: AgentRuntimeIdentity) => Promise<RuntimeSessionEntry>;
  archive?: (entry: RuntimeSessionEntry, runtime: AgentRuntimeIdentity) => Promise<void>;
}

const UNSUPPORTED_RUNTIME_CAPABILITIES: RuntimeSessionAdapterCapabilities = {
  supportsList: false,
  supportsReadHistory: false,
  supportsAttachExisting: false,
  supportsFork: false,
  supportsArchive: false,
};

const CODEX_RUNTIME_SESSION_ADAPTER: RuntimeSessionHistoryAdapter = {
  capabilities: {
    supportsList: true,
    supportsReadHistory: true,
    supportsAttachExisting: true,
    supportsFork: true,
    supportsArchive: true,
  },
  async list(runtime, options) {
    const params = new URLSearchParams({ limit: '30', useStateDbOnly: '1' });
    if (options?.cwd?.trim()) params.set('cwd', options.cwd.trim());
    const res = await fetch(`/api/agent-runtimes/codex/threads?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      let message = `Failed to load runtime sessions (${res.status}).`;
      try {
        const body = await res.json() as { error?: string; message?: string };
        message = body.error || body.message || message;
      } catch {
        // keep status-derived message
      }
      throw new Error(message);
    }

    const body = await res.json() as Partial<CodexThreadListResponse>;
    return Array.isArray(body.data)
      ? body.data
        .map((thread) => normalizeRuntimeSessionEntry(thread, runtime))
        .filter((entry): entry is RuntimeSessionEntry => Boolean(entry))
      : [];
  },
  async readHistory(entry, runtime) {
    const { thread, messages } = await readCodexThreadHistory(
      runtimeSessionEntryToCodexThread(entry),
      runtime,
    );
    return {
      entry: codexThreadToRuntimeSessionEntry(thread, runtime),
      messages,
    };
  },
  async fork(entry, runtime) {
    const res = await fetch(`/api/agent-runtimes/codex/threads/${encodeURIComponent(entry.id)}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.cwd ? { cwd: entry.cwd } : {}),
    });
    if (!res.ok) {
      let message = `Failed to fork ${runtime.name} session (${res.status}).`;
      try {
        const body = await res.json() as { error?: string; message?: string };
        message = body.error || body.message || message;
      } catch {
        // keep status-derived message
      }
      throw new Error(message);
    }
    const body = await res.json() as { thread?: unknown };
    const forked = normalizeRuntimeSessionEntry(body.thread, runtime);
    if (!forked) throw new Error(`Failed to read forked ${runtime.name} session.`);
    return forked;
  },
  async archive(entry, runtime) {
    const res = await fetch(`/api/agent-runtimes/codex/threads/${encodeURIComponent(entry.id)}/archive`, {
      method: 'POST',
    });
    if (!res.ok) {
      let message = `Failed to archive ${runtime.name} session (${res.status}).`;
      try {
        const body = await res.json() as { error?: string; message?: string };
        message = body.error || body.message || message;
      } catch {
        // keep status-derived message
      }
      throw new Error(message);
    }
  },
};

function runtimeSessionFetchError(
  response: Response,
  fallback: string,
): Promise<Error> {
  return response.json()
    .then((body: { error?: string; message?: string }) => new Error(body.error || body.message || fallback))
    .catch(() => new Error(fallback));
}

function entryHasTranscript(entry: RuntimeSessionEntry): boolean {
  return Array.isArray(entry.turns) && entry.turns.length > 0;
}

function newerTimestamp(
  left: RuntimeSessionEntry['updatedAt'],
  right: RuntimeSessionEntry['updatedAt'],
): RuntimeSessionEntry['updatedAt'] {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const leftMs = typeof left === 'number' ? left : Date.parse(left);
  const rightMs = typeof right === 'number' ? right : Date.parse(right);
  if (!Number.isFinite(leftMs)) return right;
  if (!Number.isFinite(rightMs)) return left;
  return rightMs > leftMs ? right : left;
}

function mergeRuntimeSessionEntry(
  primary: RuntimeSessionEntry,
  secondary: RuntimeSessionEntry,
): RuntimeSessionEntry {
  const primaryHasTranscript = entryHasTranscript(primary);
  const secondaryHasTranscript = entryHasTranscript(secondary);
  const transcriptEntry = secondaryHasTranscript
    ? secondary
    : primaryHasTranscript
      ? primary
      : null;

  return {
    ...primary,
    title: primary.title ?? secondary.title,
    preview: primary.preview ?? secondary.preview,
    cwd: primary.cwd ?? secondary.cwd,
    createdAt: primary.createdAt ?? secondary.createdAt,
    updatedAt: newerTimestamp(primary.updatedAt, secondary.updatedAt),
    status: primary.status ?? secondary.status,
    archived: primary.archived ?? secondary.archived,
    messageCount: transcriptEntry?.messageCount ?? primary.messageCount ?? secondary.messageCount,
    turnCount: transcriptEntry?.turnCount ?? primary.turnCount ?? secondary.turnCount,
    ...(Array.isArray(transcriptEntry?.turns) ? { turns: transcriptEntry.turns } : {}),
    raw: primary.raw ?? secondary.raw,
  };
}

function mergeRuntimeSessionEntries(
  primary: RuntimeSessionEntry[],
  secondary: RuntimeSessionEntry[],
): RuntimeSessionEntry[] {
  const byId = new Map<string, RuntimeSessionEntry>();
  for (const entry of primary) byId.set(entry.id, entry);
  for (const entry of secondary) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? mergeRuntimeSessionEntry(existing, entry) : entry);
  }
  return Array.from(byId.values());
}

async function fetchExternalRuntimeSessions(
  runtime: AgentRuntimeIdentity,
  options?: RuntimeSessionListOptions,
): Promise<RuntimeSessionEntry[]> {
  const params = new URLSearchParams({
    runtimeId: runtime.id,
    limit: String(options?.limit ?? 30),
  });
  if (options?.cwd?.trim()) params.set('cwd', options.cwd.trim());
  if (options?.sessionId?.trim()) params.set('sessionId', options.sessionId.trim());

  const res = await fetch(`/api/agent-runtimes/external-sessions?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw await runtimeSessionFetchError(
      res,
      `Failed to load native ${runtime.name} session transcripts (${res.status}).`,
    );
  }

  const body = await res.json() as { sessions?: unknown[] };
  return Array.isArray(body.sessions)
    ? body.sessions
      .map((session) => normalizeRuntimeSessionEntry(session, runtime))
      .filter((entry): entry is RuntimeSessionEntry => Boolean(entry))
    : [];
}

async function listAcpRuntimeSessions(
  runtime: AgentRuntimeIdentity,
  options?: RuntimeSessionListOptions,
): Promise<RuntimeSessionEntry[]> {
  const res = await fetch('/api/acp/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'list_sessions',
      agentId: runtime.id,
      ...(options?.cwd?.trim() ? { cwd: options.cwd.trim() } : {}),
    }),
  });
  if (!res.ok) {
    throw await runtimeSessionFetchError(
      res,
      `Failed to load ${runtime.name} sessions (${res.status}).`,
    );
  }

  const body = await res.json() as { sessions?: unknown[] };
  return Array.isArray(body.sessions)
    ? body.sessions
      .map((session) => normalizeRuntimeSessionEntry(session, runtime))
      .filter((entry): entry is RuntimeSessionEntry => Boolean(entry))
    : [];
}

const ACP_RUNTIME_SESSION_ADAPTER: RuntimeSessionHistoryAdapter = {
  capabilities: {
    supportsList: true,
    supportsReadHistory: true,
    supportsAttachExisting: true,
    supportsFork: false,
    supportsArchive: false,
  },
  async list(runtime, options) {
    const [acpResult, externalResult] = await Promise.allSettled([
      listAcpRuntimeSessions(runtime, options),
      fetchExternalRuntimeSessions(runtime, options),
    ]);

    const externalEntries = externalResult.status === 'fulfilled' ? externalResult.value : [];
    if (acpResult.status === 'rejected') {
      if (externalEntries.length > 0) return externalEntries;
      throw acpResult.reason instanceof Error ? acpResult.reason : new Error(String(acpResult.reason));
    }

    return mergeRuntimeSessionEntries(acpResult.value, externalEntries);
  },
  async readHistory(entry, runtime) {
    let normalizedEntry = normalizeRuntimeSessionEntry(entry, runtime)
      ?? normalizeRuntimeSessionEntry(entry.raw ?? entry, runtime)
      ?? { ...entry, runtime };
    let messages = runtimeSessionEntryTurnsToMessages(normalizedEntry, runtime);

    if (messages.length === 0) {
      const externalEntries = await fetchExternalRuntimeSessions(runtime, {
        cwd: normalizedEntry.cwd,
        sessionId: normalizedEntry.id,
        limit: 1,
      }).catch(() => []);
      const externalEntry = externalEntries.find((item) => item.id === normalizedEntry.id) ?? externalEntries[0];
      if (externalEntry) {
        normalizedEntry = mergeRuntimeSessionEntry(normalizedEntry, externalEntry);
        messages = runtimeSessionEntryTurnsToMessages(normalizedEntry, runtime);
      }
    }

    return {
      entry: normalizedEntry,
      messages,
    };
  },
};

function normalizedRuntime(runtime: AgentRuntimeIdentity): AgentRuntimeIdentity {
  return compactAgentRuntimeIdentity(runtime) ?? runtime;
}

function getRuntimeSessionHistoryAdapter(
  runtime: AgentRuntimeIdentity | null | undefined,
): RuntimeSessionHistoryAdapter | null {
  if (runtime?.kind === 'codex') return CODEX_RUNTIME_SESSION_ADAPTER;
  if (runtime?.kind === 'acp') return ACP_RUNTIME_SESSION_ADAPTER;
  return null;
}

export function getRuntimeSessionAdapterCapabilities(
  runtime: AgentRuntimeIdentity | null | undefined,
): RuntimeSessionAdapterCapabilities {
  return getRuntimeSessionHistoryAdapter(runtime)?.capabilities ?? UNSUPPORTED_RUNTIME_CAPABILITIES;
}

export async function listRuntimeSessions(
  runtime: AgentRuntimeIdentity,
  options?: RuntimeSessionListOptions,
): Promise<RuntimeSessionEntry[]> {
  const adapter = getRuntimeSessionHistoryAdapter(runtime);
  if (!adapter?.list) return [];
  return adapter.list(normalizedRuntime(runtime), options);
}

export async function readRuntimeSessionHistory(
  entry: RuntimeSessionEntry,
): Promise<{ entry: RuntimeSessionEntry; messages: Message[] }> {
  const runtime = normalizedRuntime(entry.runtime);
  const adapter = getRuntimeSessionHistoryAdapter(runtime);
  if (!adapter?.readHistory) throw new Error(`${runtime.name} does not expose readable session history yet.`);
  return adapter.readHistory({ ...entry, runtime }, runtime);
}

export async function forkRuntimeSession(
  entry: RuntimeSessionEntry,
): Promise<RuntimeSessionEntry> {
  const runtime = normalizedRuntime(entry.runtime);
  const adapter = getRuntimeSessionHistoryAdapter(runtime);
  if (!adapter?.fork) throw new Error(`${runtime.name} does not support session fork from MindOS yet.`);
  return adapter.fork({ ...entry, runtime }, runtime);
}

export async function archiveRuntimeSession(
  entry: RuntimeSessionEntry,
): Promise<void> {
  const runtime = normalizedRuntime(entry.runtime);
  const adapter = getRuntimeSessionHistoryAdapter(runtime);
  if (!adapter?.archive) throw new Error(`${runtime.name} does not support session archive from MindOS yet.`);
  return adapter.archive({ ...entry, runtime }, runtime);
}

function runtimeSessionEntryFromBinding(
  session: ChatSession,
  runtime: AgentRuntimeIdentity,
  externalSessionId: string,
  binding: RuntimeSessionBinding,
): RuntimeSessionEntry {
  return {
    id: externalSessionId,
    runtime,
    ...(session.title ? { title: session.title } : {}),
    ...(binding.cwd ? { cwd: binding.cwd } : {}),
    status: binding.status ?? 'active',
    updatedAt: binding.updatedAt,
    ...(binding.status === 'archived' ? { archived: true } : {}),
  };
}

export async function importBoundRuntimeSessionHistory(
  session: ChatSession,
  runtime: AgentRuntimeIdentity | null,
  attachRuntimeSession: AttachRuntimeSession,
): Promise<RuntimeSessionHistoryImportResult> {
  if (!runtime) return { status: 'skipped', reason: 'unsupported-runtime' };
  const safeRuntime = normalizedRuntime(runtime);
  const adapter = getRuntimeSessionHistoryAdapter(safeRuntime);
  if (!adapter?.readHistory) return { status: 'skipped', reason: 'unsupported-runtime' };
  if (session.messages.length > 0) return { status: 'skipped', reason: 'has-local-messages' };

  const binding = getMatchingRuntimeSessionBinding(session, safeRuntime);
  const externalSessionId = binding?.externalSessionId?.trim();
  if (!binding || !externalSessionId) return { status: 'skipped', reason: 'missing-binding' };

  const { entry: readEntry, messages } = await adapter.readHistory(
    runtimeSessionEntryFromBinding(session, safeRuntime, externalSessionId, binding),
    safeRuntime,
  );
  if (messages.length === 0) return { status: 'skipped', reason: 'missing-history' };

  const attached = attachRuntimeSession(safeRuntime, runtimeSessionEntryAttachBinding({
    ...readEntry,
    status: binding.status && binding.status !== 'active'
      ? binding.status
      : readEntry.status,
  }), {
    title: session.title || runtimeSessionEntryTitle(readEntry),
    messages,
  });

  if (!attached) return { status: 'refused' };
  return { status: 'imported', messageCount: messages.length };
}
