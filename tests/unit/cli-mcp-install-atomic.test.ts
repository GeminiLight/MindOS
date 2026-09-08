import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * `mindos mcp install` rewrites third-party agent configs (~/.claude.json,
 * Cursor, Kilo .jsonc, Codex TOML, Hermes YAML). Those writes must be atomic
 * (temp file + rename) and must not silently discard JSONC comments.
 */

async function importMcpInstall() {
  return await import('../../packages/mindos/bin/lib/mcp-install.js');
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

describe('mcp-install.js hasJsoncComments', () => {
  it('flags // and /* */ comments outside strings only', async () => {
    const { hasJsoncComments } = await importMcpInstall();
    expect(hasJsoncComments('{\n  // c\n  "a": 1\n}')).toBe(true);
    expect(hasJsoncComments('{ "a": 1 /* c */ }')).toBe(true);
    expect(hasJsoncComments('{ "url": "http://localhost:8781/mcp" }')).toBe(false);
    expect(hasJsoncComments('{ "s": "a \\"//\\" b" }')).toBe(false);
    expect(hasJsoncComments('')).toBe(false);
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

describe('mcp-install.js writeJsonConfigFile', () => {
  it('writes a .bak only when the original had comments', async () => {
    const { writeJsonConfigFile } = await importMcpInstall();
    const plain = path.join(tempDir, 'plain.json');
    fs.writeFileSync(plain, '{"a":1}');
    expect(writeJsonConfigFile(plain, '{"a":1}', '{"a":2}\n')).toBeNull();
    expect(fs.existsSync(`${plain}.bak`)).toBe(false);
    expect(fs.readFileSync(plain, 'utf-8')).toBe('{"a":2}\n');

    const commented = path.join(tempDir, 'settings.jsonc');
    const original = '{\n  // keep me\n  "a": 1\n}\n';
    fs.writeFileSync(commented, original);
    expect(writeJsonConfigFile(commented, original, '{"a":2}\n')).toBe(`${commented}.bak`);
    expect(fs.readFileSync(`${commented}.bak`, 'utf-8')).toBe(original);
    expect(fs.readFileSync(commented, 'utf-8')).toBe('{"a":2}\n');
    expect(leftovers(tempDir)).toEqual([]);
  });

  it('treats a brand-new file (empty existing text) as comment-free', async () => {
    const { writeJsonConfigFile } = await importMcpInstall();
    const target = path.join(tempDir, 'new.json');
    expect(writeJsonConfigFile(target, '', '{}\n')).toBeNull();
    expect(fs.readFileSync(target, 'utf-8')).toBe('{}\n');
  });
});
