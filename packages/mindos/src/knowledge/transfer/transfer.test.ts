import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { startLearningLoop } from '../learning/index.js';
import { startTransferPractice, getTransferPractice, updateTransferPractice, listTransferPractices } from './index.js';
let home: string; let root: string; let learningId: string;
const now = new Date('2026-09-07T08:00:00Z');
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-')); root = path.join(home, 'knowledge'); fs.mkdirSync(root);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  learningId = startLearningLoop(root, { cardId: 'source', title: 'Evidence', content: 'Read carefully', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Check the design' }] }] }).id;
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(home, { recursive: true, force: true }); });
const answer = { answer: 'This design supports an association; alternative explanations remain.', confidence: 60, assistance: 'none', familiar: false };
function update(view: ReturnType<typeof startTransferPractice>, command: Record<string, unknown>, time = now) {
  return updateTransferPractice(root, view.id, { version: view.version, ...command }, time);
}
it('locks the initial judgment before showing guidance and never sends future tasks or keys', () => {
  let view = startTransferPractice(root, learningId, 'en', now);
  expect(view.stage).toBe('baseline'); expect(view.task?.prompt).toContain('coffee');
  expect(JSON.stringify(view)).not.toContain('school'); expect(view.guidance).toBeUndefined(); expect(view.history).toBeUndefined();
  expect(() => update(view, { action: 'guidance' })).toThrow();
  view = update(view, { action: 'answer', ...answer }); expect(view.stage).toBe('coaching');
  expect(view.previousAnswer?.answer).toBe(answer.answer);
  view = update(view, { action: 'guidance' }); expect(view.guidance).toContain('comparison');
  view = update(view, { action: 'prepare-agent' }); expect(view.agentHelpPreparedAt).toBe(now.toISOString());
  view = update(view, { action: 'answer', ...answer, answer: 'Revise the causal claim.' });
  expect(view.stage).toBe('transfer'); expect(view.previousAnswer).toBeUndefined(); expect(view.guidance).toBeUndefined();
  expect(view.task?.prompt).toContain('school');
  expect(() => update(view, { action: 'guidance' })).toThrow();
});
it('unlocks a new delayed task only after the specified interval and preserves separate answers', () => {
  let view = startTransferPractice(root, learningId, 'en', now);
  for (let i = 0; i < 3; i++) view = update(view, { action: 'answer', ...answer });
  expect(view.stage).toBe('waiting'); expect(view.task).toBeUndefined();
  expect(view.dueAt).toBe('2026-09-14T08:00:00.000Z');
  expect(() => update(view, { action: 'begin-delayed' })).toThrow();
  const later = new Date('2026-09-14T08:00:00Z');
  view = update(view, { action: 'begin-delayed' }, later); expect(view.task?.prompt).toContain('workshop');
  view = update(view, { action: 'answer', ...answer, assistance: 'agent' }, later);
  expect(view.stage).toBe('complete'); expect(view.history).toHaveLength(4);
  expect(view.history?.[0].response.answer).toBe(answer.answer);
  expect(view.history?.[0].independent).toBe(true);
  expect(view.history?.[3].independent).toBe(false);
  expect(view.history?.[0].reference).toBeTruthy();
  expect(() => update(view, { action: 'answer', ...answer }, later)).toThrow();
});
it('marks prior exposure and external help instead of calling every answer independent', () => {
  let view = startTransferPractice(root, learningId, 'zh', now);
  expect(startTransferPractice(root, learningId, 'en', now).id).toBe(view.id);
  const other = startLearningLoop(root, { cardId: 'other', title: 'Other', content: 'Other', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Evidence' }] }] });
  const again = startTransferPractice(root, other.id, 'zh', now); expect(again.previousExposure).toBe(true);
  view = update(view, { action: 'answer', ...answer, assistance: 'notes', familiar: true });
  view = update(view, { action: 'end', reason: 'stopped' });
  expect(view.history?.[0].independent).toBe(false); expect(view.ending?.reason).toBe('stopped');
  expect(JSON.stringify(view)).not.toContain('工作坊');
});
it('rejects stale, invalid, missing, duplicate and premature timeout commands without rewriting answers', () => {
  const view = startTransferPractice(root, learningId, 'en', now);
  for (const command of [{ action: 'answer', ...answer, answer: ' ' }, { action: 'answer', ...answer, confidence: 101 }, { action: 'answer', ...answer, answer: 'x'.repeat(4001) }, { action: 'end', reason: 'timeout' }]) expect(() => update(view, command)).toThrow();
  expect(() => getTransferPractice(root, '../escape')).toThrow();
  expect(() => startTransferPractice(root, 'learn-' + '0'.repeat(24), 'en')).toThrow();
  const next = update(view, { action: 'answer', ...answer });
  expect(() => update(view, { action: 'answer', ...answer })).toThrow();
  expect(getTransferPractice(root, next.id)?.version).toBe(next.version);
});
it('records missing answers and elapsed time without labeling them as failure', () => {
  let view = startTransferPractice(root, learningId, 'en', now);
  view = update(view, { action: 'end', reason: 'timeout' }, new Date(now.getTime() + 20 * 60_000));
  expect(view.stage).toBe('ended'); expect(view.history).toEqual([]); expect(view.ending?.reason).toBe('timeout');
  expect(view.ending?.stage).toBe('baseline');
});
it('stores private material outside the knowledge root and preserves it after a failed write', () => {
  const view = startTransferPractice(root, learningId, 'en', now);
  expect(fs.readdirSync(root)).toEqual(['.mindos']);
  expect(fs.existsSync(path.join(home, '.mindos', 'private-learning'))).toBe(true);
  const rename = fs.renameSync; vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk full'); });
  expect(() => update(view, { action: 'answer', ...answer })).toThrow();
  vi.mocked(fs.renameSync).mockImplementation(rename);
  expect(getTransferPractice(root, view.id)?.stage).toBe('baseline');
});
it('refuses corrupted task snapshots and inconsistent response histories instead of exposing later material', () => {
 const view = startTransferPractice(root, learningId, 'en', now);
 const dir = path.join(home, '.mindos', 'private-learning');
 const file = path.join(dir, fs.readdirSync(dir)[0], view.id + '.json');
 const record = JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(file, JSON.stringify({ ...record, stage: 'delayed' }));
 expect(() => getTransferPractice(root,view.id)).toThrow();
 fs.writeFileSync(file, JSON.stringify({ ...record, pack: { ...record.pack, guidance: 'Changed after freezing' } }));
 expect(() => getTransferPractice(root,view.id)).toThrow();
});

it('lists due practices before unfinished and waiting ones without exposing answers or future materials', () => {
  const start = (cardId: string, time: Date) => {
    const loop = startLearningLoop(root, { cardId, title: cardId, content: 'Evidence', sessions: [{ id: 's', messageRefs: [{ messageIndex: 0, role: 'user', quote: 'Evidence' }] }] });
    return startTransferPractice(root, loop.id, 'en', time);
  };
  expect(listTransferPractices(root, now)).toEqual({ practices: [], unavailableCount: 0 });
  let due = start('due', new Date(now.getTime() - 8 * 86400000));
  for (let i = 0; i < 3; i++) due = update(due, { action: 'answer', ...answer }, new Date(now.getTime() - 8 * 86400000));
  const unfinished = start('unfinished', now);
  let waiting = start('waiting', now);
  for (let i = 0; i < 3; i++) waiting = update(waiting, { action: 'answer', ...answer });
  const ended = start('ended', now); update(ended, { action: 'end', reason: 'stopped' });
  const list = listTransferPractices(root, now);
  expect(list.practices.map(item => item.id)).toEqual([due.id, unfinished.id, waiting.id]);
  expect(list.practices.map(item => item.status)).toEqual(['due', 'continue', 'scheduled']);
  expect(JSON.stringify(list)).not.toMatch(/coffee|school|workshop|answers|reference|guidance|This design/);
  const ready = listTransferPractices(root, new Date(waiting.dueAt!));
  expect(ready.practices.find(item => item.id === waiting.id)?.status).toBe('due');
});
it('keeps healthy pending practices visible when one private record is corrupt', () => {
  const view = startTransferPractice(root, learningId, 'en', now);
  const base = path.join(home, '.mindos', 'private-learning'); const dir = path.join(base, fs.readdirSync(base)[0]);
  fs.writeFileSync(path.join(dir, 'transfer-' + 'a'.repeat(24) + '.json'), '{broken');
  const result = listTransferPractices(root, now);
  expect(result.practices.map(item => item.id)).toEqual([view.id]); expect(result.unavailableCount).toBe(1);
  expect(fs.readFileSync(path.join(dir, 'transfer-' + 'a'.repeat(24) + '.json'), 'utf8')).toBe('{broken');
});
