/**
 * MarkdownMessage must render HTML identical to a single full-document
 * ReactMarkdown pass for every common markdown shape. The block splitter
 * only exists for streaming performance; any visual difference is a bug
 * worse than the perf win.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MarkdownMessage from '@/components/ask/MarkdownMessage';

const PLUGINS = [remarkGfm];

/**
 * mdast-util-to-hast inserts "\n" text nodes between top-level block elements
 * of one document; per-block rendering has no such nodes between blocks.
 * Whitespace between block-level elements is not rendered, so normalize it
 * away on both sides before comparing.
 */
function normalize(html: string): string {
  return html.replace(/>\n</g, '><');
}

function renderFull(source: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={PLUGINS}>{source}</ReactMarkdown>,
  );
}

function renderBlocks(source: string): string {
  return renderToStaticMarkup(<MarkdownMessage content={source} />);
}

function expectEquivalent(source: string) {
  expect(normalize(renderBlocks(source))).toBe(normalize(renderFull(source)));
}

describe('MarkdownMessage rendering equivalence', () => {
  it('renders multi-paragraph text identically', () => {
    expectEquivalent('First paragraph.\n\nSecond paragraph.\n\nThird with **bold** and `code`.');
  });

  it('renders fenced code spanning many lines (with blank lines and markdown-like content) identically', () => {
    expectEquivalent([
      'Here is some code:',
      '',
      '```python',
      'def f():',
      '    return 1',
      '',
      '# this is a comment, not a heading',
      '',
      '- not a list',
      '',
      '| not | a table |',
      '```',
      '',
      'And a closing paragraph.',
    ].join('\n'));
  });

  it('renders tight lists identically', () => {
    expectEquivalent('Steps:\n\n- one\n- two\n- three\n\nDone.');
  });

  it('renders loose lists (blank lines between items) identically', () => {
    expectEquivalent('- first item\n\n- second item\n\n- third item');
  });

  it('renders nested lists with continuation paragraphs identically', () => {
    expectEquivalent([
      '1. outer',
      '',
      '   continuation paragraph of item one',
      '',
      '2. second',
      '   - nested a',
      '   - nested b',
    ].join('\n'));
  });

  it('renders GFM tables identically', () => {
    expectEquivalent([
      'Comparison:',
      '',
      '| Name | Value |',
      '| ---- | ----- |',
      '| a    | 1     |',
      '| b    | 2     |',
      '',
      'After the table.',
    ].join('\n'));
  });

  it('renders blockquotes identically', () => {
    expectEquivalent('> single quote line\n>\n> second quoted paragraph\n\nplain after quote');
  });

  it('renders adjacent blank-line-separated blockquotes identically', () => {
    expectEquivalent('> quote one\n\n> quote two');
  });

  it('renders headings, hr, and emphasis identically', () => {
    expectEquivalent('# H1\n\n## H2\n\n---\n\nText with *em* and ~~strike~~.');
  });

  it('renders a mixed real-world answer identically', () => {
    expectEquivalent([
      '# Summary',
      '',
      'Here is what I found in `notes.md`:',
      '',
      '1. First finding',
      '2. Second finding',
      '',
      '```ts',
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '```',
      '',
      '> Note: this is a quote.',
      '',
      '| col | val |',
      '| --- | --- |',
      '| x   | 1   |',
      '',
      'Final paragraph with a [link](https://example.com) and emoji 🎉.',
    ].join('\n'));
  });

  it('renders an unclosed streaming fence identically', () => {
    expectEquivalent('Working on it:\n\n```js\nconst partial = tr');
  });

  it('renders empty content identically (nothing)', () => {
    expectEquivalent('');
  });

  it('renders unicode/emoji-only content identically', () => {
    expectEquivalent('中文 🎉 émojis\n\nполный текст');
  });
});
