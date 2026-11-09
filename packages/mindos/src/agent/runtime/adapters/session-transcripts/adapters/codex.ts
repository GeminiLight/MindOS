import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';
import type {
  ExternalRuntimeSessionListOptions,
  ExternalRuntimeSessionRecord,
  ImportedRuntimeSessionMessage,
  MaybeRecord,
  RuntimeSessionTranscriptAdapter,
} from '../types.js';
import {
  isRecord,
  sortAndLimit,
  timestampMs,
  toExternalRecord,
  truncateContent,
} from '../normalizer.js';

const ROLLOUT_FILE = /^rollout-.*\.jsonl(\.zst)?$/;
const decompressZstd = promisify(zstdDecompress);

/**
 * Codex writes one rollout file per session as JSONL, under a dated directory
 * tree. Unlike the other harnesses it also replays a large amount of its own
 * scaffolding through the `user` role — environment snapshots, heartbeats,
 * ambient UI state, the project's AGENTS.md — which accounted for roughly half
 * of user-role messages in the transcripts this adapter was built against.
 * Those are not the person talking, so anything that consumes the result
 * (titles, previews, agreement detection) would be reading the harness's own
 * voice if they were kept.
 *
 * The tag rule is deliberately broad: Codex keeps adding context blocks
 * (`<environment_context>`, `<heartbeat>`, `<in-app-browser-context>`), and a
 * person does not open a turn with an XML tag. Matching the shape rather than
 * each known name means a new block is filtered the day it ships instead of
 * surfacing as a candidate agreement — one such block literally reads "Do not
 * treat it as an instruction", which an allow-list would have let through.
 */
const CODEX_INJECTED_USER_TEXT: readonly RegExp[] = [
  /^<[a-z][a-z0-9_-]*(\s|>)/i,
  /^#\s*AGENTS/,
  /^#\s*Files mentioned by the user/i,
];

/**
 * When Codex asks a clarifying question, the person's answer comes back wrapped
 * in a tag with the question beside it. The answer is genuine user speech, so it
 * is unwrapped rather than discarded.
 */
const QUESTION_REPLY = /^<send_user_message_question_reply>([\s\S]*)<\/send_user_message_question_reply>$/;

export async function listCodexSessions(
  options: ExternalRuntimeSessionListOptions,
): Promise<ExternalRuntimeSessionRecord[]> {
  const bySessionId = new Map<string, { record: ExternalRuntimeSessionRecord; messageCount: number; updatedAt: number }>();

  for (const home of codexHomes(options.homeDir ?? homedir())) {
    for (const file of await rolloutFiles(home)) {
      if (options.sessionId && !fileCouldHoldSession(file, options.sessionId)) continue;

      const rows = await readRollout(file);
      if (rows.length === 0) continue;

      const meta = sessionMeta(rows);
      const sessionId = stringField(meta, 'session_id') ?? stringField(meta, 'id') ?? sessionIdFromFileName(file);
      if (options.sessionId && sessionId !== options.sessionId) continue;

      const cwd = stringField(meta, 'cwd');
      if (!options.sessionId && options.cwd?.trim() && cwd && resolve(cwd) !== resolve(options.cwd.trim())) continue;

      const messages = parseCodexRolloutMessages(rows);
      const fileStat = await stat(file).catch(() => null);
      const firstUser = messages.find((message) => message.role === 'user');
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      const updatedAt = newestRowTimestamp(rows) ?? fileStat?.mtimeMs ?? 0;

      const candidate = {
        record: toExternalRecord({
          id: sessionId,
          title: firstUser?.content ? firstUser.content.slice(0, 80) : sessionId,
          preview: lastUser && lastUser !== firstUser ? lastUser.content.slice(0, 120) : undefined,
          ...(cwd ? { cwd } : {}),
          createdAt: timestampMs(stringField(meta, 'timestamp')) ?? fileStat?.birthtimeMs,
          updatedAt,
          messages,
          transcriptSource: 'codex',
          ...(options.metadataOnly ? { metadataOnly: true } : {}),
        }),
        messageCount: messages.length,
        updatedAt,
      };

      const existing = bySessionId.get(sessionId);
      if (!existing || fullerCopy(candidate, existing)) bySessionId.set(sessionId, candidate);
    }
  }

  return sortAndLimit([...bySessionId.values()].map((entry) => entry.record), options.limit, options);
}

type CodexCopy = { messageCount: number; updatedAt: number };

/**
 * Resuming or forking a Codex session writes a fresh rollout that keeps the
 * original `session_id`, and archiving leaves another copy behind. On the
 * machine this was built against that turned 32 real conversations into 100
 * records — which would repeat rows in the session list and, worse, fake the
 * cross-session evidence agreement detection depends on.
 *
 * The fullest copy wins: a resumed rollout replays the earlier turns, so the
 * longest transcript is the complete one. Equal length falls back to the most
 * recently written.
 */
function fullerCopy(candidate: CodexCopy, existing: CodexCopy): boolean {
  if (candidate.messageCount !== existing.messageCount) return candidate.messageCount > existing.messageCount;
  return candidate.updatedAt > existing.updatedAt;
}

/**
 * Turn rollout rows into the visible conversation.
 *
 * Only `response_item` messages carry speech. The `developer` role is Codex
 * addressing itself with system instructions and never reaches the transcript.
 */
export function parseCodexRolloutMessages(rows: MaybeRecord[]): ImportedRuntimeSessionMessage[] {
  const messages: ImportedRuntimeSessionMessage[] = [];

  for (const row of rows) {
    if (!isRecord(row) || row.type !== 'response_item') continue;
    const payload = isRecord(row.payload) ? row.payload : null;
    if (!payload || payload.type !== 'message') continue;

    const role = payload.role;
    if (role !== 'user' && role !== 'assistant') continue;

    const raw = textFromCodexContent(payload.content);
    if (!raw) continue;

    const content = role === 'user' ? humanTextFromUserTurn(raw) : raw;
    if (!content) continue;

    const timestamp = timestampMs(row.timestamp);
    messages.push({
      role,
      content: truncateContent(content),
      ...(timestamp !== undefined ? { timestamp } : {}),
    });
  }

  return messages;
}

/** Codex content parts expose their text directly; images carry no transcript text. */
function textFromCodexContent(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** Empty string means the turn was the harness talking, not the person. */
function humanTextFromUserTurn(raw: string): string {
  const unwrapped = unwrapQuestionReply(raw);
  if (unwrapped !== null) return unwrapped;
  if (CODEX_INJECTED_USER_TEXT.some((pattern) => pattern.test(raw))) return '';
  return raw;
}

function unwrapQuestionReply(raw: string): string | null {
  const body = raw.match(QUESTION_REPLY)?.[1];
  if (body === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (!Array.isArray(parsed)) return '';
    return parsed
      .map((entry) => (isRecord(entry) && typeof entry.answer === 'string' ? entry.answer.trim() : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

/**
 * A machine can hold several Codex homes: the default one and any `.codex-<name>`
 * sibling, plus `$CODEX_HOME` for this process. Reading only `~/.codex` silently
 * drops whole profiles.
 */
export function codexHomes(home: string): string[] {
  const homes: string[] = [];
  const add = (candidate: string | undefined) => {
    if (!candidate) return;
    const resolved = resolve(candidate);
    if (!homes.includes(resolved) && existsSync(resolved)) homes.push(resolved);
  };

  add(join(home, '.codex'));
  // Honour $CODEX_HOME only for this process's own HOME: another HOME is an
  // archived or captured store and must be read by its own layout alone.
  if (home === homedir()) add(process.env.CODEX_HOME);

  for (const name of safeReaddirSyncNames(home)) {
    if (name.startsWith('.codex-')) add(join(home, name));
  }
  return homes;
}

function safeReaddirSyncNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function rolloutFiles(codexHome: string): Promise<string[]> {
  const found: string[] = [];
  for (const root of [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')]) {
    if (!existsSync(root)) continue;
    await collectRollouts(root, found);
  }
  return found;
}

async function collectRollouts(dir: string, found: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRollouts(path, found);
      continue;
    }
    if (entry.isFile() && ROLLOUT_FILE.test(entry.name)) found.push(path);
  }
}

/**
 * Rollout names end in the session id, so a lookup can skip files by name alone
 * instead of parsing every rollout on the machine.
 */
function fileCouldHoldSession(file: string, sessionId: string): boolean {
  return sessionIdFromFileName(file).endsWith(sessionId) || file.includes(sessionId);
}

function sessionIdFromFileName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? '';
  return base.replace(/^rollout-/, '').replace(/\.jsonl(\.zst)?$/, '');
}

/**
 * Read a rollout into rows.
 *
 * Streamed line by line rather than read whole: on the machine this was built
 * against, 8 of 32 live rollouts were over 32MB and the longest — the richest
 * conversation on disk — was 39MB. A size ceiling meant to protect memory had
 * silently excluded exactly the sessions worth reading, with no error to notice.
 * Streaming keeps peak memory at one line plus the retained rows, so a ceiling
 * is not needed to stay safe.
 *
 * Compressed archives are still buffered: zstd has no incremental path here, and
 * archives are both rare and much smaller than the live rollouts.
 */
async function readRollout(file: string): Promise<MaybeRecord[]> {
  try {
    if (file.endsWith('.zst')) {
      const buffer = await readFile(file);
      return parseJsonLines((await decompressZstd(buffer)).toString('utf-8'));
    }

    const rows: MaybeRecord[] = [];
    const stream = createReadStream(file, { encoding: 'utf-8' });
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) rows.push(parsed);
      } catch {
        // A rollout being appended to can end mid-line; keep what parsed.
        continue;
      }
    }
    return rows;
  } catch {
    // A missing, unreadable or unsupported-codec rollout must not take down the
    // listing for every other session.
    return [];
  }
}

function parseJsonLines(text: string): MaybeRecord[] {
  const rows: MaybeRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
    } catch {
      continue;
    }
  }
  return rows;
}

function sessionMeta(rows: MaybeRecord[]): MaybeRecord | null {
  const row = rows.find((candidate) => candidate.type === 'session_meta');
  return row && isRecord(row.payload) ? row.payload : null;
}

function stringField(record: MaybeRecord | null, key: string): string | undefined {
  if (!record) return undefined;
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function newestRowTimestamp(rows: MaybeRecord[]): number | undefined {
  let newest: number | undefined;
  for (const row of rows) {
    const value = timestampMs(row.timestamp);
    if (value !== undefined && (newest === undefined || value > newest)) newest = value;
  }
  return newest;
}

export const CODEX_SESSION_TRANSCRIPT_ADAPTER: RuntimeSessionTranscriptAdapter = {
  id: 'codex',
  aliases: ['codex', 'codex-cli', 'codex-acp', 'openai-codex'],
  transcriptSource: 'codex',
  status: 'supported',
  durable: true,
  summary: 'Reads Codex rollout transcripts under every ~/.codex home, including archived sessions.',
  listSessions: listCodexSessions,
};
