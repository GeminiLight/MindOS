import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSqliteDriver } from '../../../../foundation/storage/sqlite-driver.js';
import { browseNativeSessions } from './native-browser.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function writeClaudeSession(homeDir: string, id: string, cwd: string, prompts: string[], minute: number) {
  const dir = join(homeDir, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9_-]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const at = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  const lines = prompts.map(text => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd, sessionId: id, timestamp: at }));
  writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n') + '\n');
}
function fixture() {
  const homeDir = mkdtempSync(join(tmpdir(), 'mindos-native-browser-')); roots.push(homeDir);
  const dbPath = join(homeDir, '.local/share/opencode/opencode.db'); mkdirSync(join(dbPath, '..'), { recursive: true });
  return { homeDir, dbPath };
}
describe('native session discovery', () => {
  it('paginates OpenCode beyond one hundred sessions without reading message bodies or changing the database', async () => {
    const { homeDir, dbPath } = fixture(); const db = loadSqliteDriver().open(dbPath);
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);');
    const insert = db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 105; i++) insert.run(`ses-${i}`, i % 2 ? '/a' : '/b', `Design ${i}`, i, i);
    db.close(); const before = readFileSync(dbPath);
    let cursor: string | undefined; const ids: string[] = [];
    do {
      const page = await browseNativeSessions({ runtimeId: 'opencode', homeDir, limit: 30, cursor });
      ids.push(...page.sessions.map(s => s.id));
      expect(page.sessions.every(s => s.turns === undefined)).toBe(true);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(105); expect(new Set(ids).size).toBe(105);
    expect(readFileSync(dbPath)).toEqual(before);
  });
  it('searches the entire OpenCode list and scopes directories before pagination', async () => {
    const { homeDir, dbPath } = fixture(); const db = loadSqliteDriver().open(dbPath);
    db.exec('CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);');
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('quoted', '/项目/a', "Owner's 预算", 1, 1); db.close();
    const page = await browseNativeSessions({ runtimeId: 'opencode', homeDir, cwd: '/项目/a', query: "Owner's" });
    expect(page.sessions.map(s => s.id)).toEqual(['quoted']);
    expect((await browseNativeSessions({ runtimeId: 'opencode', homeDir, query: "' OR 1=1 --" })).sessions).toEqual([]);
  });
  it('distinguishes a missing database from a corrupt database and rejects malformed cursors', async () => {
    const { homeDir, dbPath } = fixture();
    expect((await browseNativeSessions({ runtimeId: 'opencode', homeDir })).sessions).toEqual([]);
    writeFileSync(dbPath, 'broken');
    await expect(browseNativeSessions({ runtimeId: 'opencode', homeDir })).rejects.toThrow(/OpenCode/);
    await expect(browseNativeSessions({ runtimeId: 'claude', cursor: '-1' })).rejects.toThrow(/cursor/i);
  });
  it('reads only the selected OpenCode conversation with its original directory', async () => {
    const { homeDir, dbPath } = fixture(); const db = loadSqliteDriver().open(dbPath);
    db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, time_created INTEGER, data TEXT);`);
    db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('selected', '/original', 'History', 1, 2);
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('m1', 'selected', 1, JSON.stringify({ role: 'user' }));
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run('p1', 'm1', 1, JSON.stringify({ type: 'text', text: 'Continue this plan' }));
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('other', 'unrelated', 2, JSON.stringify({ role: 'user' }));
    db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run('p2', 'other', 2, JSON.stringify({ type: 'text', text: 'Private other conversation' }));
    db.close();
    const page = await browseNativeSessions({ runtimeId: 'opencode', homeDir, sessionId: 'selected' });
    expect(page.sessions[0]).toMatchObject({ id: 'selected', cwd: '/original', turns: [{ role: 'user', content: 'Continue this plan' }] });
    await expect(browseNativeSessions({ runtimeId: 'opencode', homeDir, sessionId: 'deleted' })).rejects.toMatchObject({ status: 404 });
  });
  it('pages Claude history from transcript files without reading whole conversations', async () => {
    const { homeDir } = fixture();
    for (let i = 0; i < 35; i++) writeClaudeSession(homeDir, `c${i}`, i % 2 ? '/a' : '/b', [`Plan ${i}`, 'follow-up'], i);
    let cursor: string | undefined; const ids: string[] = [];
    do {
      const page = await browseNativeSessions({ runtimeId: 'claude', homeDir, limit: 10, cursor });
      ids.push(...page.sessions.map(s => s.id));
      expect(page.sessions.every(s => s.turns === undefined)).toBe(true);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(35); expect(new Set(ids).size).toBe(35);
    expect(ids[0]).toBe('c34');
  });
  it('opens one Claude conversation with its original directory', async () => {
    const { homeDir } = fixture();
    writeClaudeSession(homeDir, 'c1', '/original', ['hello', 'and then'], 1);
    writeClaudeSession(homeDir, 'c2', '/other', ['unrelated'], 2);
    const history = await browseNativeSessions({ runtimeId: 'claude', homeDir, sessionId: 'c1' });
    expect(history.sessions).toHaveLength(1);
    expect(history.sessions[0]).toMatchObject({ id: 'c1', cwd: '/original' });
    expect(history.sessions[0].turns?.map(t => t.content)).toEqual(['hello', 'and then']);
  });
  it('finds older Claude matches before applying the page and reports deleted history', async () => {
    const { homeDir } = fixture();
    for (let i = 0; i < 40; i++) writeClaudeSession(homeDir, String(i), '/a', [i === 0 ? '预算 review' : 'Other'], 100 + i);
    expect((await browseNativeSessions({ runtimeId: 'claude', homeDir, query: '预算', limit: 30 })).sessions.map(s => s.id)).toEqual(['0']);
    await expect(browseNativeSessions({ runtimeId: 'claude', homeDir, sessionId: 'deleted' })).rejects.toMatchObject({ status: 404 });
  });
  it('scopes Claude history to the requested project directory', async () => {
    const { homeDir } = fixture();
    writeClaudeSession(homeDir, 'in', '/项目/a', ['mine'], 1);
    writeClaudeSession(homeDir, 'out', '/项目/b', ['theirs'], 2);
    expect((await browseNativeSessions({ runtimeId: 'claude', homeDir, cwd: '/项目/a' })).sessions.map(s => s.id)).toEqual(['in']);
  });
  it('returns an empty Claude page when Claude Code was never used', async () => {
    const { homeDir } = fixture();
    expect(await browseNativeSessions({ runtimeId: 'claude', homeDir })).toEqual({ sessions: [], nextCursor: null });
  });
});
