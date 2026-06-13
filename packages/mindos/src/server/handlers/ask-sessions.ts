import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

const MAX_SESSIONS = 30;
// One session's serialized JSON may not exceed this; oldest messages are
// dropped first. Keeps a runaway conversation from growing a file unboundedly.
const MAX_SESSION_BYTES = 4_000_000;
// Filesystems commonly cap filenames at 255 bytes; hash anything longer.
const MAX_ENCODED_ID_CHARS = 200;

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
  migrateLegacyStoreIfNeeded(storePath);
  // Per-session files: saving one session writes one small file instead of
  // rewriting every session on each (debounced ~600ms) client flush.
  writeSessionFile(storePath, capSessionSize(session));
  pruneToMaxSessions(storePath);
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
  migrateLegacyStoreIfNeeded(storePath);
  for (const id of ids) {
    try {
      unlinkSync(sessionFilePath(storePath, id));
    } catch {
      // Deleting a session that does not exist is a no-op, matching the
      // previous filter-based behavior.
    }
  }
  return json({ ok: true });
}

function resolveStorePath(services: AskSessionsHandlerServices): string {
  return services.storePath ?? join(homedir(), '.mindos', 'sessions.json');
}

/** `~/.mindos/sessions.json` (legacy single file) -> `~/.mindos/sessions/` */
function sessionsDirFor(storePath: string): string {
  const ext = extname(storePath);
  const stem = ext ? basename(storePath, ext) : `${basename(storePath)}.d`;
  return join(dirname(storePath), stem);
}

function encodeSessionId(id: string): string {
  if (id.length === 0) return '_';
  const encoded = Buffer.from(id, 'utf-8').toString('base64url');
  if (encoded.length <= MAX_ENCODED_ID_CHARS) return encoded;
  return `h-${createHash('sha256').update(id, 'utf-8').digest('hex')}`;
}

function sessionFilePath(storePath: string, id: string): string {
  return join(sessionsDirFor(storePath), `${encodeSessionId(id)}.json`);
}

function readSessions(storePath: string): MindosChatSession[] {
  try {
    migrateLegacyStoreIfNeeded(storePath);
    const dir = sessionsDirFor(storePath);
    if (!existsSync(dir)) return [];
    const sessions: MindosChatSession[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as unknown;
        if (isValidSession(parsed)) sessions.push(parsed);
      } catch {
        // Skip an unreadable/corrupted session file; the rest stay available.
      }
    }
    return sessions
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
function writeSessionFile(storePath: string, session: MindosChatSession): void {
  const file = sessionFilePath(storePath, session.id);
  mkdirSync(dirname(file), { recursive: true });
  // Atomic replace: a crash mid-write must never leave a truncated session file.
  const tmpPath = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, JSON.stringify(session, null, 2), 'utf-8');
    renameSync(tmpPath, file);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    throw error;
  }
}

/** Drops oldest messages (by halves) until the serialized session fits the cap. */
function capSessionSize(session: MindosChatSession): MindosChatSession {
  if (Buffer.byteLength(JSON.stringify(session), 'utf-8') <= MAX_SESSION_BYTES) return session;
  let messages = session.messages;
  while (messages.length > 1) {
    messages = messages.slice(Math.ceil(messages.length / 2));
    if (Buffer.byteLength(JSON.stringify({ ...session, messages }), 'utf-8') <= MAX_SESSION_BYTES) break;
  }
  return { ...session, messages };
}

/** Keeps only the MAX_SESSIONS most recently updated session files. */
function pruneToMaxSessions(storePath: string): void {
  const dir = sessionsDirFor(storePath);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  if (names.length <= MAX_SESSIONS) return;

  const entries = names.map((name) => {
    let updatedAt = 0;
    let valid = false;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as unknown;
      if (isValidSession(parsed)) {
        valid = true;
        updatedAt = getUpdatedAt(parsed);
      }
    } catch {
      // Corrupted files sort oldest so they are pruned first.
    }
    return { name, updatedAt, valid };
  });
  entries.sort((a, b) => (Number(b.valid) - Number(a.valid)) || (b.updatedAt - a.updatedAt));
  for (const entry of entries.slice(MAX_SESSIONS)) {
    try {
      unlinkSync(join(dir, entry.name));
    } catch {
      // Best-effort prune; a leftover file is re-pruned on the next save.
    }
  }
}

/**
 * One-time migration of the legacy single `sessions.json` (full array rewritten
 * on every save) into per-session files. The legacy file is removed afterwards
 * — even when corrupted — so it can never shadow the new layout.
 */
function migrateLegacyStoreIfNeeded(storePath: string): void {
  if (!existsSync(storePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf-8')) as unknown;
    if (Array.isArray(parsed)) {
      for (const session of parsed.filter(isValidSession).slice(0, MAX_SESSIONS)) {
        if (!existsSync(sessionFilePath(storePath, session.id))) {
          writeSessionFile(storePath, capSessionSize(session));
        }
      }
    }
  } catch {
    // Corrupted legacy store: previous behavior treated it as empty.
  }
  rmSync(storePath, { force: true });
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
