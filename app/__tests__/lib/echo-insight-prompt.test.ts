import { describe, expect, it } from 'vitest';
import { buildEchoInsightUserPrompt } from '@/lib/echo-insight-prompt';

describe('buildEchoInsightUserPrompt', () => {
  it('includes section title and snapshot lines', () => {
    const s = buildEchoInsightUserPrompt({
      locale: 'en',
      segment: 'about-you',
      segmentTitle: 'Tied to you',
      factsHeading: 'Snapshot',
      emptyTitle: 'Nothing yet',
      emptyBody: 'Clues will appear.',
      continuedDrafts: 'Drafts',
      continuedTodos: 'Todos',
      subEmptyHint: 'Empty',
      dailyLineLabel: 'Today',
      dailyLine: '',
      growthIntentLabel: 'Intent',
      growthIntent: '',
    });
    expect(s).toContain('Tied to you');
    expect(s).toContain('Snapshot');
    expect(s).toContain('Nothing yet');
    expect(s).toContain('Clues will appear.');
    expect(s).toMatch(/English/);
  });

  it('appends daily line when segment is daily and line non-empty', () => {
    const s = buildEchoInsightUserPrompt({
      locale: 'zh',
      segment: 'daily',
      segmentTitle: '每日',
      factsHeading: '所见',
      emptyTitle: '空',
      emptyBody: '说明',
      continuedDrafts: '草稿',
      continuedTodos: '待办',
      subEmptyHint: '无',
      dailyLineLabel: '今日一行',
      dailyLine: '  hello  ',
      growthIntentLabel: '意图',
      growthIntent: '',
    });
    expect(s).toContain('今日一行: hello');
    expect(s).toMatch(/Chinese/);
  });
});
