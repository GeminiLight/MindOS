/**
 * End-to-end check that the wiki link and callout transforms survive a real
 * markdown parse and produce the HTML the reading view relies on.
 *
 * The unit tests build mdast by hand; this one goes through remark's own parser
 * and react-markdown's rehype pipeline, which is where attribute handling and
 * node-splitting assumptions actually get tested.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import { VAULT_REMARK_PLUGINS } from '@/components/markdown/VaultMarkdown';

function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: VAULT_REMARK_PLUGINS }, markdown),
  );
}

describe('reading view markdown pipeline', () => {
  describe('wiki links', () => {
    it('renders a bare link as an anchor to the markdown file', () => {
      const html = render('see [[Target]] here');
      expect(html).toContain('<a href="Target.md"');
      expect(html).toContain('>Target</a>');
    });

    it('renders the alias as the visible text', () => {
      expect(render('[[Target|Display]]')).toContain('>Display</a>');
    });

    it('keeps the target in a data attribute', () => {
      expect(render('[[Target]]')).toContain('data-wikilink="Target"');
    });

    it('renders a heading subpath as a fragment', () => {
      expect(render('[[Target#Heading]]')).toContain('href="Target.md#Heading"');
    });

    it('renders an image embed as an img tag', () => {
      const html = render('![[diagram.png]]');
      expect(html).toContain('<img');
      expect(html).toContain('src="diagram.png"');
    });

    it('does not linkify inside a fenced code block', () => {
      const html = render('```\n[[Target]]\n```');
      expect(html).not.toContain('<a href="Target.md"');
      expect(html).toContain('[[Target]]');
    });

    it('does not linkify inside inline code', () => {
      const html = render('text `[[Target]]` more');
      expect(html).not.toContain('<a href="Target.md"');
    });

    it('linkifies inside list items and headings', () => {
      expect(render('- [[Target]]')).toContain('href="Target.md"');
      expect(render('## [[Target]]')).toContain('href="Target.md"');
    });

    it('leaves a normal markdown link alone', () => {
      expect(render('[label](other.md)')).toContain('<a href="other.md"');
    });
  });

  describe('callouts', () => {
    it('renders a callout blockquote with type and title', () => {
      const html = render('> [!note] Remember this\n> body text');
      expect(html).toContain('data-callout="note"');
      expect(html).toContain('class="callout"');
      expect(html).toContain('callout-title');
      expect(html).toContain('Remember this');
      expect(html).toContain('body text');
    });

    it('renders a title-only callout', () => {
      const html = render('> [!warning] Careful');
      expect(html).toContain('data-callout="warning"');
      expect(html).toContain('Careful');
    });

    it('records the fold marker', () => {
      expect(render('> [!tip]- Collapsed')).toContain('data-callout-fold="-"');
    });

    it('leaves an ordinary blockquote as a plain quote', () => {
      const html = render('> just a quote');
      expect(html).not.toContain('data-callout');
      expect(html).toContain('just a quote');
    });

    it('supports a wiki link inside a callout body', () => {
      const html = render('> [!note] Title\n> see [[Target]]');
      expect(html).toContain('data-callout="note"');
      expect(html).toContain('href="Target.md"');
    });
  });
});
