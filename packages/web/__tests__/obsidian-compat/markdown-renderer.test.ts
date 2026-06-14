import { describe, expect, it } from 'vitest';
import { createObsidianElement } from '@/lib/obsidian-compat/shims/dom';
import { collectElementText, MarkdownRenderer } from '@/lib/obsidian-compat/shims/markdown-renderer';

describe('MarkdownRenderer shim', () => {
  it('renders markdown into safe Obsidian shim elements', async () => {
    const container = createObsidianElement('div');

    await MarkdownRenderer.renderMarkdown(
      '# Title\n\n- Item\n\n```ts\nconst value = 1;\n```',
      container,
      'notes/source.md',
    );

    expect(collectElementText(container)).toBe('Title\nItem\nconst value = 1;');
    expect(Array.from(container.children).map((child) => child.tagName)).toEqual(['H1', 'LI', 'PRE']);
  });

  it('supports the newer render(app, markdown, el, sourcePath, component) signature', async () => {
    const container = createObsidianElement('div');

    await MarkdownRenderer.render(null, '## Heading\nParagraph', container, 'notes/source.md', null);

    expect(collectElementText(container)).toBe('Heading\nParagraph');
  });

  it('falls back to text content for plain HTMLElement-like containers', async () => {
    const container = { textContent: '' } as HTMLElement;

    await MarkdownRenderer.renderMarkdown('# Title\n\nBody', container, 'notes/source.md');

    expect(container.textContent).toBe('Title\nBody');
  });
});
