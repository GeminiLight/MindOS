import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSqliteDriver } from '../../../../foundation/storage/sqlite-driver.js';
import { browseNativeSessions } from './native-browser.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
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
  it('uses Claude SDK metadata for global pages and the original cwd for history', async () => {
    const calls: unknown[] = [];
    const sdk = {
      listSessions: async (options: unknown) => { calls.push(options); return [{ sessionId: 'c1', summary: 'First', lastModified: 2, cwd: '/original' }, { sessionId: 'c2', summary: 'Second', lastModified: 1 }]; },
      getSessionInfo: async () => ({ sessionId: 'c1', summary: 'First', lastModified: 2, cwd: '/original' }),
      getSessionMessages: async (_id: string, options: unknown) => { calls.push(options); return [{ type: 'user', message: { role: 'user', content: 'hello' } }]; },
    };
    const page = await browseNativeSessions({ runtimeId: 'claude', limit: 1 }, sdk);
    expect(page.sessions[0]).toMatchObject({ id: 'c1', cwd: '/original' });
    expect(page.nextCursor).toBe('1'); expect(calls[0]).toEqual({ limit: 2, offset: 0 });
    const history = await browseNativeSessions({ runtimeId: 'claude', sessionId: 'c1' }, sdk);
    expect(history.sessions[0].turns).toEqual([{ role: 'user', content: 'hello' }]);
    expect(calls[1]).toEqual({ dir: '/original' });
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
  it('finds older Claude matches before applying the page and reports deleted history', async () => {
    const sdk = {
      listSessions: async () => Array.from({ length: 105 }, (_, i) => ({ sessionId: String(i), summary: i === 104 ? '预算' : 'Other', lastModified: 200 - i })),
      getSessionInfo: async () => undefined,
      getSessionMessages: async () => [],
    };
    expect((await browseNativeSessions({ runtimeId: 'claude', query: '预算', limit: 30 }, sdk)).sessions.map(s => s.id)).toEqual(['104']);
    await expect(browseNativeSessions({ runtimeId: 'claude', sessionId: 'deleted' }, sdk)).rejects.toMatchObject({ status: 404 });
  });

});
