import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { loadSqliteDriver } from '../../../foundation/storage/sqlite-driver.js';
import { listRuntimeSessionTranscripts } from './session-transcripts/registry.js';
import { browseNativeSessions } from './session-transcripts/native-browser.js';
import type { ReplayMessage, ReplaySource, ReplaySourceSummary } from '../../../knowledge/branch-replay/index.js';

function cleanVisibleText(text: string): string {
  if (/^(# AGENTS\.md|<environment_context>|<external_codex_apps|<user_instructions>)/.test(text.trim())) return '';
  const request = text.includes('## My request:') ? text.slice(text.indexOf('## My request:') + 14) : text;
  return request.replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, '').replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted]').trim().slice(0, 18000);
}

export function parseReplayRecords(records: unknown[]): ReplayMessage[] {
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
  return messages.length > 160 ? [...messages.slice(0, 40), ...messages.slice(-120)] : messages;
}

function codexDatabase(home: string): string | null {
  const dir = path.join(home, '.codex');
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter(n => /^state_\d+\.sqlite$/.test(n)).sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));
  return names[0] ? path.join(dir, names[0]) : null;
}
function codexRows(home: string, input: { id?: string; query?: string; limit: number }) {
  const file = codexDatabase(home);
  if (!file) return [];
  const db = loadSqliteDriver().open(file, { readOnly: true });
  try {
    const clauses: string[] = []; const values: (string | number)[] = [];
    if (input.id) { clauses.push('id = ?'); values.push(input.id); }
    else clauses.push('archived = 0');
    if (input.query) { clauses.push('(instr(lower(title),lower(?)) > 0 OR instr(lower(cwd),lower(?)) > 0)'); values.push(input.query, input.query); }
    return db.prepare(`SELECT id,title,cwd,updated_at,rollout_path FROM threads WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`).all(...values, input.limit);
  } finally { db.close(); }
}

export async function listReplaySources(options: { homeDir?: string; runtime?: string; query?: string; limit?: number } = {}): Promise<ReplaySourceSummary[]> {
  const home = options.homeDir ?? os.homedir();
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Source limit must be between 1 and 100');
  const runtime = options.runtime ?? 'codex';
  if (runtime === 'codex') return codexRows(home, { query: options.query?.trim().slice(0, 160), limit }).map(row => ({
    id: String(row.id), runtime: 'codex', title: cleanVisibleText(String(row.title || row.id)).slice(0, 160)||String(row.id), cwd: String(row.cwd || ''),
    project: path.basename(String(row.cwd || '')), updatedAt: Number(row.updated_at) * 1000,
  }));
  if (runtime !== 'claude') throw new Error('Unsupported replay source');
  const rows = options.homeDir
    ? await listRuntimeSessionTranscripts({ runtimeId: 'claude', homeDir: home, metadataOnly: true, limit: 100 })
    : (await browseNativeSessions({ runtimeId: 'claude', limit, query: options.query })).sessions;
  const query = options.query?.trim().toLowerCase();
  return rows.filter(r => !query || `${r.title} ${r.cwd}`.toLowerCase().includes(query)).slice(0, limit).map(r => ({
    id: r.id, runtime: 'claude', title: cleanVisibleText(String(r.title || r.preview || r.id)).slice(0, 160)||r.id, cwd: r.cwd, project: r.cwd ? path.basename(r.cwd) : 'Claude', updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.parse(r.updatedAt || ''),
  }));
}

export async function readReplaySource(runtime: string, id: string, homeDir?: string): Promise<ReplaySource> {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('Invalid source session identity');
  const home = homeDir ?? os.homedir();
  if (runtime === 'claude') {
    const rows = await listRuntimeSessionTranscripts({ runtimeId: 'claude', sessionId: id, homeDir: home, limit: 1 });
    const row = rows.find(r => r.id === id);
    if (!row) throw new Error('Claude session is missing or unreadable');
    const messages = (row.turns || []).map((m, i) => ({ id: `m${i}`, role: m.role, text: cleanVisibleText(m.content) })).filter(m => m.text);
    return { id, runtime: 'claude', title: cleanVisibleText(String(row.title || id)).slice(0, 160)||id, project: path.basename(row.cwd || 'Claude'), messages: messages.slice(-160) };
  }
  if (runtime !== 'codex') throw new Error('Unsupported replay source');
  const row = codexRows(home, { id, limit: 1 })[0];
  if (!row) throw new Error('Codex session is missing or unreadable');
  const root = path.join(home, '.codex', 'sessions');
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
  return { id, runtime: 'codex', title: cleanVisibleText(String(row.title || id)).slice(0, 160)||id, project: path.basename(String(row.cwd || 'Codex')), updatedAt: Number(row.updated_at) * 1000, messages: parseReplayRecords(records) };
}
