import { describe, it, expect } from 'vitest';
import {
  truncateMessage,
  downgradeFormat,
  preprocessMessage,
  stripMarkdown,
  stripHtml,
  escapeMarkdownV2,
  markdownToTelegramV2,
  maskForLog,
} from '@/lib/im/format';
import type { IMMessage } from '@/lib/im/types';

function msg(overrides: Partial<IMMessage> = {}): IMMessage {
  return { platform: 'telegram', recipientId: '123', text: 'hello', ...overrides };
}

describe('IM Format Utilities', () => {
  describe('truncateMessage', () => {
    it('does not truncate short messages', () => {
      const m = msg({ text: 'short' });
      expect(truncateMessage(m).text).toBe('short');
    });

    it('truncates messages exceeding platform limit', () => {
      const longText = 'x'.repeat(5000);
      const m = msg({ text: longText, platform: 'telegram' }); // limit: 4096
      const result = truncateMessage(m);
      expect(result.text.length).toBeLessThanOrEqual(4096);
      expect(result.text).toContain('(message truncated)');
    });

    it('respects Discord 2000 char limit', () => {
      const longText = 'x'.repeat(3000);
      const m = msg({ text: longText, platform: 'discord' });
      const result = truncateMessage(m);
      expect(result.text.length).toBeLessThanOrEqual(2000);
    });

    it('respects WeCom 2048 byte limit', () => {
      const longText = 'x'.repeat(3000);
      const m = msg({ text: longText, platform: 'wecom' });
      const result = truncateMessage(m);
      expect(result.text.length).toBeLessThanOrEqual(2048);
    });
  });

  describe('downgradeFormat', () => {
    it('downgrades html to text when platform does not support html', () => {
      const m = msg({ format: 'html', text: '<b>bold</b>', platform: 'discord' });
      const result = downgradeFormat(m);
      expect(result.format).toBe('text');
      expect(result.text).toBe('bold');
    });

    it('keeps markdown when platform supports it', () => {
      const m = msg({ format: 'markdown', text: '**bold**', platform: 'telegram' });
      const result = downgradeFormat(m);
      expect(result.format).toBe('markdown');
    });

    it('keeps text format unchanged', () => {
      const m = msg({ format: 'text', text: 'plain' });
      expect(downgradeFormat(m)).toEqual(m);
    });
  });

  describe('preprocessMessage', () => {
    it('applies both downgrade and truncation', () => {
      const longHtml = '<b>' + 'x'.repeat(5000) + '</b>';
      const m = msg({ format: 'html', text: longHtml, platform: 'discord' }); // no html, 2000 limit
      const result = preprocessMessage(m);
      expect(result.format).toBe('text');
      expect(result.text.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('stripMarkdown', () => {
    it('strips bold', () => expect(stripMarkdown('**bold**')).toBe('bold'));
    it('strips italic', () => expect(stripMarkdown('*italic*')).toBe('italic'));
    it('strips inline code', () => expect(stripMarkdown('`code`')).toBe('code'));
    it('strips links', () => expect(stripMarkdown('[text](url)')).toBe('text'));
    it('strips headings', () => expect(stripMarkdown('# Heading')).toBe('Heading'));
    it('strips quotes', () => expect(stripMarkdown('> quote')).toBe('quote'));
    it('normalizes list items', () => expect(stripMarkdown('- item')).toBe('- item'));
    it('strips code blocks', () => expect(stripMarkdown('```js\ncode\n```')).toContain('code'));
  });

  describe('stripHtml', () => {
    it('removes all HTML tags', () => {
      expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });
    it('handles self-closing tags', () => {
      expect(stripHtml('Line1<br/>Line2')).toBe('Line1Line2');
    });
  });

  describe('escapeMarkdownV2', () => {
    it('escapes all special characters', () => {
      expect(escapeMarkdownV2('hello.world!')).toBe('hello\\.world\\!');
      expect(escapeMarkdownV2('a_b*c[d]')).toBe('a\\_b\\*c\\[d\\]');
    });
  });

  describe('markdownToTelegramV2', () => {
    it('converts headings to bold', () => {
      const result = markdownToTelegramV2('# Title');
      expect(result).toContain('*');
    });

    it('preserves code blocks', () => {
      const result = markdownToTelegramV2('```\ncode.here()\n```');
      expect(result).toContain('```');
      expect(result).toContain('code.here()');
    });

    it('preserves inline code', () => {
      const result = markdownToTelegramV2('use `npm install`');
      expect(result).toContain('`npm install`');
    });
  });

  describe('maskForLog', () => {
    it('masks long strings', () => {
      expect(maskForLog('1234567890')).toBe('123***890');
    });
    it('fully masks short strings', () => {
      expect(maskForLog('short')).toBe('***');
    });
    it('masks empty string', () => {
      expect(maskForLog('')).toBe('***');
    });
  });
});
