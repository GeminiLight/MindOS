import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n';
import { zh } from '@/lib/i18n';

/** Visual polish strings; en/zh must stay in sync. */
const VISUAL_KEYS = [
  'segmentNavAria',
  'generateInsightNoAi',
  'insightGenerating',
  'insightErrorPrefix',
  'insightRetry',
  'imprintChatLabel',
  'growthChatLabel',
  'selfChatLabel',
] as const;

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
});
