import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

const MAX_SESSIONS = 30;

export type MindosChatSession = {
  id: string;
  messages: unknown[];
  updatedAt?: number;
  [key: string]: unknown;
};

export type AskSessionsHandlerServices = {
  storePath?: string;
};

export type AskSessionsSavePayload = {
  session?: unknown;
};

export type AskSessionsDeletePayload = {
  id?: unknown;
  ids?: unknown;
};

export function handleAskSessionsGet(
  services: AskSessionsHandlerServices = {},
): MindosServerResponse<MindosChatSession[]> {
  return json(readSessions(resolveStorePath(services)));
}

export function handleAskSessionsPost(
  body: unknown,
  services: AskSessionsHandlerServices = {},
): MindosServerResponse<{ ok: true } | { error: string }> {
  const session = (body as AskSessionsSavePayload | undefined)?.session;
  if (!isValidSession(session)) {
    return json({ error: 'Invalid session payload' }, { status: 400 });
  }

  const storePath = resolveStorePath(services);
  const sessions = readSessions(storePath);
  const idx = sessions.findIndex((item) => item.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
  }

  sessions.sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));
  writeSessions(storePath, sessions);
  return json({ ok: true });
}

export function handleAskSessionsDelete(
  body: unknown,
  services: AskSessionsHandlerServices = {},
): MindosServerResponse<{ ok: true } | { error: string }> {
  const payload = body as AskSessionsDeletePayload | undefined;
  const ids = Array.isArray(payload?.ids)
    ? payload.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : typeof payload?.id === 'string' && payload.id.length > 0
      ? [payload.id]
      : [];

  if (ids.length === 0) {
    return json({ error: 'id or ids is required' }, { status: 400 });
  }

  const storePath = resolveStorePath(services);
  const deleteSet = new Set(ids);
  writeSessions(storePath, readSessions(storePath).filter((session) => !deleteSet.has(session.id)));
  return json({ ok: true });
}

function resolveStorePath(services: AskSessionsHandlerServices): string {
  return services.storePath ?? join(homedir(), '.mindos', 'sessions.json');
}

function readSessions(storePath: string): MindosChatSession[] {
  try {
    if (!existsSync(storePath)) return [];
    const parsed = JSON.parse(readFileSync(storePath, 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidSession)
      .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a))
      .slice(0, MAX_SESSIONS);
  } catch {
    return [];
  }
}

// CONSTRAINT: read-modify-write here is only safe because every handler in this
// file is synchronous (single JS turn = no interleaving). If any of this moves
// to async fs APIs, a write queue must be added or concurrent upserts will
// clobber each other. Cross-process locking (web + mcp servers sharing the
// store) is intentionally out of scope — see spec-chat-session-concurrency.md.
function writeSessions(storePath: string, sessions: MindosChatSession[]) {
  mkdirSync(dirname(storePath), { recursive: true });
  // Atomic replace: a crash mid-write must never leave a truncated sessions.json.
  const tmpPath = `${storePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(sessions.slice(0, MAX_SESSIONS), null, 2), 'utf-8');
  renameSync(tmpPath, storePath);
}

function isValidSession(value: unknown): value is MindosChatSession {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as { id?: unknown }).id === 'string'
      && Array.isArray((value as { messages?: unknown }).messages),
  );
}

function getUpdatedAt(session: MindosChatSession): number {
  return typeof session.updatedAt === 'number' ? session.updatedAt : 0;
}
