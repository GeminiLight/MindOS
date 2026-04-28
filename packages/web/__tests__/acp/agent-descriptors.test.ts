import { describe, it, expect } from 'vitest';
import {
  resolveAgentCommand,
  parseAcpAgentOverrides,
  findUserOverride,
  AGENT_DESCRIPTORS,
  AGENT_ALIASES,
  resolveAlias,
  getDescriptorBinary,
  getDescriptorInstallCmd,
  getDetectableAgents,
} from '@/lib/acp/agent-descriptors';
import type { AcpRegistryEntry } from '@/lib/acp/types';

/* ── resolveAgentCommand ─────────────────────────────────────────────── */

describe('resolveAgentCommand', () => {
  const fakeRegistry: AcpRegistryEntry = {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    transport: 'npx',
    command: '@test/agent',
    args: ['--flag'],
  };

  it('uses user override when command is set', () => {
    const result = resolveAgentCommand('gemini', fakeRegistry, { command: '/custom/gemini', args: ['--my-flag'] });
    expect(result.source).toBe('user-override');
    expect(result.cmd).toBe('/custom/gemini');
    expect(result.args).toEqual(['--my-flag']);
    expect(result.enabled).toBe(true);
  });

  it('uses user override args with descriptor command', () => {
    const result = resolveAgentCommand('gemini', fakeRegistry, { args: ['--custom-flag'] });
    expect(result.source).toBe('user-override');
    expect(result.cmd).toBe('gemini'); // from descriptor
    expect(result.args).toEqual(['--custom-flag']);
  });

  it('falls back to descriptor when no override', () => {
    const result = resolveAgentCommand('gemini', fakeRegistry);
    expect(result.source).toBe('descriptor');
    expect(result.cmd).toBe('gemini');
    expect(result.args).toEqual(['--experimental-acp']);
  });

  it('falls back to registry for unknown agent', () => {
    const result = resolveAgentCommand('unknown-agent', fakeRegistry);
    expect(result.source).toBe('registry');
    expect(result.cmd).toBe('npx');
    expect(result.args).toEqual(['--yes', '@test/agent', '--flag']);
  });

  it('falls back to agentId when nothing matches', () => {
    const result = resolveAgentCommand('totally-unknown');
    expect(result.source).toBe('registry');
    expect(result.cmd).toBe('totally-unknown');
    expect(result.args).toEqual([]);
  });

  it('respects enabled=false', () => {
    const result = resolveAgentCommand('gemini', fakeRegistry, { enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('passes through env from user override', () => {
    const result = resolveAgentCommand('gemini', fakeRegistry, { env: { FOO: 'bar' } });
    expect(result.env).toEqual({ FOO: 'bar' });
  });

  it('resolves codebuddy-code correctly', () => {
    const result = resolveAgentCommand('codebuddy-code');
    expect(result.source).toBe('descriptor');
    expect(result.cmd).toBe('codebuddy');
    expect(result.args).toEqual(['--acp']);
  });

  it('resolves claude-acp correctly', () => {
    const result = resolveAgentCommand('claude-acp');
    expect(result.source).toBe('descriptor');
    expect(result.cmd).toBe('npx');
    expect(result.args).toContain('@agentclientprotocol/claude-agent-acp');
  });
});

/* ── parseAcpAgentOverrides ──────────────────────────────────────────── */

describe('parseAcpAgentOverrides', () => {
  it('returns undefined for null', () => {
    expect(parseAcpAgentOverrides(null)).toBeUndefined();
  });

  it('returns undefined for non-object', () => {
    expect(parseAcpAgentOverrides('string')).toBeUndefined();
    expect(parseAcpAgentOverrides(42)).toBeUndefined();
  });

  it('returns undefined for array', () => {
    expect(parseAcpAgentOverrides([])).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    expect(parseAcpAgentOverrides({})).toBeUndefined();
  });

  it('parses valid config with command', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { command: '/usr/local/bin/gemini' } });
    expect(result).toEqual({ 'gemini': { command: '/usr/local/bin/gemini' } });
  });

  it('parses valid config with args', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { args: ['--acp', '--verbose'] } });
    expect(result).toEqual({ 'gemini': { args: ['--acp', '--verbose'] } });
  });

  it('parses enabled=false', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { enabled: false } });
    expect(result).toEqual({ 'gemini': { enabled: false } });
  });

  it('filters non-string args', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { args: ['--ok', 42, null, '--fine'] } });
    expect(result!['gemini'].args).toEqual(['--ok', '--fine']);
  });

  it('parses env vars', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { env: { API_KEY: 'abc' } } });
    expect(result).toEqual({ 'gemini': { env: { API_KEY: 'abc' } } });
  });

  it('skips invalid entries', () => {
    const result = parseAcpAgentOverrides({ 'good': { command: 'x' }, 'bad': 'not-an-object' });
    expect(result).toEqual({ 'good': { command: 'x' } });
  });

  it('trims command whitespace', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { command: '  /usr/bin/gemini  ' } });
    expect(result!['gemini'].command).toBe('/usr/bin/gemini');
  });

  it('ignores empty command', () => {
    const result = parseAcpAgentOverrides({ 'gemini': { command: '   ' } });
    expect(result).toBeUndefined();
  });
});

/* ── Helpers ──────────────────────────────────────────────────────────── */

describe('getDescriptorBinary', () => {
  it('returns binary for known agent', () => {
    expect(getDescriptorBinary('codebuddy-code')).toBe('codebuddy');
    expect(getDescriptorBinary('gemini')).toBe('gemini');
    expect(getDescriptorBinary('claude-acp')).toBe('claude');
  });

  it('returns undefined for unknown agent', () => {
    expect(getDescriptorBinary('nonexistent')).toBeUndefined();
  });
});

describe('getDescriptorInstallCmd', () => {
  it('returns install command for known agent', () => {
    expect(getDescriptorInstallCmd('gemini')).toBe('npm install -g @google/gemini-cli');
  });

  it('returns undefined for agent without install command', () => {
    expect(getDescriptorInstallCmd('cursor')).toBeUndefined();
  });
});

/* ── AGENT_DESCRIPTORS consistency ───────────────────────────────────── */

describe('AGENT_DESCRIPTORS', () => {
  it('all entries have required fields', () => {
    for (const [id, desc] of Object.entries(AGENT_DESCRIPTORS)) {
      expect(desc.binary, `${id} missing binary`).toBeTruthy();
      expect(desc.cmd, `${id} missing cmd`).toBeTruthy();
      expect(Array.isArray(desc.args), `${id} args not array`).toBe(true);
    }
  });

  it('has entries for all critical canonical agents', () => {
    const canonical = ['gemini', 'claude', 'codebuddy-code', 'codex-acp'];
    for (const id of canonical) {
      expect(AGENT_DESCRIPTORS[id], `missing descriptor for ${id}`).toBeDefined();
    }
  });

  it('has no duplicate entries (aliases in AGENT_ALIASES instead)', () => {
    const binaries = Object.values(AGENT_DESCRIPTORS).map(d => d.binary);
    const uniqueBinaries = new Set(binaries);
    expect(binaries.length).toBe(uniqueBinaries.size);
  });
});

/* ── Aliases ──────────────────────────────────────────────────────────── */

describe('resolveAlias', () => {
  it('resolves known aliases to canonical IDs', () => {
    expect(resolveAlias('gemini-cli')).toBe('gemini');
    expect(resolveAlias('claude-code')).toBe('claude');
    expect(resolveAlias('claude-acp')).toBe('claude');
    expect(resolveAlias('codebuddy')).toBe('codebuddy-code');
    expect(resolveAlias('codex')).toBe('codex-acp');
    expect(resolveAlias('pi-acp')).toBe('pi');
  });

  it('returns canonical IDs unchanged', () => {
    expect(resolveAlias('gemini')).toBe('gemini');
    expect(resolveAlias('claude')).toBe('claude');
    expect(resolveAlias('codebuddy-code')).toBe('codebuddy-code');
  });

  it('returns unknown IDs unchanged', () => {
    expect(resolveAlias('totally-unknown')).toBe('totally-unknown');
  });

  it('all aliases point to existing descriptors', () => {
    for (const [alias, canonical] of Object.entries(AGENT_ALIASES)) {
      expect(AGENT_DESCRIPTORS[canonical], `alias ${alias} → ${canonical} not in AGENT_DESCRIPTORS`).toBeDefined();
    }
  });
});

/* ── findUserOverride ────────────────────────────────────────────────── */

describe('findUserOverride', () => {
  const overrides = {
    'gemini': { command: '/usr/bin/gemini' },
    'gemini-cli': { command: '/custom/gemini-cli' },
    'codebuddy': { args: ['--custom'] },
  };

  it('finds by direct ID', () => {
    expect(findUserOverride('gemini', overrides)).toEqual({ command: '/usr/bin/gemini' });
  });

  it('finds by alias → canonical (alias ID in overrides, canonical ID queried)', () => {
    expect(findUserOverride('codebuddy-code', overrides)?.args).toEqual(['--custom']);
  });

  it('finds by canonical → alias (canonical ID in overrides, alias ID queried)', () => {
    expect(findUserOverride('gemini-cli', overrides)).toEqual({ command: '/custom/gemini-cli' });
  });

  it('prefers direct match over alias resolution', () => {
    const result = findUserOverride('gemini', overrides);
    expect(result?.command).toBe('/usr/bin/gemini');
  });

  it('returns undefined for unknown agent', () => {
    expect(findUserOverride('totally-unknown', overrides)).toBeUndefined();
  });

  it('returns undefined when no overrides', () => {
    expect(findUserOverride('gemini', undefined)).toBeUndefined();
  });
});

/* ── getDetectableAgents ─────────────────────────────────────────────── */

describe('getDetectableAgents', () => {
  it('returns all canonical agents', () => {
    const agents = getDetectableAgents();
    expect(agents.length).toBe(Object.keys(AGENT_DESCRIPTORS).length);
  });

  it('each agent has required detection fields', () => {
    for (const agent of getDetectableAgents()) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBeTruthy();
      expect(agent.binary).toBeTruthy();
    }
  });

  it('has no duplicate binaries', () => {
    const agents = getDetectableAgents();
    const binaries = agents.map(a => a.binary);
    const unique = new Set(binaries);
    expect(binaries.length).toBe(unique.size);
  });
});
