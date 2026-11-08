import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replayProjectIdentity, sampleReplayMessages } from './replay-projects.js';
import { listReplaySourcePage } from './replay-sources.js';
import { loadSqliteDriver } from '../../../foundation/storage/sqlite-driver.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
function temp() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-project-')); dirs.push(dir); return dir; }
describe('project experiences source discovery', () => {
  it('groups repository subdirectories and linked worktrees, without merging equal basenames', () => {
    const dir = temp(), main = path.join(dir, 'main'), work = path.join(dir, 'work');
    fs.mkdirSync(path.join(main, '.git', 'worktrees', 'work'), { recursive: true });
    fs.mkdirSync(path.join(main, 'packages', 'web'), { recursive: true });
    fs.mkdirSync(work); fs.writeFileSync(path.join(work, '.git'), `gitdir: ${main}/.git/worktrees/work`);
    fs.writeFileSync(path.join(main, '.git', 'worktrees', 'work', 'commondir'), '../..');
    expect(replayProjectIdentity(work).id).toBe(replayProjectIdentity(path.join(main, 'packages', 'web')).id);
    expect(replayProjectIdentity('/a/同名').id).not.toBe(replayProjectIdentity('/b/同名').id);
    expect(replayProjectIdentity(undefined).id).toBe('unassigned');
  });
  it('keeps middle corrections and adjacent replies inside an explicit bounded transcript', () => {
    const messages = Array.from({ length: 1800 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'assistant' as const : 'user' as const, text: i === 900 ? '不要仅仅只看总体指标，需要检查对象的遮挡。' : `正常对话 ${i}` }));
    const sampled = sampleReplayMessages(messages);
    expect(sampled.messages.map(m => m.id)).toEqual(expect.arrayContaining(['m0', 'm899', 'm900', 'm901', 'm1799']));
    expect(sampled.messages.length).toBeLessThanOrEqual(512);
    expect(sampled.coverage).toMatchObject({ totalMessages: 1800, includedMessages: sampled.messages.length, truncated: true });
    expect(sampleReplayMessages([]).coverage.truncated).toBe(false);
  });
  it('pages stable Codex metadata, searches before pagination, includes archived only on request', async () => {
    const homeDir = temp(); fs.mkdirSync(path.join(homeDir, '.codex'));
    const db = loadSqliteDriver().open(path.join(homeDir, '.codex/state_5.sqlite'));
    db.exec('CREATE TABLE threads(id TEXT,title TEXT,cwd TEXT,updated_at INTEGER,rollout_path TEXT,archived INTEGER)');
    for (let i = 0; i < 6; i++) db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run(`s${i}`, `取舍 ${i}`, '/项目/示例', 100, '/unused', i === 5 ? 1 : 0);
    db.close();
    const first = await listReplaySourcePage({ homeDir, runtime: 'codex', limit: 2 });
    const second = await listReplaySourcePage({ homeDir, runtime: 'codex', limit: 2, cursor: first.nextCursor! });
    expect(first.sources).toHaveLength(2);
    expect(new Set([...first.sources, ...second.sources].map(s => s.id)).size).toBe(4);
    expect((await listReplaySourcePage({ homeDir, runtime: 'codex', query: '取舍 5', includeArchived: true })).sources[0].archived).toBe(true);
    expect((await listReplaySourcePage({ homeDir, runtime: 'codex', query: '取舍 5' })).sources).toEqual([]);
    const editing = loadSqliteDriver().open(path.join(homeDir, '.codex/state_5.sqlite'));
    editing.exec('ALTER TABLE threads ADD COLUMN source TEXT');
    editing.prepare('UPDATE threads SET source = ? WHERE id = ?').run('{"subagent":{"thread_spawn":{}}}', 's0'); editing.close();
    expect((await listReplaySourcePage({ homeDir, runtime: 'codex', query: '取舍 0' })).sources).toEqual([]);
    await expect(listReplaySourcePage({ homeDir, cursor: '../bad' })).rejects.toThrow(/cursor/i);
    await expect(listReplaySourcePage({ homeDir, limit: 101 })).rejects.toThrow(/limit/i);
  });
});
