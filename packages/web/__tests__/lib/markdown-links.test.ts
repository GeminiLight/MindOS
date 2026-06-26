import { describe, expect, it } from 'vitest';
import { isExternalMarkdownHref, resolveMarkdownInternalHref } from '@/lib/markdown-links';

describe('markdown internal link resolution', () => {
  it('resolves relative markdown links beside the current note', () => {
    expect(resolveMarkdownInternalHref('other.md', 'Notes/source.md')).toBe('/view/Notes/other.md');
    expect(resolveMarkdownInternalHref('./sub/next.md', 'Notes/source.md')).toBe('/view/Notes/sub/next.md');
    expect(resolveMarkdownInternalHref('../Shared/next.md', 'Notes/source.md')).toBe('/view/Shared/next.md');
  });

  it('resolves root-relative markdown links from the mind root', () => {
    expect(resolveMarkdownInternalHref('/Shared/next.md', 'Notes/source.md')).toBe('/view/Shared/next.md');
  });

  it('preserves query and hash suffixes on resolved markdown links', () => {
    expect(resolveMarkdownInternalHref('other.md?mode=preview#Section', 'Notes/source.md')).toBe('/view/Notes/other.md?mode=preview#Section');
  });

  it('decodes markdown href paths before emitting app view URLs', () => {
    expect(resolveMarkdownInternalHref('Other%20Note.md', 'Notes/source.md')).toBe('/view/Notes/Other%20Note.md');
  });

  it('leaves anchors, non-markdown links, app routes, and external URLs unchanged', () => {
    expect(resolveMarkdownInternalHref('#local', 'Notes/source.md')).toBe('#local');
    expect(resolveMarkdownInternalHref('image.png', 'Notes/source.md')).toBe('image.png');
    expect(resolveMarkdownInternalHref('/view/Notes/other.md', 'Notes/source.md')).toBe('/view/Notes/other.md');
    expect(resolveMarkdownInternalHref('https://example.com/other.md', 'Notes/source.md')).toBe('https://example.com/other.md');
    expect(resolveMarkdownInternalHref('mailto:hello@example.com', 'Notes/source.md')).toBe('mailto:hello@example.com');
  });

  it('rejects links that would traverse above the mind root', () => {
    expect(resolveMarkdownInternalHref('../outside.md', 'source.md')).toBe('../outside.md');
  });

  it('classifies external hrefs by URL scheme or protocol-relative form', () => {
    expect(isExternalMarkdownHref('https://example.com')).toBe(true);
    expect(isExternalMarkdownHref('mailto:hello@example.com')).toBe(true);
    expect(isExternalMarkdownHref('//example.com/path')).toBe(true);
    expect(isExternalMarkdownHref('/view/Notes/a.md')).toBe(false);
    expect(isExternalMarkdownHref('other.md')).toBe(false);
  });
});
