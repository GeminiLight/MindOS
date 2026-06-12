/**
 * splitMarkdownBlocks — splits streaming markdown into stable top-level blocks
 * so completed blocks can be memoized and only the tail block re-parses.
 *
 * Correctness contract: rendering the blocks independently must be visually
 * identical to rendering the whole source (verified separately in
 * markdown-message-equivalence.test.tsx). Splitting must therefore never
 * happen inside a fenced code block or inside a loose list.
 */
import { describe, it, expect } from 'vitest';
import { splitMarkdownBlocks } from '@/components/ask/markdown-blocks';

describe('splitMarkdownBlocks', () => {
  // -------------------------------------------------------------------------
  // Normal paths

  it('splits plain paragraphs on blank lines', () => {
    expect(splitMarkdownBlocks('one\n\ntwo\n\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('keeps a multi-line paragraph in one block', () => {
    expect(splitMarkdownBlocks('line a\nline b\nline c')).toEqual(['line a\nline b\nline c']);
  });

  it('splits a heading from the following paragraph', () => {
    expect(splitMarkdownBlocks('# Title\n\nBody text')).toEqual(['# Title', 'Body text']);
  });

  it('keeps multiple consecutive blank lines as a single boundary', () => {
    expect(splitMarkdownBlocks('a\n\n\n\nb')).toEqual(['a', 'b']);
  });

  // -------------------------------------------------------------------------
  // Fenced code blocks

  it('never splits inside a fenced code block containing blank lines', () => {
    const src = '```js\nconst a = 1;\n\nconst b = 2;\n```';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('splits text before and after a fence into separate blocks', () => {
    const blocks = splitMarkdownBlocks('intro\n\n```\ncode\n\nmore\n```\n\noutro');
    expect(blocks).toEqual(['intro', '```\ncode\n\nmore\n```', 'outro']);
  });

  it('supports tilde fences', () => {
    const src = '~~~python\nx = 1\n\ny = 2\n~~~';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('does not close a fence on a shorter closing marker', () => {
    const src = '````\n```\ninner fence text\n\nstill code\n````';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('does not close a backtick fence with a tilde marker', () => {
    const src = '```\n~~~\n\nstill code\n```';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('treats blank-line-containing text after an unclosed fence as one block (streaming tail)', () => {
    const src = '```\npartial code\n\nstill streaming';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('does not treat an inline-code paragraph mentioning backticks as a fence', () => {
    // Opening backtick fences cannot contain further backticks in the info string.
    const src = 'use ```a`` inline``` style\n\nnext para';
    expect(splitMarkdownBlocks(src)).toEqual(['use ```a`` inline``` style', 'next para']);
  });

  it('keeps an indented fence inside a list item intact', () => {
    const src = '- item:\n\n  ```js\n  code\n\n  more\n  ```';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  // -------------------------------------------------------------------------
  // Lists

  it('keeps a tight list in one block', () => {
    const src = '- a\n- b\n- c';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('keeps a loose list (blank lines between items) in one block', () => {
    const src = '- a\n\n- b\n\n- c';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('keeps ordered loose lists in one block', () => {
    const src = '1. first\n\n2. second';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('keeps an indented continuation paragraph with its list', () => {
    const src = '- item\n\n  continuation of the item';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('splits a non-indented paragraph after a list', () => {
    expect(splitMarkdownBlocks('- a\n- b\n\nplain paragraph')).toEqual(['- a\n- b', 'plain paragraph']);
  });

  // -------------------------------------------------------------------------
  // Tables / blockquotes

  it('keeps a GFM table in one block', () => {
    const src = '| a | b |\n| - | - |\n| 1 | 2 |';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('splits paragraphs around a table', () => {
    const blocks = splitMarkdownBlocks('before\n\n| a |\n| - |\n| 1 |\n\nafter');
    expect(blocks).toEqual(['before', '| a |\n| - |\n| 1 |', 'after']);
  });

  it('keeps a blockquote with embedded empty quote lines in one block', () => {
    const src = '> a\n>\n> b';
    expect(splitMarkdownBlocks(src)).toEqual([src]);
  });

  it('splits blank-line-separated blockquotes (CommonMark: two quotes)', () => {
    expect(splitMarkdownBlocks('> a\n\n> b')).toEqual(['> a', '> b']);
  });

  // -------------------------------------------------------------------------
  // Boundary cases

  it('returns an empty array for an empty string', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(splitMarkdownBlocks('\n\n  \n')).toEqual([]);
  });

  it('handles CRLF line endings without splitting on \\r', () => {
    const blocks = splitMarkdownBlocks('one\r\n\r\ntwo\r\nstill two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('one');
    expect(blocks[1]).toContain('two');
  });

  it('treats whitespace-only lines as blank boundaries', () => {
    expect(splitMarkdownBlocks('a\n   \nb')).toEqual(['a', 'b']);
  });

  it('preserves unicode and emoji content', () => {
    const blocks = splitMarkdownBlocks('中文段落 🎉\n\n日本語テキスト');
    expect(blocks).toEqual(['中文段落 🎉', '日本語テキスト']);
  });

  it('ignores leading and trailing blank lines', () => {
    expect(splitMarkdownBlocks('\n\nhello\n\n')).toEqual(['hello']);
  });

  it('preserves every content line across blocks (no content loss)', () => {
    const src = [
      '# Title', '',
      'Paragraph one.', '',
      '- loose', '', '- list', '',
      '```ts', 'const x = 1;', '', 'const y = 2;', '```', '',
      '| a | b |', '| - | - |', '| 1 | 2 |', '',
      '> quote',
    ].join('\n');
    const joined = splitMarkdownBlocks(src).join('\n');
    for (const line of src.split('\n').filter(l => l.trim() !== '')) {
      expect(joined).toContain(line);
    }
  });

  it('is stable for streaming prefixes: completed blocks keep their exact text as the source grows', () => {
    const full = 'para one\n\npara two\n\n- a\n- b\n\nlast paragraph here';
    let prev: string[] = [];
    for (let i = 0; i <= full.length; i++) {
      const blocks = splitMarkdownBlocks(full.slice(0, i));
      // All blocks except the last must match the previous snapshot exactly.
      for (let b = 0; b < blocks.length - 1 && b < prev.length - 1; b++) {
        expect(blocks[b]).toBe(prev[b]);
      }
      prev = blocks;
    }
  });
});
