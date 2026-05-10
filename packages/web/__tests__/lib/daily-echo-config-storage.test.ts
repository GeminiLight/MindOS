/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DAILY_ECHO_CONFIG } from '@/lib/daily-echo/types';
import { loadDailyEchoConfig, normalizeDailyEchoConfig, saveDailyEchoConfig } from '@/lib/daily-echo/config';

const CONFIG_KEY = 'mindos-daily-echo-config';

describe('Daily Echo config storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults for corrupted JSON', () => {
    localStorage.setItem(CONFIG_KEY, '{bad json');

    expect(loadDailyEchoConfig()).toEqual(DEFAULT_DAILY_ECHO_CONFIG);
  });

  it('normalizes invalid field types instead of merging them into runtime config', () => {
    const config = normalizeDailyEchoConfig({
      enabled: 'yes',
      scheduleTime: '99:99',
      timezone: 'Europe/London',
      language: 'fr',
      includeChat: false,
      includeTrendAnalysis: 'true',
      maxReportLength: 'huge',
    });

    expect(config).toEqual({
      ...DEFAULT_DAILY_ECHO_CONFIG,
      timezone: 'Europe/London',
      includeChat: false,
    });
  });

  it('loads valid stored overrides', () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      enabled: true,
      scheduleTime: '09:30',
      timezone: 'UTC',
      language: 'en',
      includeChat: false,
      includeTrendAnalysis: false,
      maxReportLength: 'short',
    }));

    expect(loadDailyEchoConfig()).toEqual({
      enabled: true,
      scheduleTime: '09:30',
      timezone: 'UTC',
      language: 'en',
      includeChat: false,
      includeTrendAnalysis: false,
      maxReportLength: 'short',
    });
  });

  it('normalizes before saving', () => {
    saveDailyEchoConfig({
      ...DEFAULT_DAILY_ECHO_CONFIG,
      scheduleTime: '21:15',
      language: 'en',
      maxReportLength: 'long',
    });

    expect(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}')).toEqual({
      ...DEFAULT_DAILY_ECHO_CONFIG,
      scheduleTime: '21:15',
      language: 'en',
      maxReportLength: 'long',
    });
  });
});
