import { NextRequest } from 'next/server';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { listContextAssets } from '@geminilight/mindos/knowledge';
import { testMindRoot } from '../setup';
import { DELETE, GET, PATCH, POST } from '../../app/api/echo/cards/route';

const agentSessionsMock = vi.hoisted(() => vi.fn());

vi.mock('@geminilight/mindos/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/server')>();
  return {
    ...actual,
    handleAgentSessionsGet: agentSessionsMock,
  };
});

describe('/api/echo/cards', () => {
  function getRequest(segment: string) {
    return new NextRequest(`http://localhost/api/echo/cards?segment=${encodeURIComponent(segment)}`);
  }

  function bodyRequest(body: Record<string, unknown>, method = 'POST') {
    return new NextRequest('http://localhost/api/echo/cards', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('uses data segments rather than page route aliases', async () => {
    const insightRes = GET(getRequest('insight'));
    const insight = await insightRes.json();
    expect(insightRes.status, JSON.stringify(insight)).toBe(200);
    expect(insight.state).toMatchObject({ segment: 'insight', schemaVersion: 1 });

    const growthRes = GET(getRequest('growth'));
    expect(growthRes.status).toBe(400);

    const practiceRes = await POST(bodyRequest({ segment: 'practice', trigger: 'manual' }));
    expect(practiceRes.status).toBe(400);
  });

  it('generates, edits, and soft-deletes source-backed promotion cards', async () => {
    const now = Date.now();
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [
        {
          id: 'promotion-api-session',
          title: 'Promotion source session',
          createdAt: now - 30 * 60_000,
          updatedAt: now - 5 * 60_000,
          runtimeSessionBinding: { runtime: 'Codex' },
          messages: [
            { role: 'user', content: 'Agent 做了探索后，应该沉淀成 Playbook 和 Practice。' },
            { role: 'assistant', content: '把可复用方法放进 Promotion，source 由 session refs 支持。' },
          ],
        },
      ],
    });

    const generatedRes = await POST(bodyRequest({ segment: 'promotion', trigger: 'manual', locale: 'zh' }));
    const generated = await generatedRes.json();
    expect(generatedRes.status, JSON.stringify(generated)).toBe(200);
    expect(generated.state).toMatchObject({ segment: 'promotion', lastTrigger: 'manual', runCount: 1 });
    expect(generated.cards.length).toBeGreaterThan(0);
    expect(generated.cards[0]).toMatchObject({
      segment: 'promotion',
      kind: 'playbook',
      generation: { trigger: 'manual', locale: 'zh' },
      source: {
        sessions: [
          expect.objectContaining({
            id: 'promotion-api-session',
            runtime: 'Codex',
            messageRefs: [
              expect.objectContaining({ messageIndex: expect.any(Number), role: expect.any(String) }),
            ],
          }),
        ],
      },
    });
    expect(generated.cards[0]).not.toHaveProperty('evidence');
    expect(generated.cards[0]).not.toHaveProperty('whyItMatters');
    expect(generated.cards[0]).not.toHaveProperty('route');
    const targetId = generated.cards[0].id;

    const editedRes = await PATCH(bodyRequest({
      segment: 'promotion',
      id: targetId,
      content: '可复用的 Promotion 正文',
    }, 'PATCH'));
    const edited = await editedRes.json();
    expect(editedRes.status, JSON.stringify(edited)).toBe(200);
    expect(edited.card).toMatchObject({ id: targetId, content: '可复用的 Promotion 正文', userEdited: true });

    const deletedRes = await DELETE(bodyRequest({ segment: 'promotion', id: targetId }, 'DELETE'));
    const deleted = await deletedRes.json();
    expect(deletedRes.status, JSON.stringify(deleted)).toBe(200);
    expect(deleted.cards.some((card: { id: string }) => card.id === targetId)).toBe(false);
  });

  it('persists schedules independently for insight and promotion', async () => {
    const insightScheduleRes = await PATCH(bodyRequest({
      segment: 'insight',
      schedule: {
        mode: 'interval',
        dailyTime: '09:15',
        intervalHours: 6,
      },
    }, 'PATCH'));
    const insightSchedule = await insightScheduleRes.json();
    expect(insightScheduleRes.status, JSON.stringify(insightSchedule)).toBe(200);
    expect(insightSchedule.state).toMatchObject({
      segment: 'insight',
      schedule: { mode: 'interval', dailyTime: '09:15', intervalHours: 6 },
    });

    const promotionRes = GET(getRequest('promotion'));
    const promotion = await promotionRes.json();
    expect(promotionRes.status, JSON.stringify(promotion)).toBe(200);
    expect(promotion.state).toMatchObject({
      segment: 'promotion',
      schedule: { mode: 'daily', dailyTime: '20:00', intervalHours: 24 },
    });
  });

  it('approves a promotion card into a durable reviewed context asset', async () => {
    const now = Date.now();
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [{
        id: 'promotion-review-session',
        title: 'Review source session',
        createdAt: now - 30 * 60_000,
        updatedAt: now - 5 * 60_000,
        messages: [
          { role: 'user', content: '经验进入长期记忆前必须审核。' },
          { role: 'assistant', content: 'Only reviewed promotion candidates should become durable context.' },
        ],
      }],
    });

    const generatedRes = await POST(bodyRequest({ segment: 'promotion', trigger: 'manual', locale: 'zh' }));
    const generated = await generatedRes.json();
    const targetId = generated.cards[0].id as string;
    const editedContent = '经人工校订：只有审核通过的候选经验才能进入长期上下文。';
    const editedRes = await PATCH(bodyRequest({
      segment: 'promotion',
      id: targetId,
      content: editedContent,
    }, 'PATCH'));
    expect(editedRes.status).toBe(200);
    const approvedRes = await PATCH(bodyRequest({
      segment: 'promotion',
      id: targetId,
      action: 'approve',
    }, 'PATCH'));
    const approved = await approvedRes.json();

    expect(approvedRes.status, JSON.stringify(approved)).toBe(200);
    expect(approved.review).toMatchObject({ cardId: targetId, decision: 'approved' });
    expect(approved.card).toMatchObject({
      id: targetId,
      review: {
        status: 'approved',
        assetId: approved.review.assetId,
        targetPath: approved.review.targetPath,
      },
    });
    expect(existsSync(join(testMindRoot, approved.review.targetPath))).toBe(true);
    expect(readFileSync(join(testMindRoot, approved.review.targetPath), 'utf-8')).toContain(editedContent);
    expect(listContextAssets(testMindRoot, { sourceRef: `echo-card:${targetId}` })).toEqual([
      expect.objectContaining({ id: approved.review.assetId, status: 'active' }),
    ]);

    const repeatedRes = await PATCH(bodyRequest({
      segment: 'promotion',
      id: targetId,
      action: 'approve',
    }, 'PATCH'));
    const repeated = await repeatedRes.json();
    expect(repeatedRes.status, JSON.stringify(repeated)).toBe(200);
    expect(repeated.review).toEqual(approved.review);

    const persistedRes = GET(getRequest('promotion'));
    const persisted = await persistedRes.json();
    expect(persisted.cards[0].review).toMatchObject({ status: 'approved', assetId: approved.review.assetId });

    const regeneratedRes = await POST(bodyRequest({ segment: 'promotion', trigger: 'manual', locale: 'zh' }));
    const regenerated = await regeneratedRes.json();
    expect(regeneratedRes.status, JSON.stringify(regenerated)).toBe(200);
    expect(regenerated.cards.find((card: { id: string }) => card.id === targetId)).toMatchObject({
      content: editedContent,
      userEdited: true,
      review: { status: 'approved', assetId: approved.review.assetId },
    });
  });

  it('records rejected promotion cards without publishing a durable note', async () => {
    const now = Date.now();
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [{
        id: 'promotion-reject-session',
        createdAt: now - 20 * 60_000,
        updatedAt: now - 2 * 60_000,
        messages: [{ role: 'assistant', content: 'A generated but overly generic practice.' }],
      }],
    });
    const generatedRes = await POST(bodyRequest({ segment: 'promotion', trigger: 'manual' }));
    const generated = await generatedRes.json();
    const targetId = generated.cards[0].id as string;

    const rejectedRes = await PATCH(bodyRequest({
      segment: 'promotion',
      id: targetId,
      action: 'reject',
      note: 'Too generic.',
    }, 'PATCH'));
    const rejected = await rejectedRes.json();

    expect(rejectedRes.status, JSON.stringify(rejected)).toBe(200);
    expect(rejected).toMatchObject({
      review: { cardId: targetId, decision: 'rejected', note: 'Too generic.' },
      card: { id: targetId, review: { status: 'rejected', note: 'Too generic.' } },
    });
    expect(listContextAssets(testMindRoot)).toEqual([]);
    expect(existsSync(join(testMindRoot, 'Echo'))).toBe(false);

    const wrongSegmentRes = await PATCH(bodyRequest({
      segment: 'insight',
      id: targetId,
      action: 'approve',
    }, 'PATCH'));
    expect(wrongSegmentRes.status).toBe(400);

    const regeneratedRes = await POST(bodyRequest({ segment: 'promotion', trigger: 'manual' }));
    const regenerated = await regeneratedRes.json();
    expect(regenerated.cards.find((card: { id: string }) => card.id === targetId)).toMatchObject({
      review: { status: 'rejected', note: 'Too generic.' },
    });
  });

  it('keeps auto generation incremental while manual generation can refresh recent history', async () => {
    const now = Date.now();
    const sourceSession = {
      id: 'insight-refresh-session',
      title: 'Insight refresh source',
      createdAt: now - 30 * 60_000,
      updatedAt: now - 5 * 60_000,
      messages: [
        { role: 'user', content: '用户点击刷新时，应该重新读取最近历史。' },
        { role: 'assistant', content: 'Manual refresh should reuse recent session history even after checkpoint.' },
      ],
    };
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [sourceSession],
    });

    const firstRes = await POST(bodyRequest({ segment: 'insight', trigger: 'manual', locale: 'zh' }));
    const first = await firstRes.json();
    expect(firstRes.status, JSON.stringify(first)).toBe(200);
    expect(first.sourceWindow).toMatchObject({ sessionCount: 1 });
    expect(first.state).toMatchObject({ runCount: 1, lastTrigger: 'manual' });

    const autoRes = await POST(bodyRequest({ segment: 'insight', trigger: 'auto', locale: 'zh' }));
    const auto = await autoRes.json();
    expect(autoRes.status, JSON.stringify(auto)).toBe(200);
    expect(auto).toMatchObject({ skipped: true });
    expect(auto.state).toMatchObject({ runCount: 1, lastTrigger: 'manual' });

    const manualRes = await POST(bodyRequest({ segment: 'insight', trigger: 'manual', locale: 'zh' }));
    const manual = await manualRes.json();
    expect(manualRes.status, JSON.stringify(manual)).toBe(200);
    expect(manual.sourceWindow).toMatchObject({ sessionCount: 1 });
    expect(manual.state).toMatchObject({ runCount: 2, lastTrigger: 'manual' });
    expect(manual.cards[0]).toMatchObject({
      source: {
        sessions: [
          expect.objectContaining({ id: 'insight-refresh-session' }),
        ],
      },
    });
  });
});
