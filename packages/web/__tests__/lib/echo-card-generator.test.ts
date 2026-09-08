import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getTestMindRoot } from '../setup';
import type { AiTaskRunnerLike } from '@/lib/ai/ai-task-runner';
import {
  generateEchoCards,
  generateEchoCardsWithAi,
  readEchoCardsState,
  updateEchoCard,
  updateEchoCardSchedule,
} from '@/lib/echo-card-generator';

type Deferred = { promise: Promise<never>; reject: (reason: unknown) => void; started: Promise<void> };

/** An AI runner that blocks until the test releases it, then fails so the
 *  deterministic fallback produces cards. Models a multi-second model call. */
function slowRunner(): { runner: AiTaskRunnerLike; gate: Deferred } {
  let reject!: (reason: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const promise = new Promise<never>((_, rej) => { reject = rej; });
  const runner: AiTaskRunnerLike = {
    run: () => {
      markStarted();
      return promise;
    },
  };
  return { runner, gate: { promise, reject, started } };
}

describe('echo card generator', () => {
  const now = new Date('2026-06-29T12:00:00.000Z');

  function session(id: string, updatedOffsetMinutes: number) {
    return {
      id,
      title: `${id} Echo session`,
      createdAt: now.getTime() - (updatedOffsetMinutes + 20) * 60_000,
      updatedAt: now.getTime() - updatedOffsetMinutes * 60_000,
      defaultAgentRuntime: { name: 'Codex' },
      messages: [
        { role: 'user', content: '我们希望 source 保留 session 和 message refs。' },
        { role: 'assistant', content: '统一 Echo 卡片，只保留 kind、content 和 source。' },
      ],
    };
  }

  it('uses one source-backed contract for insight and promotion cards', () => {
    const root = getTestMindRoot();
    const insight = generateEchoCards({
      mindRoot: root,
      segment: 'insight',
      sessions: [session('insight-source', 5)],
      trigger: 'manual',
      locale: 'zh',
      now,
    });
    const promotion = generateEchoCards({
      mindRoot: root,
      segment: 'promotion',
      sessions: [session('promotion-source', 4)],
      trigger: 'manual',
      locale: 'zh',
      now: new Date(now.getTime() + 60_000),
    });

    expect(insight.cards[0]).toMatchObject({
      segment: 'insight',
      kind: 'pattern',
      content: expect.any(String),
      generation: { method: 'deterministic', trigger: 'manual', locale: 'zh' },
      source: {
        sessions: [
          expect.objectContaining({
            id: 'insight-source',
            runtime: 'Codex',
            messageRefs: [
              expect.objectContaining({ messageIndex: 1, role: 'assistant' }),
            ],
          }),
        ],
      },
    });
    expect(promotion.cards[0]).toMatchObject({
      segment: 'promotion',
      kind: 'playbook',
      source: {
        sessions: [
          expect.objectContaining({ id: 'promotion-source' }),
        ],
      },
    });
    expect(insight.cards[0]).not.toHaveProperty('evidence');
    expect(promotion.cards[0]).not.toHaveProperty('evidence');

    const state = readEchoCardsState(root);
    expect(state.cards.some((card) => card.segment === 'insight')).toBe(true);
    expect(state.cards.some((card) => card.segment === 'promotion')).toBe(true);
    expect(fs.existsSync(path.join(root, '.mindos', 'echo', 'cards.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.mindos', 'echo', 'cards', 'state.json'))).toBe(false);
  });

  it('keeps schedule state isolated per Echo card segment', () => {
    const root = getTestMindRoot();

    updateEchoCardSchedule(root, 'insight', {
      mode: 'interval',
      intervalHours: 6,
      dailyTime: '08:30',
    });

    const state = readEchoCardsState(root);
    expect(state.segments.insight.schedule).toEqual({
      mode: 'interval',
      intervalHours: 6,
      dailyTime: '08:30',
    });
    expect(state.segments.promotion.schedule).toEqual({
      mode: 'daily',
      intervalHours: 24,
      dailyTime: '20:00',
    });
  });

  it('lets manual generation reread recent history while auto generation stays checkpoint-based', () => {
    const root = getTestMindRoot();
    const sourceSession = session('repeat-source', 5);
    const first = generateEchoCards({
      mindRoot: root,
      segment: 'insight',
      sessions: [sourceSession],
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    expect(first.sourceWindow.sessionCount).toBe(1);
    expect(first.state.segments.insight.runCount).toBe(1);

    const auto = generateEchoCards({
      mindRoot: root,
      segment: 'insight',
      sessions: [sourceSession],
      trigger: 'auto',
      locale: 'zh',
      now: new Date(now.getTime() + 60_000),
    });

    expect(auto.sourceWindow.sessionCount).toBe(0);
    expect(auto.state.segments.insight.runCount).toBe(1);

    const manual = generateEchoCards({
      mindRoot: root,
      segment: 'insight',
      sessions: [sourceSession],
      trigger: 'manual',
      locale: 'zh',
      now: new Date(now.getTime() + 120_000),
    });

    expect(manual.sourceWindow.sessionCount).toBe(1);
    expect(manual.state.segments.insight.runCount).toBe(2);
    expect(manual.cards[0]?.source.sessions[0]?.id).toBe('repeat-source');
  });

  it('does not advance checkpoint or run count when no historical sessions are available', () => {
    const root = getTestMindRoot();
    const result = generateEchoCards({
      mindRoot: root,
      segment: 'promotion',
      sessions: [],
      trigger: 'auto',
      locale: 'zh',
      now,
    });

    expect(result.sourceWindow.sessionCount).toBe(0);
    expect(result.state.segments.promotion.runCount).toBe(0);
    expect(result.state.segments.promotion.checkpointAt).toBeUndefined();
    expect(readEchoCardsState(root).segments.promotion.checkpointAt).toBeUndefined();
  });
  it('does not lose concurrent edits made while an AI generation is in flight', async () => {
    const root = getTestMindRoot();
    const seeded = generateEchoCards({
      mindRoot: root,
      segment: 'promotion',
      sessions: [session('promotion-existing', 3)],
      trigger: 'manual',
      locale: 'zh',
      now,
    });
    const existingCard = seeded.cards[0];
    const { runner, gate } = slowRunner();

    const pending = generateEchoCardsWithAi({
      mindRoot: root,
      segment: 'insight',
      sessions: [session('insight-slow', 5)],
      trigger: 'manual',
      locale: 'zh',
      now: new Date(now.getTime() + 60_000),
      aiTaskRunner: runner,
    });
    await gate.started;

    // Writers landing during the model call: a schedule PATCH on the same
    // segment and a card edit on another segment.
    updateEchoCardSchedule(root, 'insight', { mode: 'interval', intervalHours: 6, dailyTime: '08:30' });
    const edited = updateEchoCard(root, 'promotion', existingCard.id, { content: '用户在生成期间编辑了这张卡片' }, new Date(now.getTime() + 90_000));
    expect(edited?.userEdited).toBe(true);

    gate.reject(new Error('model timeout'));
    const result = await pending;

    expect(result.extraction.mode).toBe('deterministic');
    expect(result.cards.length).toBeGreaterThan(0);
    const state = readEchoCardsState(root);
    expect(state.segments.insight.schedule).toEqual({ mode: 'interval', intervalHours: 6, dailyTime: '08:30' });
    expect(state.segments.insight.runCount).toBe(1);
    expect(state.cards.find((card) => card.id === existingCard.id)).toMatchObject({
      content: '用户在生成期间编辑了这张卡片',
      userEdited: true,
    });
    expect(state.cards.some((card) => card.segment === 'insight')).toBe(true);
    expect(result.state.segments.insight.schedule.mode).toBe('interval');
    expect(fs.readdirSync(path.join(root, '.mindos', 'echo')).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('serializes overlapping generations so neither run count nor cards are dropped', async () => {
    const root = getTestMindRoot();
    const first = slowRunner();
    const second = slowRunner();

    const insightRun = generateEchoCardsWithAi({
      mindRoot: root,
      segment: 'insight',
      sessions: [session('insight-parallel', 5)],
      trigger: 'manual',
      now,
      aiTaskRunner: first.runner,
    });
    const promotionRun = generateEchoCardsWithAi({
      mindRoot: root,
      segment: 'promotion',
      sessions: [session('promotion-parallel', 4)],
      trigger: 'manual',
      now: new Date(now.getTime() + 1_000),
      aiTaskRunner: second.runner,
    });

    await first.gate.started;
    first.gate.reject(new Error('first model failed'));
    await second.gate.started;
    second.gate.reject(new Error('second model failed'));
    const [insight, promotion] = await Promise.all([insightRun, promotionRun]);

    const state = readEchoCardsState(root);
    expect(state.segments.insight.runCount).toBe(1);
    expect(state.segments.promotion.runCount).toBe(1);
    expect(state.cards.some((card) => card.segment === 'insight')).toBe(true);
    expect(state.cards.some((card) => card.segment === 'promotion')).toBe(true);
    expect(insight.cards.length).toBeGreaterThan(0);
    expect(promotion.cards.length).toBeGreaterThan(0);
    expect(promotion.state.cards.some((card) => card.segment === 'insight')).toBe(true);
  });
});
