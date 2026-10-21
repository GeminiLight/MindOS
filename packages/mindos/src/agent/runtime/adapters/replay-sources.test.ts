import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSqliteDriver } from '../../../foundation/storage/sqlite-driver.js';
import { listReplaySources, parseReplayRecords, readReplaySource } from './replay-sources.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-source-')); dirs.push(homeDir);
  const dir = path.join(homeDir, '.codex', 'sessions'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.jsonl');
  const db = loadSqliteDriver().open(path.join(homeDir, '.codex', 'state_5.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, cwd TEXT, updated_at INTEGER, rollout_path TEXT, archived INTEGER)');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('session-1', '选择工作台 🌱', '/项目/MindOS', 100, file, 0); db.close();
  const rows = [{ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '先保留文件树。' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'PRIVATE REASONING' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '按现有结构继续。' }] } }];
  fs.writeFileSync(file, rows.map(v => JSON.stringify(v)).join('\n'));
  return { homeDir, file, rows };
}
describe('local replay source boundaries', () => {
  it('excludes non-visible summaries and masks credential-like strings in metadata', async () => {
    const {homeDir,rows}=fixture();
    const hidden={type:'response_item',payload:{type:'message',role:'assistant',channel:'summary',content:[{type:'output_text',text:'INTERNAL SUMMARY'}]}};
    expect(parseReplayRecords([...rows,hidden]).map(m=>m.text)).not.toContain('INTERNAL SUMMARY');
    const db=loadSqliteDriver().open(path.join(homeDir,'.codex','state_5.sqlite'));
    db.prepare('UPDATE threads SET title = ?').run('test sk-'+ 'x'.repeat(24));db.close();
    const entries=await listReplaySources({homeDir,runtime:'codex'});
    expect(entries[0].title).toContain('[redacted]');
  });
  it('keeps visible text and excludes internal reasoning, tools and bootstrap instructions', () => {
    const { rows } = fixture();
    const parsed = parseReplayRecords([...rows, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions secret bootstrap' }] } }]);
    expect(parsed.map(m => m.text)).toEqual(['先保留文件树。', '按现有结构继续。']);
    expect(parsed[0].id).not.toBe(parsed[1].id);
  });
  it('reads only the indexed source and returns searchable metadata without raw rollout paths', async () => {
    const { homeDir } = fixture();
    const entries = await listReplaySources({ homeDir, runtime: 'codex', query: '工作台', limit: 4 });
    expect(entries).toHaveLength(1); expect(entries[0].title).toBe('选择工作台 🌱');
    expect(JSON.stringify(entries)).not.toContain('rollout_path');
    const source = await readReplaySource('codex', 'session-1', homeDir);
    expect(source.messages).toHaveLength(2); expect(source.runtime).toBe('codex');
  });
  it('rejects path traversal, unknown ids, unavailable storage and index paths outside session storage', async () => {
    const { homeDir } = fixture();
    await expect(readReplaySource('codex', '../outside', homeDir)).rejects.toThrow();
    await expect(readReplaySource('codex', 'missing', homeDir)).rejects.toThrow();
    const db = loadSqliteDriver().open(path.join(homeDir, '.codex', 'state_5.sqlite'));
    db.prepare('UPDATE threads SET rollout_path = ?').run(path.join(homeDir, 'outside.jsonl')); db.close();
    await expect(readReplaySource('codex', 'session-1', homeDir)).rejects.toThrow(/outside|storage/i);
  });
  it('does not conflate missing storage with a corrupted index', async () => {
    const { homeDir } = fixture();
    fs.writeFileSync(path.join(homeDir, '.codex', 'state_5.sqlite'), 'not sqlite');
    await expect(listReplaySources({ homeDir, runtime: 'codex' })).rejects.toThrow();
    expect(await listReplaySources({ homeDir: path.join(homeDir, 'empty'), runtime: 'codex' })).toEqual([]);
  });
});
