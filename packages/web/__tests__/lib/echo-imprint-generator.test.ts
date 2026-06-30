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
    expect(result.cards[0]).toMatchObject({
      kind: 'moment',
      createdAt: new Date(baseTime.getTime() - 5 * 60_000).toISOString(),
      status: 'active',
      source: {
        sessionIds: ['s-1'],
      },
    });
    expect(result.cards[0]).not.toHaveProperty('type');

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

  it('migrates legacy summary cards with provenance into structured source and evidence fields', () => {
    const root = getTestMindRoot();
    const statePath = path.join(root, '.mindos', 'echo', 'imprints', 'state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      runCount: 1,
      schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
      cards: [
        {
          id: 'old-summary-card',
          kind: 'moment',
          title: 'Old card',
          summary: '旧 summary 字段可以迁移为 content',
          createdAt: '12:00',
          source: '旧 source 字段迁移为来源',
          whyItMatters: '旧 whyItMatters 字段迁移为证据',
          sourceSessionIds: ['legacy-session'],
          sourceMessageRefs: [
            {
              sessionId: 'legacy-session',
              messageIndex: 1,
              role: 'assistant',
              quote: '旧卡片也应该保留可核对来源。',
            },
          ],
          confidence: 0.8,
          status: 'active',
          generatedAt: baseTime.toISOString(),
          updatedAt: baseTime.toISOString(),
        },
        {
          id: 'summary-without-source',
          kind: 'moment',
          title: 'No source card',
          summary: '没有 provenance 的旧草稿应该丢弃',
          createdAt: '12:00',
          source: '不可核对来源',
          confidence: 0.7,
          status: 'active',
          generatedAt: baseTime.toISOString(),
          updatedAt: baseTime.toISOString(),
        },
        {
          id: 'new-content-card',
          kind: 'digest',
          title: 'New card',
          content: '新结构只认 content 字段。',
          createdAt: '12:01',
          source: {
            label: 'Structured source',
            sessionIds: ['s-1'],
          },
          evidence: {
            label: 'Structured evidence',
          },
          confidence: 0.9,
          status: 'active',
          generatedAt: baseTime.toISOString(),
          updatedAt: baseTime.toISOString(),
        },
      ],
    }));

    const state = readImprintGenerationState(root);
    expect(state.cards).toHaveLength(2);
    expect(state.cards.find((card) => card.id === 'old-summary-card')).toMatchObject({
      id: 'old-summary-card',
      content: '旧 summary 字段可以迁移为 content',
      source: {
        label: '旧 source 字段迁移为来源',
        sessionIds: ['legacy-session'],
        messageRefs: [
          expect.objectContaining({
            sessionId: 'legacy-session',
            messageIndex: 1,
            role: 'assistant',
          }),
        ],
      },
      evidence: {
        label: '旧 whyItMatters 字段迁移为证据',
      },
    });
    expect(state.cards.some((card) => card.id === 'summary-without-source')).toBe(false);
    expect(state.cards.find((card) => card.id === 'new-content-card')).toMatchObject({
      id: 'new-content-card',
      content: '新结构只认 content 字段。',
      source: {
        label: 'Structured source',
        sessionIds: ['s-1'],
      },
      evidence: {
        label: 'Structured evidence',
      },
    });
  });

  it('uses a structured AI task runner when available', async () => {
    const root = getTestMindRoot();
    const run = vi.fn(async () => ({
      taskId: 'echo.imprint.extract',
      promptVersion: 'echo-imprint-extract-v2',
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
      promptVersion: 'echo-imprint-extract-v2',
    });
    expect(result.cards[0]).toMatchObject({
      generationMethod: 'lm',
      promptVersion: 'echo-imprint-extract-v2',
      source: {
        sessionIds: ['s-1'],
        messageRefs: [
          expect.objectContaining({ sessionId: 's-1', messageIndex: 0, role: 'user' }),
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
