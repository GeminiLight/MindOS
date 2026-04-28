import { describe, expect, it } from 'vitest';
import { buildEchoInsightUserPrompt } from '@/lib/echo-insight-prompt';

describe('buildEchoInsightUserPrompt', () => {
  it('includes section title and snapshot lines', () => {
    const s = buildEchoInsightUserPrompt({
      locale: 'en',
      segment: 'self',
      segmentTitle: 'Insight',
      factsHeading: 'Snapshot',
      emptyTitle: 'Nothing yet',
      emptyBody: 'Clues will appear.',
      dailyLineLabel: 'Today',
      dailyLine: '',
      growthIntentLabel: 'Intent',
      growthIntent: '',
    });
    expect(s).toContain('Insight');
    expect(s).toContain('Snapshot');
    expect(s).toContain('Nothing yet');
    expect(s).toContain('Clues will appear.');
    expect(s).toMatch(/English/);
  });

  it('appends daily line when segment is imprint and line non-empty', () => {
    const s = buildEchoInsightUserPrompt({
      locale: 'zh',
      segment: 'imprint',
      segmentTitle: '印迹',
      factsHeading: '所见',
      emptyTitle: '空',
      emptyBody: '说明',
      dailyLineLabel: '今日一行',
      dailyLine: '  hello  ',
      growthIntentLabel: '意图',
      growthIntent: '',
    });
    expect(s).toContain('今日一行: hello');
    expect(s).toMatch(/Chinese/);
  });

  it('appends growth intent when segment is growth', () => {
    const s = buildEchoInsightUserPrompt({
      locale: 'en',
      segment: 'growth',
      segmentTitle: 'Growth',
      factsHeading: 'Snapshot',
      emptyTitle: 'Intent lives here',
      emptyBody: 'Write your direction.',
      dailyLineLabel: 'Today',
      dailyLine: '',
      growthIntentLabel: 'Intent',
      growthIntent: '  ship v1  ',
    });
    expect(s).toContain('Intent: ship v1');
  });
});
