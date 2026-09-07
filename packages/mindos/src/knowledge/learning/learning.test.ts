import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLearningLoop, listLearningLoops, updateLearningLoop, learningMarkdown } from './index.js';

const source = {
  cardId: 'insight-123', title: '先核对证据', content: '引用之前核对原文。',
  sessions: [{ id: 'session-1', title: '文献讨论', messageRefs: [{ messageIndex: 2, role: 'user', quote: '这条证据支持不了结论。' }] }],
};
const reflection = { before: '我以前依赖摘要。', understanding: '现在需要核对原文和适用边界。' };
const plan = { situation: '下次写 related work', experiment: '逐句查证原文', check: '能解释每个结论的证据边界', reviewOn: '2026-09-09' };
const review = { outcome: 'mixed', observation: '找到两处过强措辞，还有一篇没读懂。', revisedRule: '先解释证据，再决定措辞；不确定就保留。' };
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-learning-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('human learning loop', () => {
  it('persists reflection, an observable experiment and a revised rule across rounds', () => {
    let loop = startLearningLoop(dir, source);
    expect(loop.stage).toBe('reflecting');
    loop = updateLearningLoop(dir, loop.id, { action: 'reflect', version: loop.version, ...reflection });
    expect(loop.stage).toBe('planning');
    loop = updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan });
    expect(loop.stage).toBe('practicing');
    loop = updateLearningLoop(dir, loop.id, { action: 'review', version: loop.version, ...review });
    expect(loop.stage).toBe('reviewed');
    expect(loop.attempts[0].review).toMatchObject(review);
    const priorAttempt = structuredClone(loop.attempts[0]);
    loop = updateLearningLoop(dir, loop.id, { action: 'retry', version: loop.version });
    expect(loop.stage).toBe('planning');
    loop = updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan, situation: '一个新项目' });
    expect(loop.attempts).toHaveLength(2);
    expect(loop.attempts[0]).toEqual(priorAttempt);
    expect(loop.attempts[1].rule).toBe(review.revisedRule);
    expect(listLearningLoops(dir)).toEqual([loop]);
    expect(learningMarkdown(loop)).toContain(source.sessions[0].messageRefs[0].quote);
    expect(learningMarkdown(loop)).toContain(review.observation);
  });

  it('starts once per source and preserves the original evidence when the card changes', () => {
    const first = startLearningLoop(dir, source);
    const again = startLearningLoop(dir, { ...source, content: 'changed' });
    expect(again).toEqual(first);
    expect(listLearningLoops(dir)).toHaveLength(1);
    expect(first.source.content).toBe(source.content);
  });

  it('rejects skipped steps, stale writes and edits to archived records', () => {
    const first = startLearningLoop(dir, source);
    expect(() => updateLearningLoop(dir, first.id, { action: 'review', version: 1, ...review })).toThrow();
    const reflected = updateLearningLoop(dir, first.id, { action: 'reflect', version: 1, ...reflection });
    expect(() => updateLearningLoop(dir, first.id, { action: 'reflect', version: 1, ...reflection })).toThrow(/changed/i);
    const archived = updateLearningLoop(dir, first.id, { action: 'archive', version: reflected.version });
    expect(() => updateLearningLoop(dir, first.id, { action: 'plan', version: archived.version, ...plan })).toThrow();
    expect(updateLearningLoop(dir, first.id, { action: 'restore', version: archived.version }).archived).toBe(false);
  });

  it('allows replanning before review and truthfully records an untried practice', () => {
    let loop = startLearningLoop(dir, source);
    loop = updateLearningLoop(dir, loop.id, { action: 'reflect', version: loop.version, ...reflection });
    loop = updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan });
    loop = updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan, reviewOn: '2026-09-12' });
    expect(loop.attempts).toHaveLength(1);
    expect(loop.attempts[0].plan.reviewOn).toBe('2026-09-12');
    loop = updateLearningLoop(dir, loop.id, { action: 'review', version: loop.version, ...review, outcome: 'not-tried' });
    expect(loop.attempts[0].review?.outcome).toBe('not-tried');
    expect(loop).not.toHaveProperty('growthScore');
  });

  it.each([null, {}, { ...reflection, before: '' }, { ...reflection, understanding: 'x'.repeat(4001) }])('rejects incomplete or oversized reflection %j', (fields) => {
    const loop = startLearningLoop(dir, source);
    expect(() => updateLearningLoop(dir, loop.id, { ...fields, action: 'reflect', version: 1 })).toThrow();
    expect(listLearningLoops(dir)[0].version).toBe(1);
  });

  it.each(['2026-02-30', 'tomorrow', '', '2026-13-01'])('rejects impossible review dates: %s', (reviewOn) => {
    let loop = startLearningLoop(dir, source);
    loop = updateLearningLoop(dir, loop.id, { action: 'reflect', version: 1, ...reflection });
    expect(() => updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan, reviewOn })).toThrow();
  });

  it('rejects missing evidence, invalid identifiers and nonexistent records', () => {
    expect(() => startLearningLoop(dir, { ...source, sessions: [] })).toThrow();
    expect(() => updateLearningLoop(dir, '../../escape', { action: 'retry', version: 1 })).toThrow();
    expect(() => updateLearningLoop(dir, 'learn-' + 'a'.repeat(24), { action: 'retry', version: 1 })).toThrow(/not found/i);
  });

  it('never treats a corrupt ledger as an empty new record', () => {
    const loop = startLearningLoop(dir, source);
    const file = path.join(dir, '.mindos/echo/learning', loop.id + '.json');
    fs.writeFileSync(file, '{broken');
    expect(() => listLearningLoops(dir)).toThrow(/read/i);
    expect(() => startLearningLoop(dir, source)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('blocks metadata symlinks escaping the knowledge root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-outside-'));
    try {
      fs.symlinkSync(outside, path.join(dir, '.mindos'));
      expect(() => startLearningLoop(dir, source)).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('preserves the old record and removes temporary files after a disk write failure', () => {
    const loop = startLearningLoop(dir, source);
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }); });
    expect(() => updateLearningLoop(dir, loop.id, { action: 'reflect', version: 1, ...reflection })).toThrow(/save/i);
    rename.mockRestore();
    expect(listLearningLoops(dir)).toEqual([loop]);
    expect(fs.readdirSync(path.join(dir, '.mindos/echo/learning'))).toEqual([loop.id + '.json']);
  });

  it('does not overwrite another writer and recovers a crashed writer lock', () => {
    const loop = startLearningLoop(dir, source);
    const lock = path.join(dir, '.mindos/echo/learning', loop.id + '.json.lock');
    fs.writeFileSync(lock, '');
    expect(() => updateLearningLoop(dir, loop.id, { action: 'archive', version: 1 })).toThrow(/saved/i);
    expect(listLearningLoops(dir)).toEqual([loop]);
    fs.utimesSync(lock, new Date(0), new Date(0));
    expect(updateLearningLoop(dir, loop.id, { action: 'archive', version: 1 }).archived).toBe(true);
  });

  it('exports a Chinese journal with readable outcomes and its record identity', () => {
    let loop = startLearningLoop(dir, source);
    loop = updateLearningLoop(dir, loop.id, { action: 'reflect', version: loop.version, ...reflection });
    loop = updateLearningLoop(dir, loop.id, { action: 'plan', version: loop.version, ...plan });
    loop = updateLearningLoop(dir, loop.id, { action: 'review', version: loop.version, ...review });
    const markdown = learningMarkdown(loop, 'zh');
    expect(markdown).toContain('## 我的理解');
    expect(markdown).toContain('部分有帮助');
    expect(markdown).toContain(loop.id);
    expect(markdown).toContain('insight-123');
  });
});
