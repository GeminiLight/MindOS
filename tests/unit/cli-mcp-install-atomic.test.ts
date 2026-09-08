import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * `mindos mcp install` rewrites third-party agent configs (~/.claude.json,
 * Cursor, Kilo .jsonc, Codex TOML, Hermes YAML). Those writes must be atomic
 * (temp file + rename) and must edit JSONC in place so user comments and
 * formatting survive (no `.bak` backups any more).
 */

async function importMcpInstall() {
  return await import('../../packages/mindos/bin/lib/mcp-install.js');
}

async function importJsonc() {
  return await import('../../packages/mindos/bin/lib/jsonc.js');
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-atomic-cli-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function leftovers(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => /\.tmp-\d+$/.test(name));
}

describe('jsonc.js parseJsonc', () => {
  it('parses comments, a BOM and trailing commas and treats blank text as {}', async () => {
    const { parseJsonc } = await importJsonc();
    expect(parseJsonc('{\n  // c\n  "a": 1, /* b */ "list": [1, 2,],\n}')).toEqual({ a: 1, list: [1, 2] });
    expect(parseJsonc('\uFEFF{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonc('')).toEqual({});
    expect(parseJsonc('// only a comment\n')).toEqual({});
  });

  it('keeps comment-looking sequences inside strings and rejects invalid documents', async () => {
    const { parseJsonc } = await importJsonc();
    expect(parseJsonc('{ "url": "http://localhost:8781/mcp", "s": "a \\"//\\" b" }')).toEqual({
      url: 'http://localhost:8781/mcp',
      s: 'a "//" b',
    });
    expect(() => parseJsonc('not json')).toThrow(SyntaxError);
    expect(() => parseJsonc('[1]')).toThrow(SyntaxError);
  });
});

describe('jsonc.js setJsoncValue / removeJsoncValue', () => {
  const original = '{\n  // keep me\n  "mcpServers": {\n    "other": { "url": "http://other" } // trailing\n  }\n}\n';

  it('inserts a nested value while preserving comments and formatting', async () => {
    const { setJsoncValue, parseJsonc } = await importJsonc();
    const next = setJsoncValue(original, ['mcpServers', 'mindos'], { url: 'http://localhost:8781/mcp' });
    expect(next).toContain('// keep me');
    expect(next).toContain('// trailing');
    expect(parseJsonc(next)).toEqual({
      mcpServers: { other: { url: 'http://other' }, mindos: { url: 'http://localhost:8781/mcp' } },
    });
    expect(next.endsWith('\n')).toBe(true);
  });

  it('creates a fresh document from empty text and intermediate objects for nested keys', async () => {
    const { setJsoncValue, parseJsonc } = await importJsonc();
    const next = setJsoncValue('', ['mcp', 'clients', 'mindos'], { type: 'stdio' });
    expect(parseJsonc(next)).toEqual({ mcp: { clients: { mindos: { type: 'stdio' } } } });
    expect(next.endsWith('\n')).toBe(true);
  });

  it('removes a property in place and returns the input untouched when it is missing', async () => {
    const { removeJsoncValue, parseJsonc } = await importJsonc();
    const withMindos = original.replace('"other"', '"mindos": { "command": "mindos" },\n    "other"');
    const next = removeJsoncValue(withMindos, ['mcpServers', 'mindos']);
    expect(next).toContain('// keep me');
    expect(parseJsonc(next)).toEqual({ mcpServers: { other: { url: 'http://other' } } });
    expect(removeJsoncValue(original, ['mcpServers', 'missing'])).toBe(original);
  });
});

describe('mcp-install.js writeFileAtomically', () => {
  it('round-trips content and leaves no .tmp-* file', async () => {
    const { writeFileAtomically } = await importMcpInstall();
    const target = path.join(tempDir, 'mcp.json');
    fs.writeFileSync(target, 'old');
    writeFileAtomically(target, '{"mcpServers":{}}\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('{"mcpServers":{}}\n');
    expect(leftovers(tempDir)).toEqual([]);
  });

  it('propagates write errors without leaving a temp file', async () => {
    const { writeFileAtomically } = await importMcpInstall();
    expect(() => writeFileAtomically(path.join(tempDir, 'nope', 'mcp.json'), 'x')).toThrow();
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });
});

describe('mcp-install.js writeJsonServerEntry', () => {
  it('edits a commented JSONC config in place without creating a .bak', async () => {
    const { writeJsonServerEntry } = await importMcpInstall();
    const { parseJsonc } = await importJsonc();
    const commented = path.join(tempDir, 'settings.jsonc');
    const original = '{\n  // keep me\n  "mcpServers": { "other": { "command": "x" } }\n}\n';
    fs.writeFileSync(commented, original);

    writeJsonServerEntry(commented, original, ['mcpServers', 'mindos'], { type: 'stdio', command: 'mindos' });

    const rewritten = fs.readFileSync(commented, 'utf-8');
    expect(rewritten).toContain('// keep me');
    expect(parseJsonc(rewritten)).toEqual({
      mcpServers: { other: { command: 'x' }, mindos: { type: 'stdio', command: 'mindos' } },
    });
    expect(fs.existsSync(`${commented}.bak`)).toBe(false);
    expect(leftovers(tempDir)).toEqual([]);
  });

  it('treats a brand-new file (empty existing text) as an empty config', async () => {
    const { writeJsonServerEntry } = await importMcpInstall();
    const target = path.join(tempDir, 'new.json');
    writeJsonServerEntry(target, '', ['mcpServers', 'mindos'], { url: 'http://localhost:8781/mcp' });
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ mcpServers: { mindos: { url: 'http://localhost:8781/mcp' } } });
    expect(fs.readFileSync(target, 'utf-8').endsWith('\n')).toBe(true);
  });
});
