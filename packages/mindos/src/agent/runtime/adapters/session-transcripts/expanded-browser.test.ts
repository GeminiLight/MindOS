import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { browseNativeSessions } from './native-browser.js';
const homes: string[] = [];
async function home() { const p = await mkdtemp(join(tmpdir(), 'mindos-expanded-')); homes.push(p); return p; }
async function file(root: string, path: string, value: unknown) {
  const p = join(root, path); await mkdir(join(p, '..'), { recursive: true });
  await writeFile(p, Array.isArray(value) ? value.map(x => JSON.stringify(x)).join('\n') : JSON.stringify(value));
}
afterEach(async () => { await Promise.all(homes.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it.each(['qwen', 'codebuddy', 'openclaw'])('%s paginates all native summaries and searches before slicing', async runtimeId => {
  const h = await home();
  const dir = runtimeId === 'qwen' ? '.qwen/projects/-work-repo/chats' : runtimeId === 'codebuddy' ? '.codebuddy/projects/-work-repo' : '.openclaw/agents/main/sessions';
  await Promise.all(Array.from({ length: 35 }, (_, i) => file(h, `${dir}/session-${i}.jsonl`, [{ type: 'user', sessionId: `session-${i}`, cwd: '/work/repo', timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(), message: { role: 'user', content: `Topic ${i}` } }])));
  const first = await browseNativeSessions({ runtimeId, homeDir: h, limit: 30 });
  expect(first.sessions).toHaveLength(30); expect(first.nextCursor).toBe('30');
  expect(first.sessions.every(s => !('turns' in s))).toBe(true);
  const next = await browseNativeSessions({ runtimeId, homeDir: h, cursor: first.nextCursor!, limit: 30 });
  expect(next.sessions).toHaveLength(5); expect(next.nextCursor).toBeNull();
  const match = await browseNativeSessions({ runtimeId, homeDir: h, query: 'Topic 0', limit: 1 });
  expect(match.sessions[0]?.id).toBe('session-0');
  const history = await browseNativeSessions({ runtimeId, homeDir: h, sessionId: 'session-0' });
  expect(history.sessions[0]).toMatchObject({ cwd: '/work/repo', turns: [{ role: 'user', content: 'Topic 0' }] });
});
it('discovers CodeBuddy sessions beyond the previous 500-file ceiling', async () => {
  const h = await home();
  await Promise.all(Array.from({ length: 505 }, (_, i) => file(h, `.codebuddy/projects/repo/${String(i).padStart(4, '0')}.jsonl`, [{ type: 'user', message: { role: 'user', content: `Entry ${i}` }, cwd: '/work/repo' }])));
  const page = await browseNativeSessions({ runtimeId: 'codebuddy', homeDir: h, query: 'Entry 504' });
  expect(page.sessions).toHaveLength(1); expect(page.sessions[0]?.id).toBe('0504');
});
it('reads Gemini legacy JSON and current message records in hashed project folders with their real cwd', async () => {
  const h = await home(); const root = '.gemini/tmp/hash-that-is-not-a-basename';
  await mkdir(join(h, root), { recursive: true }); await writeFile(join(h, root, '.project_root'), '/work/repo');
  await file(h, `${root}/chats/old.json`, { sessionId: 'old', messages: [{ type: 'user', content: 'Legacy question' }] });
  await file(h, `${root}/chats/new.jsonl`, [{ sessionId: 'new', projectHash: 'hash' }, { id: 'u1', type: 'user', content: 'Current question' }, { id: 'a1', type: 'gemini', content: 'Current answer' }]);
  const all = await browseNativeSessions({ runtimeId: 'gemini', homeDir: h, cwd: '/work/repo' });
  expect(all.sessions.map(s => s.id).sort()).toEqual(['new', 'old']);
  expect(all.sessions.every(s => s.cwd === '/work/repo')).toBe(true);
  const history = await browseNativeSessions({ runtimeId: 'gemini', homeDir: h, sessionId: 'new' });
  expect(history.sessions[0]?.turns?.map(m => m.content)).toEqual(['Current question', 'Current answer']);
});
it('reads Kimi current and legacy directories without inventing a project directory', async () => {
  const h = await home();
  await file(h, '.kimi/kimi.json', { work_dirs: [{ path: '/work/研究', kaos: 'local' }] });
  const { createHash } = await import('node:crypto');
  const hash = createHash('md5').update('/work/研究').digest('hex');
  await file(h, `.kimi/sessions/${hash}/legacy/state.json`, { title: 'Legacy Kimi' });
  await file(h, `.kimi/sessions/${hash}/legacy/context.jsonl`, [{ role: 'user', content: 'Legacy user' }]);
  await file(h, '.kimi-code/sessions/opaque/new/state.json', { title: 'New Kimi', workDir: '/work/another' });
  await file(h, '.kimi-code/sessions/opaque/new/agents/main/wire.jsonl', [{ type: 'context.append_message', message: { role: 'user', content: 'New user' } }]);
  const all = await browseNativeSessions({ runtimeId: 'kimi', homeDir: h });
  expect(all.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'legacy', cwd: '/work/研究' }), expect.objectContaining({ id: 'new', cwd: '/work/another' })]));
  expect((await browseNativeSessions({ runtimeId: 'kimi', homeDir: h, cwd: '/work/研究' })).sessions.map(s => s.id)).toEqual(['legacy']);
});
it('reports invalid pagination and missing selected histories, while an absent store is empty', async () => {
  const h = await home();
  await expect(browseNativeSessions({ runtimeId: 'qwen', homeDir: h, cursor: '-1' })).rejects.toThrow(/cursor/);
  await expect(browseNativeSessions({ runtimeId: 'qwen', homeDir: h, sessionId: '../escape' })).rejects.toThrow();
  expect(await browseNativeSessions({ runtimeId: 'qwen', homeDir: h })).toEqual({ sessions: [], nextCursor: null });
});
it('replays Gemini message updates and rewinds without resurrecting removed turns', async () => {
  const { parseGeminiMessagesFromRecords } = await import('./normalizer.js');
  expect(parseGeminiMessagesFromRecords([
    { id: 'u', type: 'user', content: 'question' },
    { id: 'a', type: 'gemini', content: 'draft' },
    { id: 'a', type: 'gemini', content: 'final' },
    { id: 'u2', type: 'user', content: 'removed' },
    { $rewindTo: 'u2' },
  ]).map(m => m.content)).toEqual(['question', 'final']);
});
it.each(['qwen', 'codebuddy', 'openclaw'])('%s never assigns the current directory to an unknown transcript', async runtimeId => {
  const h = await home();
  const dir = runtimeId === 'qwen' ? '.qwen/projects/opaque-hash/chats' : runtimeId === 'codebuddy' ? '.codebuddy/projects/repo' : '.openclaw/agents/main/sessions';
  await file(h, `${dir}/unknown.jsonl`, [{ type: 'user', message: { role: 'user', content: 'Unknown project' } }]);
  expect((await browseNativeSessions({ runtimeId, homeDir: h, sessionId: 'unknown', cwd: '/current' })).sessions[0]?.cwd).toBeUndefined();
  expect((await browseNativeSessions({ runtimeId, homeDir: h, cwd: '/current' })).sessions).toEqual([]);
  await file(h, `${dir}/known.jsonl`, [{ type: 'user', cwd: '/actual', message: { role: 'user', content: 'Known project' } }]);
  expect((await browseNativeSessions({ runtimeId, homeDir: h, cwd: '/actual' })).sessions.map(s => s.id)).toEqual(['known']);
});
it('reports a wholly corrupt history and oversized records, but accepts a trailing partial write', async () => {
  const { readJsonl, readJsonFile } = await import('./file-system.js');
  const h = await home(); const path = join(h, 'bad.jsonl');
  await writeFile(path, '{broken\n'); await expect(readJsonl(path)).rejects.toThrow(/invalid|corrupt/i);
  await expect(readJsonFile(path)).rejects.toThrow();
  await writeFile(path, '{"type":"user"}\n{"partial":'); expect(await readJsonl(path)).toHaveLength(1);
  await writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1)); await expect(readJsonl(path)).rejects.toThrow(/limit|large/i);
});
