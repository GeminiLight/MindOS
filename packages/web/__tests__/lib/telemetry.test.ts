import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { telemetry } from '@/lib/telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    telemetry.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    delete process.env.MINDOS_TELEMETRY_ENDPOINT;
  });

  afterEach(() => {
    telemetry.reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.MINDOS_TELEMETRY_ENDPOINT;
  });

  it('records tracked events', () => {
    telemetry.track('search.api.request', { queryLen: 12, success: true });

    expect(telemetry.getEvents()).toEqual([
      {
        name: 'search.api.request',
        ts: new Date('2024-01-01T00:00:00.000Z').getTime(),
        props: { queryLen: 12, success: true },
      },
    ]);
  });

  it('records duration and merges timer props', () => {
    const stop = telemetry.startTimer('search.core.query', { queryLen: 5 });

    vi.advanceTimersByTime(25);
    stop({ resultCount: 2 });

    expect(telemetry.getEvents()).toEqual([
      {
        name: 'search.core.query',
        ts: new Date('2024-01-01T00:00:00.000Z').getTime(),
        durationMs: 25,
        props: { queryLen: 5, resultCount: 2 },
      },
    ]);
  });

  it('flushes pending events when endpoint is configured', async () => {
    process.env.MINDOS_TELEMETRY_ENDPOINT = 'https://example.com/telemetry';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    telemetry.track('search.index.rebuild', { fileCount: 3 });

    await expect(telemetry.flush()).resolves.toBe(1);
    await expect(telemetry.flush()).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/telemetry', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });
});
