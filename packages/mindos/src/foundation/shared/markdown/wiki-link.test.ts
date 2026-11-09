import { describe, expect, it } from 'vitest';
import { collectScannableLines, maskInlineCode, parseWikiLinks } from './wiki-link.js';

describe('parseWikiLinks', () => {
  describe('normal paths', () => {
    it('parses a bare wiki link', () => {
      const [token, ...rest] = parseWikiLinks('see [[Target Note]] here');
      expect(rest).toHaveLength(0);
      expect(token).toMatchObject({
        raw: '[[Target Note]]',
        target: 'Target Note',
        isEmbed: false,
        line: 1,
        column: 5,
      });
      expect(token?.alias).toBeUndefined();
      expect(token?.subpath).toBeUndefined();
    });

    it('parses an alias', () => {
      const [token] = parseWikiLinks('[[Target|Display Text]]');
      expect(token).toMatchObject({ target: 'Target', alias: 'Display Text' });
    });

    it('parses a heading subpath', () => {
      const [token] = parseWikiLinks('[[Target#Some Heading]]');
      expect(token).toMatchObject({
        target: 'Target',
        subpath: { type: 'heading', value: 'Some Heading' },
      });
    });

    it('parses a block subpath', () => {
      const [token] = parseWikiLinks('[[Target#^block-id]]');
      expect(token).toMatchObject({
        target: 'Target',
        subpath: { type: 'block', value: 'block-id' },
      });
    });

    it('parses heading subpath combined with an alias', () => {
      const [token] = parseWikiLinks('[[Target#Heading|Alias]]');
      expect(token).toMatchObject({
        target: 'Target',
        alias: 'Alias',
        subpath: { type: 'heading', value: 'Heading' },
      });
    });

    it('marks a leading bang as an embed', () => {
      const [token] = parseWikiLinks('![[image.png]]');
      expect(token).toMatchObject({ raw: '![[image.png]]', target: 'image.png', isEmbed: true });
    });

    it('reports offsets that slice back to the raw match', () => {
      const source = 'lead [[Target]] tail';
      const [token] = parseWikiLinks(source);
      expect(source.slice(token!.start, token!.end)).toBe('[[Target]]');
    });

    it('reports offsets across multiple lines', () => {
      const source = 'first\nsecond [[Target]]';
      const [token] = parseWikiLinks(source);
      expect(token).toMatchObject({ line: 2, column: 8 });
      expect(source.slice(token!.start, token!.end)).toBe('[[Target]]');
    });

    it('parses several links on one line in source order', () => {
      const tokens = parseWikiLinks('[[One]] and [[Two]] and ![[Three]]');
      expect(tokens.map((t) => t.target)).toEqual(['One', 'Two', 'Three']);
      expect(tokens.map((t) => t.isEmbed)).toEqual([false, false, true]);
    });
  });

  describe('boundary cases', () => {
    it('returns nothing for empty or whitespace input', () => {
      expect(parseWikiLinks('')).toEqual([]);
      expect(parseWikiLinks('   \n\n  ')).toEqual([]);
    });

    it('ignores an empty link', () => {
      expect(parseWikiLinks('[[]]')).toEqual([]);
    });

    it('treats a bare subpath as a same-file link', () => {
      const [token] = parseWikiLinks('[[#Heading]]');
      expect(token).toMatchObject({
        target: '',
        subpath: { type: 'heading', value: 'Heading' },
      });
    });

    it('ignores links inside fenced code blocks', () => {
      expect(parseWikiLinks('```\n[[Target]]\n```')).toEqual([]);
      expect(parseWikiLinks('~~~\n[[Target]]\n~~~')).toEqual([]);
    });

    it('ignores links inside inline code', () => {
      expect(parseWikiLinks('text `[[Target]]` more')).toEqual([]);
    });

    it('ignores links inside frontmatter', () => {
      expect(parseWikiLinks('---\nkey: [[Target]]\n---\nbody')).toEqual([]);
    });

    it('still parses links after a closed fence', () => {
      const tokens = parseWikiLinks('```\ncode\n```\n[[Target]]');
      expect(tokens.map((t) => t.target)).toEqual(['Target']);
      expect(tokens[0]).toMatchObject({ line: 4 });
    });

    it('ignores a backslash-escaped link', () => {
      expect(parseWikiLinks('\\[[Target]]')).toEqual([]);
    });

    it('parses a link after an escaped backslash', () => {
      const [token] = parseWikiLinks('\\\\[[Target]]');
      expect(token).toMatchObject({ target: 'Target' });
    });

    it('treats an escaped bang as a non-embed link', () => {
      const [token] = parseWikiLinks('\\![[Target]]');
      expect(token).toMatchObject({ target: 'Target', isEmbed: false });
    });

    it('keeps unicode, emoji and spaces verbatim in the target', () => {
      const tokens = parseWikiLinks('[[中文笔记]] [[note 🎉 emoji]] [[with  spaces]]');
      expect(tokens.map((t) => t.target)).toEqual(['中文笔记', 'note 🎉 emoji', 'with  spaces']);
    });

    it('trims surrounding whitespace in target, alias and subpath', () => {
      const [token] = parseWikiLinks('[[  Target  #  Heading  |  Alias  ]]');
      expect(token).toMatchObject({
        target: 'Target',
        alias: 'Alias',
        subpath: { type: 'heading', value: 'Heading' },
      });
    });

    it('handles a very long target without truncating', () => {
      const long = 'x'.repeat(2000);
      const [token] = parseWikiLinks(`[[${long}]]`);
      expect(token?.target).toBe(long);
    });
  });

  describe('error paths', () => {
    it('ignores an unterminated link', () => {
      expect(parseWikiLinks('[[Target')).toEqual([]);
      expect(parseWikiLinks('[[Target]')).toEqual([]);
    });

    it('does not let a link span a newline', () => {
      expect(parseWikiLinks('[[Tar\nget]]')).toEqual([]);
    });

    it('ignores an empty subpath', () => {
      const [token] = parseWikiLinks('[[Target#]]');
      expect(token).toMatchObject({ target: 'Target' });
      expect(token?.subpath).toBeUndefined();
    });

    it('ignores an empty block id', () => {
      const [token] = parseWikiLinks('[[Target#^]]');
      expect(token).toMatchObject({ target: 'Target' });
      expect(token?.subpath).toBeUndefined();
    });

    it('drops an empty alias', () => {
      const [token] = parseWikiLinks('[[Target|]]');
      expect(token).toMatchObject({ target: 'Target' });
      expect(token?.alias).toBeUndefined();
    });
  });
});

describe('maskInlineCode', () => {
  it('replaces inline code with spaces of equal length', () => {
    const masked = maskInlineCode('a `code` b');
    expect(masked).toHaveLength('a `code` b'.length);
    expect(masked).toBe('a        b');
  });

  it('leaves a line without inline code untouched', () => {
    expect(maskInlineCode('plain text')).toBe('plain text');
  });
});

describe('collectScannableLines', () => {
  it('skips frontmatter and fenced blocks but keeps 1-indexed numbers', () => {
    const lines = collectScannableLines('---\na: 1\n---\nbody\n```\ncode\n```\ntail');
    expect(lines.map((line) => line.number)).toEqual([4, 8]);
    expect(lines.map((line) => line.original)).toEqual(['body', 'tail']);
  });

  it('yields a single empty line for empty input, carrying no links', () => {
    expect(collectScannableLines('')).toEqual([{ original: '', text: '', number: 1, offset: 0 }]);
    expect(parseWikiLinks('')).toEqual([]);
  });
});
