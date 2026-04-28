import { describe, it, expect } from 'vitest';
import { looksLikeUrl } from '@/lib/inbox-upload';

describe('looksLikeUrl', () => {
  it('accepts valid http URLs', () => {
    expect(looksLikeUrl('http://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com/path?q=1&a=2')).toBe(true);
  });

  it('accepts valid https URLs', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('https://sub.example.com/long/path#anchor')).toBe(true);
  });

  it('accepts URLs with leading/trailing whitespace', () => {
    expect(looksLikeUrl('  https://example.com  ')).toBe(true);
    expect(looksLikeUrl('\nhttps://example.com\n')).toBe(true);
  });

  it('rejects non-http schemes', () => {
    expect(looksLikeUrl('ftp://example.com')).toBe(false);
    expect(looksLikeUrl('file:///etc/passwd')).toBe(false);
    expect(looksLikeUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects plain text', () => {
    expect(looksLikeUrl('hello world')).toBe(false);
    expect(looksLikeUrl('example.com')).toBe(false);
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('   ')).toBe(false);
  });

  it('rejects strings that start with http but are invalid', () => {
    expect(looksLikeUrl('http://')).toBe(false);
    expect(looksLikeUrl('https://')).toBe(false);
  });
});
