import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const counters = vi.hoisted(() => ({ readFileSync: 0, statSync: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      counters.readFileSync += 1;
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    statSync: ((...args: Parameters<typeof actual.statSync>) => {
      counters.statSync += 1;
      return actual.statSync(...args);
    }) as typeof actual.statSync,
  };
});

const { readAgentConfigFile, listServerNamesFromFile, resetAgentConfigReadCacheForTests } = await import('./config-read.js');
const { resolveAgentConfigProbes } = await import('./probes.js');

let home: string;
let configPath: string;

function probes() {
  return resolveAgentConfigProbes({ homeDir: home });
}

beforeEach(() => {
  resetAgentConfigReadCacheForTests();
  counters.readFileSync = 0;
  counters.statSync = 0;
  home = mkdtempSync(join(tmpdir(), 'agent-config-read-'));
  configPath = join(home, 'mcp.json');
});

afterEach(() => {
  resetAgentConfigReadCacheForTests();
  rmSync(home, { recursive: true, force: true });
});

const location = { format: 'json' as const, sectionKey: 'mcpServers' };

describe('config-read memo', () => {
  it('reads the file once and serves the second read from the memo', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: { command: 'mindos' } } }), 'utf-8');

    const first = readAgentConfigFile(configPath, probes());
    const readsAfterFirst = counters.readFileSync;
    const second = readAgentConfigFile(configPath, probes());

    expect(second).toBe(first);
    // The memo re-validates with a stat but does not re-read the bytes.
    expect(counters.readFileSync).toBe(readsAfterFirst);
  });

  it('invalidates when the file size changes', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { a: {} } }), 'utf-8');
    expect(readAgentConfigFile(configPath, probes())).toContain('"a"');

    writeFileSync(configPath, JSON.stringify({ mcpServers: { a: {}, b: {} } }), 'utf-8');
    expect(readAgentConfigFile(configPath, probes())).toContain('"b"');
  });

  it('returns null for a missing file without caching a stale entry', () => {
    expect(readAgentConfigFile(configPath, probes())).toBeNull();
    writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: {} } }), 'utf-8');
    expect(readAgentConfigFile(configPath, probes())).toContain('mindos');
  });

  it('memoises the parsed server-name list per location', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: { command: 'mindos' }, other: { url: 'http://x' } } }), 'utf-8');

    expect(listServerNamesFromFile(configPath, location, probes())).toEqual(['mindos', 'other']);
    const readsAfterFirst = counters.readFileSync;
    expect(listServerNamesFromFile(configPath, location, probes())).toEqual(['mindos', 'other']);
    expect(counters.readFileSync).toBe(readsAfterFirst);
  });

  it('bypasses the memo entirely when fs probes are injected', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { mindos: {} } }), 'utf-8');
    const injected = resolveAgentConfigProbes({
      homeDir: home,
      readTextFile: (p) => JSON.stringify({ injected: p.endsWith('mcp.json') }),
      stat: () => ({ mtimeMs: 0, size: 0, isFile: () => true, isDirectory: () => false }),
      pathExists: () => true,
    });
    expect(injected.usesRealFs).toBe(false);
    expect(readAgentConfigFile(configPath, injected)).toContain('injected');
  });
});
