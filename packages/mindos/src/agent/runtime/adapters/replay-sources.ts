import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { replayProjectIdentity, sampleReplayMessages } from './replay-projects.js';
import { loadSqliteDriver } from '../../../foundation/storage/sqlite-driver.js';
import { listRuntimeSessionTranscripts } from './session-transcripts/registry.js';
import { browseNativeSessions } from './session-transcripts/native-browser.js';
import type { ReplayMessage, ReplaySource, ReplaySourceSummary } from '../../../knowledge/branch-replay/index.js';
import { isReplayInternalText } from '../../../knowledge/branch-replay/index.js';

function cleanVisibleText(text: string): string {
  if (isReplayInternalText(text)) return '';
  const request = text.includes('## My request:') ? text.slice(text.indexOf('## My request:') + 14) : text;
  return request.replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, '').replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted]').trim().slice(0, 18000);
}

function visibleReplayRecords(records: unknown[]): ReplayMessage[] {
  const messages: ReplayMessage[] = [];
  records.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const record = raw as Record<string, unknown>;
    const p = record.payload as Record<string, unknown> | undefined;
    if (record.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(String(p.role)) || (p.channel && !['commentary','final'].includes(String(p.channel)))) return;
    const content = Array.isArray(p.content) ? p.content : [];
    const text = cleanVisibleText(content.map(b => b && typeof b === 'object' && ['input_text', 'output_text', 'text'].includes(b.type) && typeof b.text === 'string' ? b.text : '').filter(Boolean).join('\n'));
    if (text) messages.push({ id: `m${index}`, role: p.role as ReplayMessage['role'], text, ...(typeof record.timestamp === 'string' ? { timestamp: record.timestamp } : {}) });
  });
  return messages;
}

function codexRoot(home: string): string { return home === os.homedir() && process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(home, '.codex'); }
export function parseReplayRecords(records: unknown[]): ReplayMessage[] { return sampleReplayMessages(visibleReplayRecords(records)).messages; }
function codexDatabase(home: string): string | null {
  const dir = codexRoot(home);
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter(n => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));
  return names[0] ? path.join(dir, names[0]) : null;
}
function codexRows(home: string, input: { id?: string; query?: string; limit: number; offset?: number; includeArchived?: boolean }) {
  const file = codexDatabase(home);
  if (!file) return [];
  const db = loadSqliteDriver().open(file, { readOnly: true });
  try {
    const clauses: string[] = []; const values: (string | number)[] = [];
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(column => column.name));
    if (input.id) { clauses.push('id = ?'); values.push(input.id); }
    else if (!input.includeArchived) clauses.push('archived = 0');
    if (!input.id && columns.has('source')) clauses.push(`(source IS NULL OR instr(source, '"subagent"') = 0)`);
    if (input.query) { clauses.push('(instr(lower(title),lower(?)) > 0 OR instr(lower(cwd),lower(?)) > 0)'); values.push(input.query, input.query); }
    return db.prepare(`SELECT id,title,cwd,updated_at,${columns.has('created_at') ? 'created_at' : 'NULL AS created_at'},rollout_path,archived FROM threads${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, input.limit, input.offset ?? 0);
  } finally { db.close(); }
}

export interface ReplaySourcePage { sources: ReplaySourceSummary[]; nextCursor: string | null; }
export interface ReplaySourceOptions { homeDir?: string; runtime?: string; query?: string; limit?: number; cursor?: string; includeArchived?: boolean; }
export async function listReplaySourcePage(options: ReplaySourceOptions = {}): Promise<ReplaySourcePage> {
  const home = options.homeDir ?? os.homedir(), limit = options.limit ?? 50, offset = options.cursor ? Number(options.cursor) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Source limit must be between 1 and 100');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || (options.cursor && !/^\d+$/.test(options.cursor))) throw new Error('Invalid source cursor');
  const runtime = options.runtime ?? 'codex', query = options.query?.trim().slice(0, 160);
  let sources: ReplaySourceSummary[], nextCursor: string | null;
  if (runtime === 'codex') {
    const rows = codexRows(home, { query, limit: limit + 1, offset, includeArchived: options.includeArchived });
    nextCursor = rows.length > limit ? String(offset + limit) : null;
    sources = rows.slice(0, limit).map(row => ({ id: String(row.id), runtime: 'codex', title: cleanVisibleText(String(row.title || row.id)).slice(0,160) || String(row.id), cwd: String(row.cwd || ''), createdAt: row.created_at ? Number(row.created_at) * 1000 : undefined, updatedAt: Number(row.updated_at) * 1000, archived: !!row.archived }));
  } else if (runtime === 'claude') {
    const page = await browseNativeSessions({ runtimeId: 'claude', limit, cursor: options.cursor, query });
    sources = page.sessions.map(row => ({ id: row.id, runtime: 'claude', title: cleanVisibleText(String(row.title || row.preview || row.id)).slice(0,160) || row.id, cwd: row.cwd, createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.parse(row.createdAt || ''), updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.parse(row.updatedAt || '') }));
    nextCursor = page.nextCursor;
  } else throw new Error('Unsupported replay source');
  const identities = new Map<string, ReturnType<typeof replayProjectIdentity>>();
  return { sources: sources.map(source => {
    const cwd = source.cwd || ''; let project = identities.get(cwd);
    if (!project) { project = replayProjectIdentity(cwd); identities.set(cwd, project); }
    return { ...source, project: project.title, projectId: project.id, projectPath: project.path };
  }), nextCursor };
}
export async function listReplaySources(options: ReplaySourceOptions = {}): Promise<ReplaySourceSummary[]> {
  if (options.runtime === 'claude' && options.homeDir) {
    const rows = await listRuntimeSessionTranscripts({ runtimeId: 'claude', homeDir: options.homeDir, metadataOnly: true, limit: 100 });
    return rows.filter(r => !options.query || `${r.title} ${r.cwd}`.toLowerCase().includes(options.query.toLowerCase())).slice(0, options.limit ?? 20).map(r => ({ id: r.id, runtime: 'claude', title: cleanVisibleText(String(r.title || r.id)), cwd: r.cwd, project: path.basename(r.cwd || 'Claude') }));
  }
  return (await listReplaySourcePage(options)).sources;
}

export async function readReplaySource(runtime: string, id: string, homeDir?: string): Promise<ReplaySource> {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid source session identity');
  const home = homeDir ?? os.homedir();
  if (runtime === 'claude') {
    const rows = homeDir ? await listRuntimeSessionTranscripts({ runtimeId: 'claude', sessionId: id, homeDir: home, limit: 1 }) : (await browseNativeSessions({ runtimeId: 'claude', sessionId: id, limit: 1 })).sessions;
    const row = rows.find(r => r.id === id);
    if (!row) throw new Error('Claude session is missing or unreadable');
    const messages = (row.turns || []).map((m, i) => ({ id: `m${i}`, role: m.role, text: cleanVisibleText(m.content) })).filter(m => m.text);
    return { id, runtime: 'claude', title: cleanVisibleText(String(row.title || id)).slice(0, 160)||id, project: replayProjectIdentity(row.cwd).title, cwd: row.cwd, createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.parse(row.createdAt || ''), updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Date.parse(row.updatedAt || ''), ...sampleReplayMessages(messages) };
  }
  if (runtime !== 'codex') throw new Error('Unsupported replay source');
  const row = codexRows(home, { id, limit: 1 })[0];
  if (!row) throw new Error('Codex session is missing or unreadable');
  const roots = ['sessions', 'archived_sessions'].map(name => path.join(codexRoot(home), name));
  const root = roots.find(candidate => { const relative = path.relative(candidate, path.resolve(String(row.rollout_path))); return !relative.startsWith('..') && !path.isAbsolute(relative); });
  if (!root) throw new Error('Transcript path is outside session storage');
  const file = path.resolve(String(row.rollout_path));
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Transcript path is outside session storage');
  const actual = fs.realpathSync(file);
  const actualRelative = path.relative(fs.realpathSync(root), actual);
  if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('Transcript symlink is outside session storage');
  if (fs.statSync(actual).size > 128 * 1024 * 1024) throw new Error('Session is too large for a bounded replay; select another session');
  const records: unknown[] = [];
  const stream = fs.createReadStream(actual, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 2_000_000) { records.push(null); continue; }
      try {
        const record = JSON.parse(line);
        // Tool payloads can be enormous. Keep their position, never their body.
        records.push(record.type === 'response_item' && record.payload?.type === 'message' ? record : null);
      } catch { records.push(null); }
      if (records.length > 300_000) throw new Error('Session exceeds the replay record budget');
    }
  } finally { lines.close(); stream.destroy(); }
  return { id, runtime: 'codex', title: cleanVisibleText(String(row.title || id)).slice(0, 160)||id, project: replayProjectIdentity(String(row.cwd || '')).title, cwd: String(row.cwd || ''), createdAt: row.created_at ? Number(row.created_at) * 1000 : undefined, updatedAt: Number(row.updated_at) * 1000, ...sampleReplayMessages(visibleReplayRecords(records)) };
}
