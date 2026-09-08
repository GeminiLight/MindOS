import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { rewriteMcpClientConfig, rewriteMcpClientConfigFile } from './mcp-config-rewrite';

describe('rewriteMcpClientConfig', () => {
  it('rewrites localhost-form URLs to the 127.0.0.1 form on the new port', () => {
    const raw = '{"mcpServers":{"mindos":{"url":"http://localhost:8781/mcp"}}}';
    expect(rewriteMcpClientConfig(raw, 8781, 8790)).toBe(
      '{"mcpServers":{"mindos":{"url":"http://127.0.0.1:8790/mcp"}}}',
    );
  });

  it('rewrites 127.0.0.1-form URLs (hand-written configs)', () => {
    const raw = '{"url":"http://127.0.0.1:8781/mcp"}';
    expect(rewriteMcpClientConfig(raw, 8781, 8790)).toBe('{"url":"http://127.0.0.1:8790/mcp"}');
  });

  it('rewrites every occurrence across mixed host forms', () => {
    const raw = 'a http://localhost:8781/mcp b http://127.0.0.1:8781/mcp c';
    expect(rewriteMcpClientConfig(raw, 8781, 8790)).toBe(
      'a http://127.0.0.1:8790/mcp b http://127.0.0.1:8790/mcp c',
    );
  });

  it('returns null when the old port is not referenced', () => {
    expect(rewriteMcpClientConfig('{"url":"http://localhost:9999/mcp"}', 8781, 8790)).toBeNull();
    expect(rewriteMcpClientConfig('', 8781, 8790)).toBeNull();
  });

  it('does not touch non-mcp URLs on the same port', () => {
    const raw = '{"web":"http://localhost:8781/api"}';
    expect(rewriteMcpClientConfig(raw, 8781, 8790)).toBeNull();
  });
});

describe('rewriteMcpClientConfigFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mindos-mcp-cfg-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites a valid JSON config in place and leaves no temp file behind', () => {
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, '{"mcpServers":{"mindos":{"url":"http://localhost:8781/mcp"}}}', 'utf-8');

    const result = rewriteMcpClientConfigFile(file, 8781, 8790);

    expect(result).toBe('updated');
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      mcpServers: { mindos: { url: 'http://127.0.0.1:8790/mcp' } },
    });
    expect(readdirSync(dir)).toEqual(['mcp.json']);
  });

  it('returns "unchanged" and does not rewrite when the old port is absent', () => {
    const file = path.join(dir, 'mcp.json');
    const raw = '{"mcpServers":{"other":{"url":"http://localhost:9999/mcp"}}}';
    writeFileSync(file, raw, 'utf-8');

    expect(rewriteMcpClientConfigFile(file, 8781, 8790)).toBe('unchanged');
    expect(readFileSync(file, 'utf-8')).toBe(raw);
    expect(readdirSync(dir)).toEqual(['mcp.json']);
  });

  it('returns "missing" for a file that does not exist', () => {
    expect(rewriteMcpClientConfigFile(path.join(dir, 'nope.json'), 8781, 8790)).toBe('missing');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses to write when the rewritten text is not valid JSON (already-corrupt file)', () => {
    const file = path.join(dir, 'broken.json');
    // Trailing comma + old port: string replace would "succeed" but the file is corrupt
    const raw = '{"mcpServers":{"mindos":{"url":"http://localhost:8781/mcp"},}}';
    writeFileSync(file, raw, 'utf-8');

    expect(rewriteMcpClientConfigFile(file, 8781, 8790)).toBe('invalid');
    expect(readFileSync(file, 'utf-8')).toBe(raw);
    expect(readdirSync(dir)).toEqual(['broken.json']);
  });

  it('writes through a pid-suffixed temp file followed by rename (never a bare overwrite)', () => {
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, '{"url":"http://127.0.0.1:8781/mcp"}', 'utf-8');
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];

    const result = rewriteMcpClientConfigFile(file, 8781, 8790, {
      writeFileSync: (p, data) => { writes.push(String(p)); writeFileSync(p, data, 'utf-8'); },
      renameSync: (from, to) => { renames.push([String(from), String(to)]); renameSync(from, to); },
    });

    expect(result).toBe('updated');
    expect(writes).toEqual([`${file}.tmp-${process.pid}`]);
    expect(renames).toEqual([[`${file}.tmp-${process.pid}`, file]]);
  });

  it('cleans up the temp file and rethrows when rename fails', () => {
    const file = path.join(dir, 'mcp.json');
    writeFileSync(file, '{"url":"http://127.0.0.1:8781/mcp"}', 'utf-8');

    expect(() => rewriteMcpClientConfigFile(file, 8781, 8790, {
      renameSync: () => { throw new Error('EPERM: rename blocked'); },
    })).toThrow(/EPERM/);
    expect(readdirSync(dir)).toEqual(['mcp.json']);
    expect(readFileSync(file, 'utf-8')).toBe('{"url":"http://127.0.0.1:8781/mcp"}');
  });

  it('handles unicode and multi-server configs without altering unrelated entries', () => {
    const file = path.join(dir, 'mcp.json');
    const cfg = {
      mcpServers: {
        '思维': { url: 'http://localhost:8781/mcp', headers: { 'X-Note': 'ünïcödé 🚀' } },
        other: { command: 'npx', args: ['-y', 'thing'] },
      },
    };
    writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');

    expect(rewriteMcpClientConfigFile(file, 8781, 8790)).toBe('updated');
    const after = JSON.parse(readFileSync(file, 'utf-8'));
    expect(after.mcpServers['思维'].url).toBe('http://127.0.0.1:8790/mcp');
    expect(after.mcpServers['思维'].headers['X-Note']).toBe('ünïcödé 🚀');
    expect(after.mcpServers.other).toEqual(cfg.mcpServers.other);
  });
});
