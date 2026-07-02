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
      locale: 'zh',
      now: baseTime,
    });

    expect(result.sourceWindow.sessionCount).toBe(1);
    expect(result.state.checkpointAt).toBe(baseTime.toISOString());
    expect(result.cards[0]).toMatchObject({
      kind: 'moment',
      createdAt: new Date(baseTime.getTime() - 5 * 60_000).toISOString(),
      status: 'active',
      source: {
        label: '会话 · Imprint backend design',
        sessions: [
          expect.objectContaining({
            id: 's-1',
            title: 'Imprint backend design',
            messageRefs: [
              expect.objectContaining({ messageIndex: 1, role: 'assistant' }),
            ],
          }),
        ],
      },
    });
    expect(result.cards[0]).not.toHaveProperty('evidence');
    expect(result.cards[0]).not.toHaveProperty('type');

    const statePath = path.join(root, '.mindos', 'echo', 'cards.json');
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
    const deletedId = first.cards[0]?.id;
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

  it('preserves user-edited card content across regeneration', () => {
    const root = getTestMindRoot();
    const first = generateImprints({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      now: baseTime,
    });
    const target = first.cards[0];

    updateImprintCard(root, target.id, { content: '用户改过的正文' }, baseTime);
    const second = generateImprints({
      mindRoot: root,
      sessions: [session({ updatedAt: baseTime.getTime() + 1 })],
      trigger: 'manual',
      now: new Date(baseTime.getTime() + 60_000),
    });

    expect(second.cards.find((card) => card.id === target.id)?.content).toBe('用户改过的正文');
    expect(readImprintGenerationState(root).cards.find((card) => card.id === target.id)?.userEdited).toBe(true);
  });

  it('loads only cards with the nested source session structure', () => {
    const root = getTestMindRoot();
    const statePath = path.join(root, '.mindos', 'echo', 'cards.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      segments: {
        imprint: {
          runCount: 1,
          schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
          windowMinutes: 1440,
        },
        insight: {
          runCount: 0,
          schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
          windowMinutes: 1440,
        },
        promotion: {
          runCount: 0,
          schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
          windowMinutes: 1440,
        },
      },
      cards: [
        {
          id: 'flat-source-card',
          segment: 'imprint',
          kind: 'moment',
          title: 'No source card',
          content: '扁平 source 不再是合法结构。',
          createdAt: '12:00',
          source: {
            label: 'Flat source',
            sessionIds: ['legacy-session'],
          },
          confidence: 0.7,
          status: 'active',
          generatedAt: baseTime.toISOString(),
          updatedAt: baseTime.toISOString(),
          generation: { method: 'deterministic', trigger: 'manual', locale: 'zh' },
        },
        {
          id: 'new-content-card',
          segment: 'imprint',
          kind: 'digest',
          title: 'New card',
          content: '新结构只认 content 字段。',
          createdAt: '12:01',
          source: {
            label: 'Structured source',
            sessions: [
              {
                id: 's-1',
                title: 'Imprint backend design',
                runtime: 'Codex',
                createdAt: baseTime.getTime() - 30 * 60_000,
                updatedAt: baseTime.getTime() - 5 * 60_000,
                messageRefs: [
                  {
                    messageIndex: 0,
                    role: 'user',
                    quote: '我们需要实现 Imprint Generator 后端',
                  },
                ],
              },
            ],
          },
          confidence: 0.9,
          status: 'active',
          generatedAt: baseTime.toISOString(),
          updatedAt: baseTime.toISOString(),
          generation: { method: 'deterministic', trigger: 'manual', locale: 'zh' },
        },
      ],
    }));

    const state = readImprintGenerationState(root);
    expect(state.cards).toHaveLength(1);
    expect(state.cards.some((card) => card.id === 'flat-source-card')).toBe(false);
    expect(state.cards.find((card) => card.id === 'new-content-card')).toMatchObject({
      id: 'new-content-card',
      content: '新结构只认 content 字段。',
      source: {
        label: 'Structured source',
        sessions: [
          expect.objectContaining({
            id: 's-1',
            title: 'Imprint backend design',
            runtime: 'Codex',
            messageRefs: [
              expect.objectContaining({ messageIndex: 0, role: 'user' }),
            ],
          }),
        ],
      },
    });
    expect(state.cards.find((card) => card.id === 'new-content-card')).not.toHaveProperty('evidence');
  });

  it('uses a structured AI task runner when available', async () => {
    const root = getTestMindRoot();
    const run = vi.fn(async () => ({
      taskId: 'echo.cards.extract',
      promptVersion: 'echo-card-extract-v1',
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
            kind: 'moment' as const,
            title: 'Backend generator became an AI task',
            content: 'The imprint generator now calls a structured AI task before merging cards.',
            source: {
              sessions: [
                {
                  sessionId: 's-1',
                  messageRefs: [
                    {
                      messageIndex: 0,
                      role: 'user',
                      quote: '我们需要实现 Imprint Generator 后端',
                    },
                    {
                      messageIndex: 1,
                      role: 'assistant',
                      quote: '结构化卡片和 soft delete',
                    },
                  ],
                },
              ],
            },
            confidence: 0.86,
            tags: ['implementation_result'],
          },
        ],
        rejected: [],
      },
    }));

    const result = await generateImprintsWithAi({
      mindRoot: root,
      sessions: [session()],
      trigger: 'manual',
      locale: 'zh',
      now: baseTime,
      aiTaskRunner: { run },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toMatchObject({
      locale: 'zh',
    });
    expect(result.extraction).toMatchObject({
      mode: 'lm',
      taskId: 'echo.cards.extract',
      promptVersion: 'echo-card-extract-v1',
    });
    expect(result.cards[0]).toMatchObject({
      generation: {
        method: 'lm',
        taskId: 'echo.cards.extract',
        promptVersion: 'echo-card-extract-v1',
      },
      source: {
        sessions: [
          expect.objectContaining({
            id: 's-1',
            title: 'Imprint backend design',
            messageRefs: [
              expect.objectContaining({ messageIndex: 0, role: 'user' }),
              expect.objectContaining({ messageIndex: 1, role: 'assistant' }),
            ],
          }),
        ],
      },
    });
    expect(readImprintGenerationState(root).lastGenerationMode).toBe('lm');
  });

  it('falls back to deterministic cards when the AI task fails', async () => {
    const root = getTestMindRoot();
    const result = await generateImprintsWithAi({
      mindRoot: root,
      sessions: [session()],
      trigger: 'auto',
      locale: 'zh',
      now: baseTime,
      aiTaskRunner: {
        run: vi.fn(async () => {
          throw new Error('model unavailable');
        }),
      },
    });

    expect(result.extraction).toMatchObject({
      mode: 'deterministic',
      taskId: 'echo.cards.extract',
    });
    expect(result.extraction.error).toContain('model unavailable');
    expect(result.cards.some((card) => card.generation.method === 'deterministic')).toBe(true);
    expect(result.cards[0]).toMatchObject({
      source: {
        label: '会话 · Imprint backend design',
      },
      generation: {
        method: 'deterministic',
      },
    });
    expect(readImprintGenerationState(root)).toMatchObject({
      lastGenerationMode: 'deterministic',
      lastGenerationError: expect.stringContaining('model unavailable'),
    });
  });
});
