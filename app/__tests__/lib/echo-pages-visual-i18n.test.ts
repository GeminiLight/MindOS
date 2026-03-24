import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n-en';
import { zh } from '@/lib/i18n-zh';

/** Visual polish strings; en/zh must stay in sync (see spec-echo-visual-polish.md). */
const VISUAL_KEYS = ['heroKicker', 'snapshotBadge'] as const;

describe('echoPages visual polish i18n', () => {
  it('en defines all visual keys', () => {
    const p = en.echoPages;
    for (const k of VISUAL_KEYS) {
      expect((p as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });

  it('zh mirrors all visual keys', () => {
    const p = zh.echoPages;
    for (const k of VISUAL_KEYS) {
      expect((p as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });

  it('snapshotBadge is short label (boundary: not empty, not paragraph)', () => {
    expect(en.echoPages.snapshotBadge.length).toBeGreaterThan(0);
    expect(en.echoPages.snapshotBadge.length).toBeLessThan(80);
  });
});
