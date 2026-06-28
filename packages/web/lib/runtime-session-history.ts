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
  list?: (runtime: AgentRuntimeIdentity) => Promise<RuntimeSessionEntry[]>;
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
  async list(runtime) {
    const res = await fetch('/api/agent-runtimes/codex/threads?limit=30&useStateDbOnly=1', {
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

function normalizedRuntime(runtime: AgentRuntimeIdentity): AgentRuntimeIdentity {
  return compactAgentRuntimeIdentity(runtime) ?? runtime;
}

function getRuntimeSessionHistoryAdapter(
  runtime: AgentRuntimeIdentity | null | undefined,
): RuntimeSessionHistoryAdapter | null {
  if (runtime?.kind === 'codex') return CODEX_RUNTIME_SESSION_ADAPTER;
  return null;
}

export function getRuntimeSessionAdapterCapabilities(
  runtime: AgentRuntimeIdentity | null | undefined,
): RuntimeSessionAdapterCapabilities {
  return getRuntimeSessionHistoryAdapter(runtime)?.capabilities ?? UNSUPPORTED_RUNTIME_CAPABILITIES;
}

export async function listRuntimeSessions(
  runtime: AgentRuntimeIdentity,
): Promise<RuntimeSessionEntry[]> {
  const adapter = getRuntimeSessionHistoryAdapter(runtime);
  if (!adapter?.list) return [];
  return adapter.list(normalizedRuntime(runtime));
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
