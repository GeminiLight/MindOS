import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import ExploreContent from '@/components/explore/ExploreContent';
import { messages } from '@/lib/i18n';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const, setLocale: () => {}, t: messages.en }),
}));

describe('ExploreContent', () => {
  it('presents tasks as a readable list and explains the draft action before opening Ask', () => {
    const html = renderToStaticMarkup(<ExploreContent />);

    expect(html).toContain('Start with a task');
    expect(html).toContain('review before sending');
    expect(html).toContain('data-explore-task-list="true"');
    expect(html).toContain('Edit prompt');
    expect(html).not.toContain('data-explore-use-case-grid');
    expect(html).not.toContain('grid-cols-3');
  });

  it('keeps capability filtering behind an optional disclosure', () => {
    const html = renderToStaticMarkup(<ExploreContent />);

    expect(html).toContain('<details');
    expect(html).toContain('By Capability');
    expect(html).toContain('aria-pressed="true"');
  });
});
