import { describe, expect, it } from 'vitest';
import { getTestMindRoot } from '../setup';
import type { AiTaskRunnerLike } from '@/lib/ai/ai-task-runner';
import {
  generateEchoCards,
  generateEchoCardsWithAi,
  readEchoCardsState,
  reviewEchoPromotionCard,
} from '@/lib/echo-card-generator';

describe('echo agreement cards in the promotion segment', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');

  function correctionSession(id: string, minutesAgo: number, correction: string) {
    return {
      id,
      title: `${id} session`,
      createdAt: now.getTime() - (minutesAgo + 20) * 60_000,
      updatedAt: now.getTime() - minutesAgo * 60_000,
      defaultAgentRuntime: { name: 'Claude Code' },
      messages: [
        { role: 'assistant', content: 'Patch is ready.' },
        { role: 'user', content: correction },
      ],
    };
  }

  const repeatedCorrection = () => [
    correctionSession('agreement-a', 30, '说了多少次，不要使用 any 类型，把类型补上。'),
    correctionSession('agreement-b', 10, '可以，不过别用 any 类型，其他没问题。'),
  ];

  it('promotes a correction repeated across sessions into a reviewable agreement card', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    expect(agreement).toBeDefined();
    expect(agreement?.segment).toBe('promotion');
    expect(agreement?.content).toContain('any');
    expect(agreement?.source.label).toContain('2');
    expect(agreement?.source.sessions).toHaveLength(2);
  });

  it('carries the quotes forward so the promotion review has grounded evidence', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    const quotes = (agreement?.source.sessions ?? []).flatMap((session) => session.messageRefs ?? []);

    expect(quotes.length).toBeGreaterThanOrEqual(2);
    expect(quotes.every((ref) => ref.role === 'user' && ref.quote.length > 0)).toBe(true);
  });

  it('lists the agreement before the other promotion cards', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    expect(result.cards[0]?.kind).toBe('agreement');
  });

  it('persists the agreement so a later read sees the same card id', () => {
    const root = getTestMindRoot();
    const first = generateEchoCards({
      mindRoot: root,
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
    });
    const stored = readEchoCardsState(root).cards.filter((card) => card.kind === 'agreement');

    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(first.cards.find((card) => card.kind === 'agreement')?.id);
  });

  it('keeps the same id when the same correction is detected again', () => {
    const root = getTestMindRoot();
    const first = generateEchoCards({
      mindRoot: root, segment: 'promotion', sessions: repeatedCorrection(), trigger: 'manual', locale: 'zh', now,
    });
    const second = generateEchoCards({
      mindRoot: root,
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now: new Date(now.getTime() + 60_000),
    });

    const idOf = (result: typeof first) => result.cards.find((card) => card.kind === 'agreement')?.id;
    expect(idOf(second)).toBe(idOf(first));
    expect(readEchoCardsState(root).cards.filter((card) => card.kind === 'agreement')).toHaveLength(1);
  });

  it('produces no agreement when nothing was repeated across sessions', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: [correctionSession('solo', 5, '不要使用 any 类型')],
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    expect(result.cards.some((card) => card.kind === 'agreement')).toBe(false);
  });

  it('does not add agreements to the insight segment', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'insight',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    expect(result.cards.some((card) => card.kind === 'agreement')).toBe(false);
  });

  it('still detects agreements when a model produced the other promotion cards', async () => {
    const runner: AiTaskRunnerLike = {
      run: async () => ({
        taskId: 'echo-card-extract',
        promptVersion: 'test',
        output: {
          cards: [{
            kind: 'playbook' as const,
            title: 'Model playbook',
            content: 'Model generated playbook.',
            source: { sessions: [{ sessionId: 'agreement-a', messageRefs: [{ messageIndex: 1, role: 'user' }] }] },
            confidence: 0.8,
            tags: [],
          }],
        },
      }),
    } as unknown as AiTaskRunnerLike;

    const result = await generateEchoCardsWithAi({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: repeatedCorrection(),
      trigger: 'manual',
      locale: 'zh',
      now,
      aiTaskRunner: runner,
    });

    expect(result.cards.some((card) => card.kind === 'agreement')).toBe(true);
    expect(result.cards.some((card) => card.kind === 'playbook')).toBe(true);
  });

  it('writes an English source label when the output locale is English', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: [
        correctionSession('en-a', 30, "Don't use the any type here, widen it properly."),
        correctionSession('en-b', 10, 'I said again: do not use any type in this package.'),
      ],
      trigger: 'manual',
      locale: 'en',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    expect(agreement?.source.label).toMatch(/You said this \d+ times across \d+ sessions/);
  });
});

describe('agreement provenance reflects how the rule was detected', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');

  function session(id: string, minutesAgo: number, text: string) {
    return {
      id,
      title: `${id} session`,
      createdAt: now.getTime() - (minutesAgo + 20) * 60_000,
      updatedAt: now.getTime() - minutesAgo * 60_000,
      defaultAgentRuntime: { name: 'Claude Code' },
      messages: [
        { role: 'assistant', content: 'Patch is ready.' },
        { role: 'user', content: text },
      ],
    };
  }

  it('labels a single explicit directive as a standing rule, not as a repeat', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: [session('d1', 10, '以后都用中文回复我，代码注释保持英文。')],
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    expect(agreement?.source.label).toBe('你明确说过这是长期规则');
    expect(agreement?.confidence).toBeGreaterThan(0.85);
  });

  it('still counts occurrences for the repetition path', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: [
        session('r1', 30, '说了多少次，不要使用 any 类型。'),
        session('r2', 10, '别用 any 类型，补上去。'),
      ],
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    expect(agreement?.source.label).toBe('你在 2 次对话里说过 2 次');
  });

  it('uses English provenance for a directive when the locale is English', () => {
    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: [session('d2', 10, 'From now on, always run the tests before committing.')],
      trigger: 'manual',
      locale: 'en',
      now,
    });

    const agreement = result.cards.find((card) => card.kind === 'agreement');
    expect(agreement?.source.label).toBe('You stated this as a standing rule');
  });

  it('ignores a batch script that opens many sessions with the same prompt', () => {
    const batch = Array.from({ length: 8 }, (_, i) => session(
      `batch${i}`,
      i,
      '你是金融query质量评审员。只输出严格JSON，不要输出其他文字。',
    ));

    const result = generateEchoCards({
      mindRoot: getTestMindRoot(),
      segment: 'promotion',
      sessions: batch,
      trigger: 'manual',
      locale: 'zh',
      now,
    });

    expect(result.cards.some((card) => card.kind === 'agreement')).toBe(false);
  });
});


describe('approving an agreement card', () => {
  const now = new Date('2026-11-09T12:00:00.000Z');

  function directiveSession(id: string) {
    return {
      id,
      title: `${id} session`,
      updatedAt: now.getTime(),
      defaultAgentRuntime: { name: 'Codex' },
      messages: [
        { role: 'assistant', content: 'Done.' },
        { role: 'user', content: '以后都用 pnpm，不要用 npm。' },
      ],
    };
  }

  it('promotes an agreement instead of refusing it as the wrong kind', () => {
    // The promotion guard listed only playbook and practice, so agreements
    // could be generated and shown but never approved — from the UI or the CLI.
    const root = getTestMindRoot();
    const generated = generateEchoCards({
      mindRoot: root, segment: 'promotion', sessions: [directiveSession('a1')],
      trigger: 'manual', locale: 'zh', now,
    });
    const agreement = generated.cards.find((card) => card.kind === 'agreement');
    expect(agreement).toBeDefined();

    const result = reviewEchoPromotionCard(root, agreement!.id, 'approve');

    expect(result?.review.decision).toBe('approved');
    expect(result?.review.targetPath).toBe('.mindos/user-preferences.md');
  });

  it('normalizes an out-of-segment kind on read, so review never sees one', async () => {
    // Why the kind guard in reviewEchoPromotionCard cannot fire: reading state
    // coerces any kind that does not belong to the segment into that segment's
    // default, so a stored card is always promotable by the time review runs.
    // Worth locking because it is the reason the guard looks dead.
    const root = getTestMindRoot();
    generateEchoCards({
      mindRoot: root, segment: 'promotion', sessions: [directiveSession('a2')],
      trigger: 'manual', locale: 'zh', now,
    });
    const { writeEchoCardsState } = await import('@/lib/echo-card-generator');
    const state = readEchoCardsState(root);
    const card = state.cards.find((item) => item.kind === 'agreement')!;
    card.kind = 'moment' as typeof card.kind;
    writeEchoCardsState(root, state);

    const stored = readEchoCardsState(root).cards.find((item) => item.id === card.id);
    expect(stored?.kind).toBe('playbook');
    expect(reviewEchoPromotionCard(root, card.id, 'approve')?.review.decision).toBe('approved');
  });
});
