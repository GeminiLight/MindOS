import { describe, expect, it } from 'vitest';
import { formatEchoCardTimestamp } from '@/components/echo/EchoSemanticCard';

describe('formatEchoCardTimestamp', () => {
  it('keeps time-only values compact', () => {
    expect(formatEchoCardTimestamp('14:36', new Date(2026, 5, 30, 10, 0))).toBe('14:36');
  });

  it('shows only the time for today', () => {
    const now = new Date(2026, 5, 30, 10, 0);
    const today = new Date(2026, 5, 30, 8, 5).toISOString();

    expect(formatEchoCardTimestamp(today, now)).toBe('08:05');
  });

  it('adds the date for earlier local days', () => {
    const now = new Date(2026, 5, 30, 10, 0);
    const yesterday = new Date(2026, 5, 29, 8, 5).toISOString();
    const lastYear = new Date(2025, 11, 31, 23, 5).toISOString();

    expect(formatEchoCardTimestamp(yesterday, now)).toBe('06/29 08:05');
    expect(formatEchoCardTimestamp(lastYear, now)).toBe('2025/12/31 23:05');
  });
});
