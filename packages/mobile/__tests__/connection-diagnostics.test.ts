import { describe, expect, it } from 'vitest';
import {
  formatConnectionDiagnostic,
  formatLastCheckedAt,
} from '@/lib/connection-diagnostics';

describe('connection diagnostics', () => {
  it('formats auth failures as short actionable copy', () => {
    expect(formatConnectionDiagnostic({ reason: 'auth_required' })).toEqual({
      title: 'Token needed',
      message: 'Copy the API token from MindOS on your computer and try again.',
      actionLabel: 'Update token',
      tone: 'error',
    });
  });

  it('compacts long technical API errors', () => {
    const formatted = formatConnectionDiagnostic({
      reason: 'api_unavailable',
      message: 'x'.repeat(200),
    });

    expect(formatted.title).toBe('API unavailable');
    expect(formatted.message).toHaveLength(140);
    expect(formatted.message.endsWith('...')).toBe(true);
  });

  it('formats last checked timestamps without detailed clock noise', () => {
    const now = Date.UTC(2026, 5, 15, 10, 0, 0);

    expect(formatLastCheckedAt(undefined, now)).toBe('Not checked yet');
    expect(formatLastCheckedAt(now - 5_000, now)).toBe('Just now');
    expect(formatLastCheckedAt(now - 45_000, now)).toBe('45s ago');
    expect(formatLastCheckedAt(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatLastCheckedAt(now - 2 * 60 * 60_000, now)).toBe('2h ago');
  });
});
