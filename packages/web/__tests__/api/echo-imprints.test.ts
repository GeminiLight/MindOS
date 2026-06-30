import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, POST } from '../../app/api/echo/imprints/route';

const agentSessionsMock = vi.hoisted(() => vi.fn());

vi.mock('@geminilight/mindos/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@geminilight/mindos/server')>();
  return {
    ...actual,
    handleAgentSessionsGet: agentSessionsMock,
  };
});

describe('/api/echo/imprints', () => {
  function request(body: Record<string, unknown>, method = 'POST') {
    return new NextRequest('http://localhost/api/echo/imprints', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('generates, edits, and soft-deletes backend imprint cards', async () => {
    const now = Date.now();
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [
        {
          id: 'api-session-1',
          title: 'Backend generator discussion',
          createdAt: now - 20 * 60_000,
          updatedAt: now - 2 * 60_000,
          messages: [
            { role: 'user', content: '后端也需要实现 Imprint Generator，下一步支持 checkpoint' },
            { role: 'assistant', content: '先做 source window、cards state 和编辑删除 API。' },
          ],
        },
      ],
    });

    const generatedRes = await POST(request({ trigger: 'manual' }));
    const generated = await generatedRes.json();
    expect(generatedRes.status, JSON.stringify(generated)).toBe(200);
    expect(generated.state).toMatchObject({ lastTrigger: 'manual', runCount: 1, activeCount: expect.any(Number) });
    expect(generated.state.schedule).toMatchObject({ mode: 'daily', dailyTime: '20:00', due: false });
    expect(generated.cards.length).toBeGreaterThan(0);
    expect(generated.cards[0]).not.toHaveProperty('type');
    const targetId = generated.cards[0].id;

    const loadedRes = GET();
    const loaded = await loadedRes.json();
    expect(loadedRes.status, JSON.stringify(loaded)).toBe(200);
    expect(loaded.state).toMatchObject({ lastTrigger: 'manual', runCount: 1 });
    expect(loaded.cards.map((card: { id: string }) => card.id)).toContain(targetId);

    const editedRes = await PATCH(request({ id: targetId, summary: '用户确认后的摘要' }, 'PATCH'));
    const edited = await editedRes.json();
    expect(editedRes.status, JSON.stringify(edited)).toBe(200);
    expect(edited.card).toMatchObject({ id: targetId, summary: '用户确认后的摘要', userEdited: true });

    const deletedRes = await DELETE(request({ id: targetId }, 'DELETE'));
    const deleted = await deletedRes.json();
    expect(deletedRes.status, JSON.stringify(deleted)).toBe(200);
    expect(deleted.cards.some((card: { id: string }) => card.id === targetId)).toBe(false);
  });

  it('persists schedule settings and skips auto generation when not due', async () => {
    const now = Date.now();
    agentSessionsMock.mockReturnValue({
      status: 200,
      body: [
        {
          id: 'api-session-schedule',
          title: 'Scheduled generator discussion',
          createdAt: now - 20 * 60_000,
          updatedAt: now - 2 * 60_000,
          messages: [
            { role: 'user', content: 'Imprint 应该默认每天生成，也可以手动触发。' },
            { role: 'assistant', content: '后端保存 schedule，auto 未到点就跳过。' },
          ],
        },
      ],
    });

    const generatedRes = await POST(request({ trigger: 'manual' }));
    const generated = await generatedRes.json();
    expect(generatedRes.status, JSON.stringify(generated)).toBe(200);
    expect(generated.state.runCount).toBe(1);

    const scheduleRes = await PATCH(request({
      schedule: {
        mode: 'manual',
        dailyTime: '21:30',
        intervalHours: 6,
      },
    }, 'PATCH'));
    const scheduled = await scheduleRes.json();
    expect(scheduleRes.status, JSON.stringify(scheduled)).toBe(200);
    expect(scheduled.state.schedule).toMatchObject({
      mode: 'manual',
      dailyTime: '21:30',
      intervalHours: 6,
    });

    agentSessionsMock.mockClear();
    const skippedRes = await POST(request({ trigger: 'auto' }));
    const skipped = await skippedRes.json();
    expect(skippedRes.status, JSON.stringify(skipped)).toBe(200);
    expect(skipped).toMatchObject({ skipped: true });
    expect(skipped.state.runCount).toBe(1);
    expect(skipped.state.schedule).toMatchObject({ mode: 'manual' });
    expect(agentSessionsMock).not.toHaveBeenCalled();
  });

  it('returns persisted daily and interval schedule status from the API state', async () => {
    const dailyRes = await PATCH(request({
      schedule: {
        mode: 'daily',
        dailyTime: '08:45',
        intervalHours: 12,
      },
    }, 'PATCH'));
    const daily = await dailyRes.json();
    expect(dailyRes.status, JSON.stringify(daily)).toBe(200);
    expect(daily.state.schedule).toMatchObject({
      mode: 'daily',
      dailyTime: '08:45',
      intervalHours: 12,
    });
    expect(typeof daily.state.schedule.due).toBe('boolean');

    const intervalRes = await PATCH(request({
      schedule: {
        mode: 'interval',
        dailyTime: '08:45',
        intervalHours: 6,
      },
    }, 'PATCH'));
    const interval = await intervalRes.json();
    expect(intervalRes.status, JSON.stringify(interval)).toBe(200);
    expect(interval.state.schedule).toMatchObject({
      mode: 'interval',
      dailyTime: '08:45',
      intervalHours: 6,
    });

    const loadedRes = GET();
    const loaded = await loadedRes.json();
    expect(loadedRes.status, JSON.stringify(loaded)).toBe(200);
    expect(loaded.state.schedule).toMatchObject({
      mode: 'interval',
      dailyTime: '08:45',
      intervalHours: 6,
    });
  });

  it('validates required card ids for mutations', async () => {
    const editedRes = await PATCH(request({ summary: 'missing id' }, 'PATCH'));
    expect(editedRes.status).toBe(400);

    const deletedRes = await DELETE(request({}, 'DELETE'));
    expect(deletedRes.status).toBe(400);
  });
});
