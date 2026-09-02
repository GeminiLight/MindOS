import { describe, expect, it } from 'vitest';
import { nextAutomationRunAt } from './schedule.js';

describe('Studio automation schedule calculation', () => {
  it('calculates recurring runs in the requested timezone', () => {
    expect(nextAutomationRunAt(
      'daily-0900',
      new Date('2026-09-02T00:00:00.000Z'),
      'Asia/Shanghai',
    )).toBe('2026-09-02T01:00:00.000Z');
  });

  it('skips weekends for weekday schedules', () => {
    expect(nextAutomationRunAt(
      'weekdays-0900',
      new Date('2026-09-04T02:00:00.000Z'),
      'Asia/Shanghai',
    )).toBe('2026-09-07T01:00:00.000Z');
  });

  it('finds the last calendar day across month lengths', () => {
    expect(nextAutomationRunAt(
      'monthly-last-1700',
      new Date('2028-02-28T10:00:00.000Z'),
      'Asia/Shanghai',
    )).toBe('2028-02-29T09:00:00.000Z');
  });

  it('keeps local wall-clock time when daylight saving time changes', () => {
    expect(nextAutomationRunAt(
      'daily-0900',
      new Date('2026-03-07T14:30:00.000Z'),
      'America/New_York',
    )).toBe('2026-03-08T13:00:00.000Z');
  });

  it('returns no next run for manual schedules and rejects invalid timezones', () => {
    expect(nextAutomationRunAt('manual', new Date(), 'Asia/Shanghai')).toBeUndefined();
    expect(() => nextAutomationRunAt('daily-0900', new Date(), 'Mars/Olympus_Mons')).toThrow(/invalid automation timezone/i);
  });
});
