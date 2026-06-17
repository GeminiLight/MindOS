import { describe, expect, it } from 'vitest';
import { filesTabHref, splitRoutePath, viewFileHref } from '@/lib/mobile-navigation';

describe('mobile-navigation', () => {
  it('splits nested file paths for Expo Router catch-all segments', () => {
    expect(splitRoutePath('Spaces/Product/spec.md')).toEqual(['Spaces', 'Product', 'spec.md']);
  });

  it('ignores accidental duplicate slashes without trimming valid segment text', () => {
    expect(splitRoutePath('/Inbox//draft note.md/')).toEqual(['Inbox', 'draft note.md']);
  });

  it('builds typed view href objects instead of string-concatenated routes', () => {
    expect(viewFileHref('Inbox/today.md')).toEqual({
      pathname: '/view/[...path]',
      params: { path: ['Inbox', 'today.md'] },
    });
  });

  it('exports the Files tab href used by empty states', () => {
    expect(filesTabHref).toBe('/(tabs)/files');
  });
});
