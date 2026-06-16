import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { highlightSearchSnippet } from '@/lib/search-highlight';

describe('highlightSearchSnippet', () => {
  it('highlights repeated matches without stateful regex drift', () => {
    const html = renderToStaticMarkup(<>{highlightSearchSnippet('alpha alpha beta alpha', 'alpha')}</>);

    expect((html.match(/<mark/g) ?? [])).toHaveLength(3);
    expect(html).toContain('alpha');
  });

  it('handles regex special characters literally', () => {
    const html = renderToStaticMarkup(<>{highlightSearchSnippet('Use foo.bar and foo?bar', 'foo.bar foo?bar')}</>);

    expect((html.match(/<mark/g) ?? [])).toHaveLength(2);
    expect(html).toContain('foo.bar');
    expect(html).toContain('foo?bar');
  });
});
