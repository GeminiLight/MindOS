import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { getTestMindRoot } from '../setup';
import {
  deleteImprintCard,
  generateImprints,
  generateImprintsWithAi,
  getImprintScheduleStatus,
  readImprintGenerationState,
  updateImprintSchedule,
  updateImprintCard,
} from '@/lib/echo-imprint-generator';

describe('echo imprint generator', () => {
  const baseTime = new Date('2026-06-29T12:00:00.000Z');

  function session(overrides: Record<string, unknown> = {}) {
    return {
      id: 's-1',
      title: 'Imprint backend design',
      createdAt: baseTime.getTime() - 30 * 60_000,
      updatedAt: baseTime.getTime() - 5 * 60_000,
      messages: [
        { role: 'user', content: '我们需要实现 Imprint Generator 后端，支持 checkpoint 和 next step' },
        { role: 'assistant', content: '可以先实现 source window、结构化卡片和 soft delete。' },
      ],
      ...overrides,
    };
  }

  it('generates structured cards from sessions since the checkpoint and persists state', () => {
    const root = getTestMindRoot();
    const result = generateImprints({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      now: baseTime,
    });

    expect(result.sourceWindow.sessionCount).toBe(1);
    expect(result.state.checkpointAt).toBe(baseTime.toISOString());
    expect(result.cards.some((card) => card.type === 'event')).toBe(true);
    expect(result.cards.some((card) => card.type === 'next')).toBe(true);
    expect(result.cards[0]).toMatchObject({
      status: 'active',
      sourceSessionIds: ['s-1'],
    });

    const statePath = path.join(root, '.mindos', 'echo', 'imprints', 'state.json');
    expect(fs.existsSync(statePath)).toBe(true);
    const persisted = readImprintGenerationState(root);
    expect(persisted.schedule).toMatchObject({ mode: 'daily', dailyTime: '20:00' });
    expect(persisted.runCount).toBe(1);
    expect(persisted.cards.length).toBeGreaterThan(0);
  });

  it('persists a configurable generation schedule and derives the fallback source window', () => {
    const root = getTestMindRoot();

    const intervalState = updateImprintSchedule(root, {
      mode: 'interval',
      intervalHours: 6,
      dailyTime: '21:30',
    });

    expect(intervalState.schedule).toEqual({
      mode: 'interval',
      intervalHours: 6,
      dailyTime: '21:30',
    });
    expect(intervalState.windowMinutes).toBe(360);
    expect(readImprintGenerationState(root).schedule).toMatchObject({ mode: 'interval', intervalHours: 6 });

    const manualState = updateImprintSchedule(root, { mode: 'manual', intervalHours: 100, dailyTime: 'bad' });
    expect(manualState.schedule).toEqual({
      mode: 'manual',
      intervalHours: 24,
      dailyTime: '21:30',
    });
  });

  it('computes daily and interval schedule due states from the last generation time', () => {
    const now = new Date(2026, 5, 29, 21, 0, 0);
    const beforeTodayRun = new Date(2026, 5, 29, 19, 0, 0).toISOString();
    const afterTodayRun = new Date(2026, 5, 29, 20, 30, 0).toISOString();

    expect(getImprintScheduleStatus({
      schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
      lastGeneratedAt: beforeTodayRun,
    }, now)).toMatchObject({ mode: 'daily', due: true });

    expect(getImprintScheduleStatus({
      schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
      lastGeneratedAt: afterTodayRun,
    }, now)).toMatchObject({ mode: 'daily', due: false });

    expect(getImprintScheduleStatus({
      schedule: { mode: 'interval', dailyTime: '20:00', intervalHours: 6 },
      lastGeneratedAt: new Date(now.getTime() - 7 * 60 * 60_000).toISOString(),
    }, now)).toMatchObject({ mode: 'interval', due: true });
  });

  it('does not resurrect a user-deleted generated card', () => {
    const root = getTestMindRoot();
    const first = generateImprints({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      now: baseTime,
    });
    const deletedId = first.cards.find((card) => card.type === 'event')?.id;
    expect(deletedId).toBeTruthy();

    deleteImprintCard(root, deletedId!, baseTime);
    const second = generateImprints({
      mindRoot: root,
      sessions: [session({ updatedAt: baseTime.getTime() + 1 })],
      trigger: 'manual',
      now: new Date(baseTime.getTime() + 60_000),
    });

    expect(second.cards.some((card) => card.id === deletedId)).toBe(false);
    const persisted = readImprintGenerationState(root);
    expect(persisted.cards.find((card) => card.id === deletedId)?.status).toBe('deleted');
  });

  it('preserves user-edited card summaries across regeneration', () => {
    const root = getTestMindRoot();
    const first = generateImprints({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      now: baseTime,
    });
    const target = first.cards[0];

    updateImprintCard(root, target.id, { summary: '用户改过的摘要' }, baseTime);
    const second = generateImprints({
      mindRoot: root,
      sessions: [session({ updatedAt: baseTime.getTime() + 1 })],
      trigger: 'manual',
      now: new Date(baseTime.getTime() + 60_000),
    });

    expect(second.cards.find((card) => card.id === target.id)?.summary).toBe('用户改过的摘要');
    expect(readImprintGenerationState(root).cards.find((card) => card.id === target.id)?.userEdited).toBe(true);
  });

  it('uses a structured AI task runner when available', async () => {
    const root = getTestMindRoot();
    const run = vi.fn(async () => ({
      taskId: 'echo.imprint.extract',
      promptVersion: 'echo-imprint-extract-v1',
      modelProfile: 'fast-structured' as const,
      mode: 'structured' as const,
      model: { provider: 'test', name: 'test-model' },
      trace: {
        startedAt: baseTime.toISOString(),
        completedAt: baseTime.toISOString(),
        inputHash: 'input',
        outputHash: 'output',
      },
      output: {
        cards: [
          {
            type: 'event' as const,
            title: 'Backend generator became an AI task',
            summary: 'The imprint generator now calls a structured AI task before merging cards.',
            source: {
              sessionIds: ['s-1'],
              messageRefs: [
                {
                  sessionId: 's-1',
                  messageIndex: 0,
                  role: 'user',
                  quote: '我们需要实现 Imprint Generator 后端',
                },
              ],
            },
            whyItMatters: 'This proves the LM path is isolated from state writes.',
            route: 'insight' as const,
            confidence: 0.86,
            agencyTags: ['implementation_result'],
          },
        ],
        rejected: [],
      },
    }));

    const result = await generateImprintsWithAi({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      now: baseTime,
      aiTaskRunner: { run },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.extraction).toMatchObject({
      mode: 'lm',
      taskId: 'echo.imprint.extract',
      promptVersion: 'echo-imprint-extract-v1',
    });
    expect(result.cards[0]).toMatchObject({
      type: 'event',
      generationMethod: 'lm',
      promptVersion: 'echo-imprint-extract-v1',
      sourceSessionIds: ['s-1'],
      sourceMessageRefs: [
        expect.objectContaining({ sessionId: 's-1', messageIndex: 0, role: 'user' }),
      ],
    });
    expect(readImprintGenerationState(root).lastGenerationMode).toBe('lm');
  });

  it('falls back to deterministic cards when the AI task fails', async () => {
    const root = getTestMindRoot();
    const result = await generateImprintsWithAi({
      mindRoot: root,
      sessions: [session()],
      trigger: 'auto',
      now: baseTime,
      aiTaskRunner: {
        run: vi.fn(async () => {
          throw new Error('model unavailable');
        }),
      },
    });

    expect(result.extraction).toMatchObject({
      mode: 'deterministic',
      taskId: 'echo.imprint.extract',
    });
    expect(result.extraction.error).toContain('model unavailable');
    expect(result.cards.some((card) => card.generationMethod === 'deterministic')).toBe(true);
    expect(readImprintGenerationState(root)).toMatchObject({
      lastGenerationMode: 'deterministic',
      lastGenerationError: expect.stringContaining('model unavailable'),
    });
  });
});
