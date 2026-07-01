import { describe, expect, it } from 'vitest';
import { getTestMindRoot } from '../setup';
import {
  generateEchoCards,
  readEchoCardsState,
  updateEchoCardSchedule,
} from '@/lib/echo-card-generator';

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
});
