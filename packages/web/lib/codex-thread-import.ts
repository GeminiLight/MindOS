import type { AgentRuntimeIdentity, CodexThreadSummary, Message } from '@/lib/types';
import {
  normalizeRuntimeSessionEntry,
  runtimeSessionEntryMessageCount,
  runtimeSessionEntryTurnsToMessages,
  type RuntimeSessionEntry,
} from '@/lib/runtime-session-entry';

export type CodexThreadWithTurns = CodexThreadSummary & {
  turns?: unknown[];
};

const CODEX_RUNTIME: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };

export function codexThreadToRuntimeSessionEntry(
  thread: CodexThreadSummary,
  runtime: AgentRuntimeIdentity = CODEX_RUNTIME,
): RuntimeSessionEntry {
  return {
    id: thread.id,
    runtime,
    ...(thread.name !== undefined ? { title: thread.name } : {}),
    ...(thread.preview ? { preview: thread.preview } : {}),
    ...(thread.cwd ? { cwd: thread.cwd } : {}),
    ...(thread.createdAt !== undefined ? { createdAt: thread.createdAt } : {}),
    ...(thread.updatedAt !== undefined ? { updatedAt: thread.updatedAt } : {}),
    ...('status' in thread && (typeof thread.status === 'string' || thread.status === null) ? { status: thread.status } : {}),
    ...(typeof thread.archived === 'boolean' ? { archived: thread.archived } : {}),
    ...(typeof thread.messageCount === 'number' ? { messageCount: thread.messageCount } : {}),
    ...(typeof thread.turnCount === 'number' ? { turnCount: thread.turnCount } : {}),
    ...(Array.isArray(thread.turns) ? { turns: thread.turns } : {}),
    raw: thread,
  };
}

export function runtimeSessionEntryToCodexThread(entry: RuntimeSessionEntry): CodexThreadWithTurns {
  return {
    id: entry.id,
    ...(entry.title !== undefined ? { name: entry.title } : {}),
    ...(entry.preview ? { preview: entry.preview } : {}),
    ...(entry.cwd ? { cwd: entry.cwd } : {}),
    ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}),
    ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(typeof entry.archived === 'boolean' ? { archived: entry.archived } : {}),
    ...(typeof entry.messageCount === 'number' ? { messageCount: entry.messageCount } : {}),
    ...(typeof entry.turnCount === 'number' ? { turnCount: entry.turnCount } : {}),
    ...(Array.isArray(entry.turns) ? { turns: entry.turns } : {}),
  };
}

export function normalizeCodexThread(value: unknown): CodexThreadSummary | null {
  const entry = normalizeRuntimeSessionEntry(value, CODEX_RUNTIME);
  return entry ? runtimeSessionEntryToCodexThread(entry) : null;
}

export function normalizeCodexThreadWithTurns(value: unknown): CodexThreadWithTurns | null {
  const entry = normalizeRuntimeSessionEntry(value, CODEX_RUNTIME);
  return entry ? runtimeSessionEntryToCodexThread(entry) : null;
}

export function codexThreadTurnsToMessages(
  thread: CodexThreadWithTurns,
  runtime: AgentRuntimeIdentity,
): Message[] {
  return runtimeSessionEntryTurnsToMessages(codexThreadToRuntimeSessionEntry(thread, runtime), runtime);
}

export function codexThreadMessageCount(thread: CodexThreadWithTurns): number | null {
  return runtimeSessionEntryMessageCount(codexThreadToRuntimeSessionEntry(thread));
}

export async function readCodexThreadHistory(
  thread: CodexThreadSummary,
  runtime: AgentRuntimeIdentity,
): Promise<{ thread: CodexThreadWithTurns; messages: Message[] }> {
  const res = await fetch(`/api/agent-runtimes/codex/threads/${encodeURIComponent(thread.id)}?includeTurns=1`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    let message = `Failed to load Codex thread history (${res.status}).`;
    try {
      const body = await res.json() as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      // keep status-derived message
    }
    throw new Error(message);
  }

  const body = await res.json() as { thread?: unknown };
  const readThread = normalizeCodexThreadWithTurns(body.thread) ?? {
    ...thread,
    turns: [],
  };
  return {
    thread: readThread,
    messages: codexThreadTurnsToMessages(readThread, runtime),
  };
}
