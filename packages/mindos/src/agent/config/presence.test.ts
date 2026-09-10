import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PRESENCE_TTL_MS, detectAgentPresence, resetAgentPresenceCacheForTests } from './presence.js';
import { resolveAgentConfigProbes } from './probes.js';
import type { AgentConfigDef } from './types.js';

const def: AgentConfigDef = {
  name: 'Test Agent',
  project: null,
  global: '~/.test-agent/config.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.test-agent/'],
};

let home: string;

function probes() {
  // Only homeDir is set, so usesRealFs stays true and the process-wide cache engages.
  return resolveAgentConfigProbes({ homeDir: home });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAgentPresenceCacheForTests();
  home = mkdtempSync(join(tmpdir(), 'agent-presence-'));
});

afterEach(() => {
  vi.useRealTimers();
  resetAgentPresenceCacheForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('agent presence cache', () => {
  it('reports absent when no declared directory exists and present once one appears after the TTL', () => {
    expect(detectAgentPresence('test-agent', def, probes())).toBe(false);

    // A fresh install within the TTL is masked by the memoised "absent" result.
    mkdirSync(join(home, '.test-agent'), { recursive: true });
    writeFileSync(join(home, '.test-agent', 'state.json'), '{}', 'utf-8');
    vi.advanceTimersByTime(AGENT_PRESENCE_TTL_MS - 1000);
    expect(detectAgentPresence('test-agent', def, probes())).toBe(false);

    // Past the TTL the agent is re-probed and now detected.
    vi.advanceTimersByTime(2000);
    expect(detectAgentPresence('test-agent', def, probes())).toBe(true);
  });

  it('keeps a cached positive result for the TTL window without re-reading the disk', () => {
    mkdirSync(join(home, '.test-agent'), { recursive: true });
    writeFileSync(join(home, '.test-agent', 'state.json'), '{}', 'utf-8');
    expect(detectAgentPresence('test-agent', def, probes())).toBe(true);

    // Removing the signal within the TTL still reports present (cached).
    rmSync(join(home, '.test-agent'), { recursive: true, force: true });
    vi.advanceTimersByTime(AGENT_PRESENCE_TTL_MS - 1000);
    expect(detectAgentPresence('test-agent', def, probes())).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(detectAgentPresence('test-agent', def, probes())).toBe(false);
  });

  it('resetAgentPresenceCacheForTests forces an immediate re-probe', () => {
    expect(detectAgentPresence('test-agent', def, probes())).toBe(false);
    mkdirSync(join(home, '.test-agent'), { recursive: true });
    writeFileSync(join(home, '.test-agent', 'state.json'), '{}', 'utf-8');

    resetAgentPresenceCacheForTests();
    expect(detectAgentPresence('test-agent', def, probes())).toBe(true);
  });

  it('does not treat a MindOS-managed-only config directory as presence', () => {
    // The agent dir holds nothing but the config MindOS wrote with `mindos` as the only server.
    mkdirSync(join(home, '.test-agent'), { recursive: true });
    writeFileSync(join(home, '.test-agent', 'config.json'), JSON.stringify({ mcpServers: { mindos: { command: 'mindos' } } }), 'utf-8');
    expect(detectAgentPresence('test-agent', { ...def, global: '~/.test-agent/config.json' }, probes())).toBe(false);

    // A real second server flips it to present.
    writeFileSync(join(home, '.test-agent', 'config.json'), JSON.stringify({ mcpServers: { mindos: {}, other: {} } }), 'utf-8');
    resetAgentPresenceCacheForTests();
    expect(detectAgentPresence('test-agent', { ...def, global: '~/.test-agent/config.json' }, probes())).toBe(true);
  });
});
