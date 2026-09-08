import { describe, expect, it } from 'vitest';
import {
  parseJsonc,
  parseJsoncDocument,
  removeJsoncValue,
  setJsoncValue,
  stripBom,
} from './jsonc.js';

describe('parseJsonc', () => {
  it('parses plain JSON, comments, a BOM and trailing commas', () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonc('{\n  // note\n  "a": 1, /* block */ "b": [1, 2,],\n}')).toEqual({ a: 1, b: [1, 2] });
    expect(parseJsonc('\uFEFF{"a":1}')).toEqual({ a: 1 });
  });

  it('keeps comment-looking sequences inside strings intact', () => {
    expect(parseJsonc('{ "url": "https://example.com/mcp", "glob": "src/**/*.ts", "q": "say \\"//\\" here" }')).toEqual({
      url: 'https://example.com/mcp',
      glob: 'src/**/*.ts',
      q: 'say "//" here',
    });
  });

  it('returns an empty object for blank or comment-only input', () => {
    expect(parseJsonc('')).toEqual({});
    expect(parseJsonc('   \n')).toEqual({});
    expect(parseJsonc('// nothing here\n/* really */')).toEqual({});
  });

  it('throws a SyntaxError for invalid documents and non-object roots', () => {
    expect(() => parseJsonc('not json')).toThrow(SyntaxError);
    expect(() => parseJsonc('{"a":1')).toThrow(SyntaxError);
    expect(() => parseJsonc('[1, 2]')).toThrow(SyntaxError);
    expect(() => parseJsonc('"string"')).toThrow(SyntaxError);
  });
});

describe('parseJsoncDocument', () => {
  it('collects readable parse issues without throwing', () => {
    const clean = parseJsoncDocument('{"a":1}');
    expect(clean).toEqual({ value: { a: 1 }, errors: [] });

    const broken = parseJsoncDocument('{"a":1');
    expect(broken.value).toEqual({ a: 1 });
    expect(broken.errors).toEqual([expect.stringMatching(/CloseBraceExpected/)]);

    const garbage = parseJsoncDocument('not json');
    expect(garbage.value).toBeUndefined();
    expect(garbage.errors.length).toBeGreaterThan(0);
  });
});

describe('setJsoncValue / removeJsoncValue', () => {
  const doc = [
    '{',
    '  // Kilo user settings',
    '  "theme": "dark", /* keep */',
    '  "mcp": {',
    '    "other": { "type": "remote", "url": "https://example.com/mcp" } // trailing',
    '  }',
    '}',
    '',
  ].join('\n');

  it('inserts a nested value while preserving comments and formatting', () => {
    const next = setJsoncValue(doc, ['mcp', 'mindos'], { type: 'local', command: ['mindos', 'mcp'] });
    expect(next).toContain('// Kilo user settings');
    expect(next).toContain('/* keep */');
    expect(next).toContain('// trailing');
    expect(parseJsonc(next)).toEqual({
      theme: 'dark',
      mcp: {
        other: { type: 'remote', url: 'https://example.com/mcp' },
        mindos: { type: 'local', command: ['mindos', 'mcp'] },
      },
    });
    expect(next.endsWith('\n')).toBe(true);
  });

  it('creates intermediate objects and a fresh document when the text is empty', () => {
    const next = setJsoncValue('', ['mcp', 'clients', 'mindos'], { a: 1 });
    expect(parseJsonc(next)).toEqual({ mcp: { clients: { mindos: { a: 1 } } } });
    expect(next.endsWith('\n')).toBe(true);
    expect(next).toContain('  "mcp"');
  });

  it('replaces an existing value in place', () => {
    const text = '{\n  "mcpServers": {\n    "mindos": { "url": "http://old" },\n    "other": { "command": "x" }\n  }\n}\n';
    const next = setJsoncValue(text, ['mcpServers', 'mindos'], { url: 'http://new' });
    expect(parseJsonc(next)).toEqual({ mcpServers: { mindos: { url: 'http://new' }, other: { command: 'x' } } });
  });

  it('removes a property and leaves siblings untouched', () => {
    const text = '{\n  // servers\n  "mcpServers": {\n    "mindos": { "url": "http://old" },\n    "other": { "command": "x" }\n  }\n}\n';
    const next = removeJsoncValue(text, ['mcpServers', 'mindos']);
    expect(next).toContain('// servers');
    expect(parseJsonc(next)).toEqual({ mcpServers: { other: { command: 'x' } } });
    expect(removeJsoncValue(text, ['mcpServers', 'missing'])).toBe(text);
  });

  it('handles unicode and special characters in values', () => {
    const next = setJsoncValue('{}', ['名字'], { emoji: '🚀', quote: 'say "hi"', path: 'C:\\Users\\x' });
    expect(parseJsonc(next)).toEqual({ 名字: { emoji: '🚀', quote: 'say "hi"', path: 'C:\\Users\\x' } });
  });
});

describe('stripBom', () => {
  it('removes a leading BOM only', () => {
    expect(stripBom('\uFEFFabc')).toBe('abc');
    expect(stripBom('abc\uFEFF')).toBe('abc\uFEFF');
    expect(stripBom('')).toBe('');
  });
});
