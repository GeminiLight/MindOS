import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n';
import { zh } from '@/lib/i18n';

/** Visual polish strings; en/zh must stay in sync. */
const VISUAL_KEYS = [
  'segmentNavAria',
  'backToOverviewLabel',
  'backToOverviewAriaLabel',
  'generateInsightNoAi',
  'insightGenerating',
  'insightErrorPrefix',
  'insightRetry',
  'overviewChatLabel',
  'imprintChatLabel',
  'threadsChatLabel',
  'growthChatLabel',
  'overviewLead',
  'threadsLead',
  'overviewOpenImprint',
  'threadsListTitle',
  'growthSignalsTitle',
  'growthSaveLabel',
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
