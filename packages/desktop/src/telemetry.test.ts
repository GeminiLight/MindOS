import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopTelemetry } from './telemetry';

describe('desktopTelemetry', () => {
  beforeEach(() => {
    desktopTelemetry.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    delete process.env.MINDOS_TELEMETRY_ENDPOINT;
  });

  afterEach(() => {
    desktopTelemetry.reset();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.MINDOS_TELEMETRY_ENDPOINT;
  });

  it('records events with desktop metadata', () => {
    desktopTelemetry.track('desktop.boot.total', { success: true });

    const [event] = desktopTelemetry.getEvents();
    expect(event.name).toBe('desktop.boot.total');
    expect(event.props).toEqual({ success: true });
    expect(event.appVersion).toBeTruthy();
    expect(event.platform).toBe(process.platform);
    expect(event.arch).toBe(process.arch);
  });

  it('records durations for timers', () => {
    const stop = desktopTelemetry.startTimer('desktop.boot.health_check', { port: 3456 });

    vi.advanceTimersByTime(42);
    stop({ success: true });

    const [event] = desktopTelemetry.getEvents();
    expect(event.durationMs).toBe(42);
    expect(event.props).toEqual({ port: 3456, success: true });
  });

  it('flushes pending events when endpoint is configured', async () => {
    process.env.MINDOS_TELEMETRY_ENDPOINT = 'https://example.com/desktop-telemetry';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    desktopTelemetry.track('desktop.boot.heal', { skipped: false });

    await expect(desktopTelemetry.flush()).resolves.toBe(1);
    await expect(desktopTelemetry.flush()).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/desktop-telemetry', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });
});
