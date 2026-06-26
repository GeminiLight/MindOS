import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ObsidianRuntimeCapabilityLedgerStore } from '@/lib/obsidian-compat/runtime-capability-ledger-store';
import { resolveCanonicalPluginRuntimeCapabilityLedgerPath } from '@/lib/obsidian-compat/plugin-paths';

let mindRoot: string;

function entry(overrides: Partial<Parameters<ObsidianRuntimeCapabilityLedgerStore['append']>[0]> = {}) {
  return {
    pluginId: 'quickadd',
    capability: 'addCommand',
    surface: 'commands',
    support: 'full',
    phase: 'called',
    source: 'runtime-ledger',
    evidence: 'Plugin command executed.',
    ...overrides,
  } as Parameters<ObsidianRuntimeCapabilityLedgerStore['append']>[0];
}

describe('ObsidianRuntimeCapabilityLedgerStore', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-ledger-store-'));
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('appends and reads durable runtime events under the canonical MindOS plugin root', () => {
    const store = new ObsidianRuntimeCapabilityLedgerStore(mindRoot, {
      sessionId: 'test-session',
      now: () => new Date('2026-06-26T00:00:00.000Z'),
    });

    store.append(entry({ phase: 'registered', evidence: 'Plugin registered command "capture".' }));
    store.append(entry({ phase: 'called', evidence: 'Plugin command "capture" executed.' }));

    const history = store.read('quickadd');
    expect(resolveCanonicalPluginRuntimeCapabilityLedgerPath(mindRoot, 'quickadd')).toBe(path.join(
      mindRoot,
      '.mindos',
      'plugins',
      '.runtime-capability-ledger',
      'quickadd.jsonl',
    ));
    expect(history).toMatchObject({
      total: 2,
      summary: {
        predicted: 0,
        registered: 1,
        called: 1,
        blocked: 0,
      },
      skippedCorruptLines: 0,
      updatedAt: '2026-06-26T00:00:00.000Z',
    });
    expect(history.entries).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        pluginId: 'quickadd',
        sessionId: 'test-session',
        capability: 'addCommand',
        phase: 'registered',
      }),
      expect.objectContaining({
        phase: 'called',
      }),
    ]);
  });

  it('redacts sensitive evidence before persisting runtime history', () => {
    const store = new ObsidianRuntimeCapabilityLedgerStore(mindRoot);

    store.append(entry({
      surface: 'network',
      support: 'limited',
      capability: 'requestUrl',
      evidence: 'Authorization: Bearer abc123 token=secret https://api.example.test/path?api_key=secret#frag',
    }));

    const [persisted] = store.read('quickadd').entries;
    expect(persisted?.evidence).toContain('Authorization=[redacted]');
    expect(persisted?.evidence).toContain('token=[redacted]');
    expect(persisted?.evidence).toContain('https://api.example.test/path?redacted');
    expect(persisted?.evidence).not.toContain('abc123');
    expect(persisted?.evidence).not.toContain('api_key=secret');
  });

  it('skips corrupt JSONL lines without hiding valid history', () => {
    const store = new ObsidianRuntimeCapabilityLedgerStore(mindRoot);
    store.append(entry({ evidence: 'valid before corrupt line' }));
    fs.appendFileSync(resolveCanonicalPluginRuntimeCapabilityLedgerPath(mindRoot, 'quickadd'), '{not-json}\n', 'utf-8');
    store.append(entry({ phase: 'blocked', evidence: 'blocked after corrupt line' }));

    const history = store.read('quickadd');
    expect(history.total).toBe(2);
    expect(history.skippedCorruptLines).toBe(1);
    expect(history.summary.called).toBe(1);
    expect(history.summary.blocked).toBe(1);
    expect(history.latestBlocked).toEqual([
      expect.objectContaining({ evidence: 'blocked after corrupt line' }),
    ]);
  });

  it('caps retained history per plugin', () => {
    const store = new ObsidianRuntimeCapabilityLedgerStore(mindRoot, { maxEntriesPerPlugin: 2 });
    store.append(entry({ evidence: 'first' }));
    store.append(entry({ evidence: 'second' }));
    store.append(entry({ evidence: 'third' }));

    const history = store.read('quickadd');
    expect(history.total).toBe(2);
    expect(history.entries.map((item) => item.evidence)).toEqual(['second', 'third']);
  });
});
