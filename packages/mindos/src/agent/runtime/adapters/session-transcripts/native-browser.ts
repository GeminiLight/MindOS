import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadSqliteDriver } from '../../../../foundation/storage/sqlite-driver.js';
import { parseClaudeMessagesFromRecords, parseOpenCodeTextRows, type OpenCodeTextRow } from './normalizer.js';
import type { ExternalRuntimeSessionRecord } from './types.js';

export class NativeSessionBrowserError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 500) { super(message); }
}

export interface NativeSessionBrowserOptions {
  runtimeId: string;
  cwd?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  sessionId?: string;
  homeDir?: string;
}
export interface NativeSessionPage {
  sessions: ExternalRuntimeSessionRecord[];
  nextCursor: string | null;
}
interface ClaudeSessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  cwd?: string;
  createdAt?: number;
  firstPrompt?: string;
}
interface ClaudeSessionReader {
  listSessions(options: { dir?: string; offset?: number; limit?: number }): Promise<ClaudeSessionInfo[]>;
  getSessionInfo(id: string, options?: { dir?: string }): Promise<ClaudeSessionInfo | undefined>;
  getSessionMessages(id: string, options?: { dir?: string }): Promise<unknown[]>;
}

export async function browseNativeSessions(
  options: NativeSessionBrowserOptions,
  claudeReader?: ClaudeSessionReader,
): Promise<NativeSessionPage> {
  const offset = options.cursor ? Number(options.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || (options.cursor && !/^\d+$/.test(options.cursor))) {
    throw new NativeSessionBrowserError('Invalid session page cursor. Refresh the session list.', 400);
  }
  const limit = options.limit ?? 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new NativeSessionBrowserError('Session page limit must be between 1 and 100.', 400);
  if (options.runtimeId === 'claude' || options.runtimeId === 'claude-code') {
    const sdk = claudeReader ?? await import('@anthropic-ai/claude-agent-sdk');
    if (options.sessionId) {
      const info = await sdk.getSessionInfo(options.sessionId, options.cwd ? { dir: options.cwd } : undefined);
      if (!info) throw new NativeSessionBrowserError('Claude session no longer exists or cannot be read. Refresh the list.', 404);
      const messages = await sdk.getSessionMessages(info.sessionId, info.cwd ? { dir: info.cwd } : undefined);
      const turns = parseClaudeMessagesFromRecords(messages as Record<string, unknown>[]);
      return { sessions: [{ ...claudeEntry(info), turns, messageCount: turns.length }], nextCursor: null };
    }
    const dir = options.cwd ? { dir: options.cwd } : {};
    const query = options.query?.trim().toLowerCase();
    // The SDK already indexes lightweight metadata. Search must precede the
    // page window, otherwise an older matching session would remain invisible.
    const candidates = query
      ? (await sdk.listSessions(dir)).filter(s => [s.summary, s.firstPrompt, s.cwd, s.sessionId].some(v => v?.toLowerCase().includes(query))).slice(offset, offset + limit + 1)
      : await sdk.listSessions({ ...dir, offset, limit: limit + 1 });
    return {
      sessions: candidates.slice(0, limit).map(claudeEntry),
      nextCursor: candidates.length > limit ? String(offset + limit) : null,
    };
  }
  if (options.runtimeId !== 'opencode') throw new NativeSessionBrowserError('This runtime does not expose a native session browser.', 400);
  return browseOpenCode(options, offset, limit);
}

function claudeEntry(info: ClaudeSessionInfo): ExternalRuntimeSessionRecord {
  return {
    id: info.sessionId, title: info.summary, preview: info.firstPrompt,
    cwd: info.cwd, updatedAt: info.lastModified, createdAt: info.createdAt,
    source: 'native-transcript', transcriptSource: 'claude-code',
  };
}

function browseOpenCode(options: NativeSessionBrowserOptions, offset: number, limit: number): NativeSessionPage {
  const dataRoot = options.homeDir ? join(options.homeDir, '.local', 'share') : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  const file = join(dataRoot, 'opencode', 'opencode.db');
  if (!existsSync(file)) {
    if (options.sessionId) throw new NativeSessionBrowserError('OpenCode session storage is unavailable. Refresh the list.', 404);
    return { sessions: [], nextCursor: null };
  }
  const db = loadSqliteDriver().open(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 3000');
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.sessionId) { where.push('id = ?'); params.push(options.sessionId); }
    if (options.cwd) { where.push('directory = ?'); params.push(options.cwd); }
    if (options.query?.trim()) {
      where.push("(instr(lower(title), lower(?)) > 0 OR instr(lower(directory), lower(?)) > 0 OR instr(lower(id), lower(?)) > 0)");
      params.push(options.query.trim(), options.query.trim(), options.query.trim());
    }
    const rows = db.prepare(`SELECT id, directory, title, time_created, time_updated FROM session${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY time_updated DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
    if (options.sessionId && rows.length === 0) throw new NativeSessionBrowserError('Session no longer exists.', 404);
    const sessions = rows.slice(0, limit).map(row => {
      const entry: ExternalRuntimeSessionRecord = {
        id: String(row.id), title: String(row.title ?? row.id), cwd: String(row.directory),
        createdAt: Number(row.time_created), updatedAt: Number(row.time_updated),
        source: 'native-transcript', transcriptSource: 'opencode',
      };
      if (options.sessionId) {
        const parts = db.prepare('SELECT m.id AS message_id, m.time_created AS message_time_created, m.data AS message_data, p.time_created AS part_time_created, p.data AS part_data FROM message m JOIN part p ON p.message_id = m.id WHERE m.session_id = ? ORDER BY m.time_created, m.id, p.time_created, p.id').all(options.sessionId);
        entry.turns = parseOpenCodeTextRows(parts as unknown as OpenCodeTextRow[]);
        entry.messageCount = entry.turns.length;
      }
      return entry;
    });
    return { sessions, nextCursor: rows.length > limit ? String(offset + limit) : null };
  } catch (error) {
    if (error instanceof NativeSessionBrowserError) throw error;
    throw new Error(`Cannot read OpenCode sessions: ${error instanceof Error ? error.message : 'storage is unavailable'}`);
  } finally { db.close(); }
}
