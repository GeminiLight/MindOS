import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
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
});
