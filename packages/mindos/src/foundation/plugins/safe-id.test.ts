import { describe, expect, it } from 'vitest';
import {
  assertSafePluginIdentifier,
  isSafePluginIdentifier,
  safePluginIdentifierIssue,
} from './safe-id.js';

describe('isSafePluginIdentifier', () => {
  it('accepts typical plugin and extension identifiers', () => {
    for (const value of [
      'a',
      'quickadd',
      'aion-style-pack',
      'ext_buddy',
      'ext.buddy',
      'a1',
      'PeriodicNotes',
      'plugin-with-dash_underscore.dot',
    ]) {
      expect(isSafePluginIdentifier(value), value).toBe(true);
      expect(safePluginIdentifierIssue(value), value).toBeUndefined();
    }
  });

  it('rejects empty and non-string values', () => {
    expect(safePluginIdentifierIssue('')).toBe('empty');
    expect(safePluginIdentifierIssue('   ')).toBe('empty');
    expect(safePluginIdentifierIssue(undefined)).toBe('empty');
    expect(safePluginIdentifierIssue(null)).toBe('empty');
    expect(safePluginIdentifierIssue(42)).toBe('empty');
    expect(safePluginIdentifierIssue({ id: 'x' })).toBe('empty');
    expect(isSafePluginIdentifier('')).toBe(false);
  });

  it('rejects dot segments and traversal shapes', () => {
    expect(safePluginIdentifierIssue('.')).toBe('dot-segment');
    expect(safePluginIdentifierIssue('..')).toBe('dot-segment');
    expect(safePluginIdentifierIssue('a..b')).toBe('dot-segment');
    expect(safePluginIdentifierIssue('./x')).toBe('path-separator');
    expect(safePluginIdentifierIssue('../escape')).toBe('path-separator');
    expect(safePluginIdentifierIssue('a.')).toBe('dot-segment');
  });

  it('rejects dot-leading identifiers only when allowDots is false', () => {
    expect(safePluginIdentifierIssue('.hidden')).toBe('invalid-first-char');
    expect(isSafePluginIdentifier('.hidden')).toBe(false);
    // Obsidian path segments must never start with a dot either.
    expect(isSafePluginIdentifier('.hidden', { allowDots: false })).toBe(false);
  });

  it('rejects path separators, absolute paths, and Windows drives', () => {
    expect(safePluginIdentifierIssue('/abs/path')).toBe('path-separator');
    expect(safePluginIdentifierIssue('a/b')).toBe('path-separator');
    expect(safePluginIdentifierIssue('a\\b')).toBe('path-separator');
    expect(safePluginIdentifierIssue('C:drive')).toBe('windows-reserved');
    expect(safePluginIdentifierIssue('c:\\drive')).toBe('path-separator');
  });

  it('rejects prototype-pollution keys', () => {
    for (const value of ['__proto__', 'constructor', 'prototype']) {
      expect(safePluginIdentifierIssue(value), value).toBe('prototype-key');
      expect(isSafePluginIdentifier(value), value).toBe(false);
    }
  });

  it('rejects unicode, emoji, spaces, and control characters', () => {
    expect(safePluginIdentifierIssue('插件')).toBe('invalid-first-char');
    expect(safePluginIdentifierIssue('plug🔌in')).toBe('invalid-char');
    expect(safePluginIdentifierIssue('a b')).toBe('invalid-char');
    expect(safePluginIdentifierIssue('a\x00b')).toBe('control-char');
    expect(safePluginIdentifierIssue('a\nb')).toBe('control-char');
    expect(safePluginIdentifierIssue('a\tb')).toBe('control-char');
  });

  it('enforces the length cap at the boundary', () => {
    const atCap = 'a'.repeat(64);
    const overCap = 'a'.repeat(65);
    expect(isSafePluginIdentifier(atCap)).toBe(true);
    expect(safePluginIdentifierIssue(overCap)).toBe('too-long');
    expect(safePluginIdentifierIssue(overCap, { maxLength: 120 })).toBeUndefined();
    const longUnicode = '插'.repeat(70);
    expect(safePluginIdentifierIssue(longUnicode, { maxLength: 120 })).toBe('invalid-first-char');
  });

  it('rejects invalid first characters', () => {
    expect(safePluginIdentifierIssue('-lead')).toBe('invalid-first-char');
    expect(safePluginIdentifierIssue('_lead')).toBe('invalid-first-char');
    expect(safePluginIdentifierIssue('1ok')).toBeUndefined();
  });

  it('rejects Windows reserved device names', () => {
    for (const value of ['con', 'PRN', 'aux', 'NUL', 'com1', 'LPT9']) {
      expect(safePluginIdentifierIssue(value), value).toBe('windows-reserved');
    }
    expect(safePluginIdentifierIssue('console')).toBeUndefined();
    expect(safePluginIdentifierIssue('contact')).toBeUndefined();
  });
});

describe('assertSafePluginIdentifier', () => {
  it('returns the trimmed identifier when safe', () => {
    expect(assertSafePluginIdentifier(' quickadd ')).toBe('quickadd');
  });

  it('throws an error naming the identifier and the issue when unsafe', () => {
    expect(() => assertSafePluginIdentifier('../escape')).toThrowError(
      /Unsafe plugin identifier "\.\.\/escape" \(path-separator|invalid-first-char\)/,
    );
    expect(() => assertSafePluginIdentifier('')).toThrowError(/Unsafe plugin identifier/);
  });

  it('accepts a custom context for the error message', () => {
    expect(() => assertSafePluginIdentifier('a/b', { context: 'obsidian plugin id' })).toThrowError(
      /Unsafe obsidian plugin id "a\/b"/,
    );
  });
});
