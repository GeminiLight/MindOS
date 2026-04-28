import { describe, expect, it } from 'vitest';
import { getSearchWarmHint, shouldStartSearchPrewarm } from '@/components/panels/SearchPanel';

describe('SearchPanel prewarm helpers', () => {
  it('starts prewarm only when panel is active and no attempt happened yet', () => {
    expect(shouldStartSearchPrewarm({ active: true, hasAttemptedPrewarm: false, warmState: 'idle' })).toBe(true);
    expect(shouldStartSearchPrewarm({ active: false, hasAttemptedPrewarm: false, warmState: 'idle' })).toBe(false);
    expect(shouldStartSearchPrewarm({ active: true, hasAttemptedPrewarm: true, warmState: 'idle' })).toBe(false);
    expect(shouldStartSearchPrewarm({ active: true, hasAttemptedPrewarm: false, warmState: 'warming' })).toBe(false);
  });

  it('shows a warming hint only while query is empty', () => {
    expect(getSearchWarmHint('warming', '')).toBe('Preparing search...');
    expect(getSearchWarmHint('fallback', '')).toBe('Search will prepare on first query.');
    expect(getSearchWarmHint('ready', '')).toBeNull();
    expect(getSearchWarmHint('warming', 'mindos')).toBeNull();
  });

  it('supports localized warming hints', () => {
    expect(getSearchWarmHint('warming', '', {
      preparing: '正在准备搜索...',
      fallbackWarmHint: '搜索将在首次查询时完成准备。',
    })).toBe('正在准备搜索...');
  });
});
