import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ALIASES,
  AGENT_DESCRIPTORS,
  getDescriptorAliases,
  getDescriptorPackageName,
  packageNameFromInstallCmd,
  resolveAlias,
} from './agent-descriptor-table.js';
import { NATIVE_RUNTIME_DEFINITIONS, matchesNativeRuntime, nativeRuntimeIdForAgent } from './native-runtimes.js';
import { nativeDescriptor } from './descriptors.js';
import { isClaudeAgent, isCodexAgent } from './detection.js';
import { buildAgentRuntimesPayload, nativeRuntimeDefinitions } from './registry.js';
import { getDetectableAgents } from '../../protocols/acp/agent-descriptors.js';
import { getAcpAgents } from '../../protocols/acp/registry.js';

/**
 * Consumer walk: every module that used to carry its own copy of descriptor
 * facts (native definitions, alias sets, `packageName` regex, curated names)
 * is checked against the table here. Adding an agent means editing
 * `AGENT_DESCRIPTORS` / `AGENT_ALIASES` and nothing else; adding a consumer
 * with a hand copy means adding it to this walk.
 */

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(runtimeDir, '..', '..');

function read(relativeToSrc: string): string {
  return readFileSync(resolve(srcDir, relativeToSrc), 'utf-8');
}

describe('agent descriptor table', () => {
  it('derives packageName from installCmd in exactly one place', () => {
    expect(packageNameFromInstallCmd('npm install -g @openai/codex')).toBe('@openai/codex');
    expect(packageNameFromInstallCmd('npm install -g cline')).toBe('cline');
    expect(packageNameFromInstallCmd('pip install goose-ai')).toBeUndefined();
    expect(packageNameFromInstallCmd(undefined)).toBeUndefined();
    expect(packageNameFromInstallCmd('   ')).toBeUndefined();
    expect(getDescriptorPackageName('codex')).toBe('@openai/codex');
    expect(getDescriptorPackageName('goose')).toBeUndefined();
    expect(getDescriptorPackageName('does-not-exist')).toBeUndefined();
  });

  it('lists the canonical id plus every alias pointing at it', () => {
    expect(getDescriptorAliases('codex-acp')).toEqual(['codex-acp', 'codex']);
    expect(getDescriptorAliases('claude')).toEqual(['claude', 'claude-code', 'claude-acp']);
    expect(getDescriptorAliases('gemini')).toEqual(['gemini', 'gemini-cli']);
    // Non-canonical input resolves first so callers can pass any alias.
    expect(getDescriptorAliases('codex')).toEqual(['codex-acp', 'codex']);
    expect(getDescriptorAliases('unknown-agent')).toEqual(['unknown-agent']);
    for (const [alias, canonical] of Object.entries(AGENT_ALIASES)) {
      expect(AGENT_DESCRIPTORS[canonical], `alias ${alias} points at a missing descriptor`).toBeDefined();
      expect(resolveAlias(alias)).toBe(canonical);
      expect(getDescriptorAliases(canonical)).toContain(alias);
    }
  });

  it('feeds the built-in ACP registry from the table (name, description, command, packageName)', async () => {
    const registry = await getAcpAgents();
    for (const [id, descriptor] of Object.entries(AGENT_DESCRIPTORS)) {
      const entry = registry.find((candidate) => candidate.id === id);
      expect(entry, `registry entry for ${id}`).toBeDefined();
      expect(entry).toMatchObject({
        name: descriptor.displayName ?? id,
        command: descriptor.cmd,
        args: descriptor.args,
      });
      expect(entry?.packageName).toBe(packageNameFromInstallCmd(descriptor.installCmd));
    }
  });

  it('feeds local detection from the table (binary, detectCommands, presenceDirs, installCmd)', () => {
    const detectable = getDetectableAgents();
    for (const [id, descriptor] of Object.entries(AGENT_DESCRIPTORS)) {
      const agent = detectable.find((candidate) => candidate.id === id);
      expect(agent, `detectable agent ${id}`).toMatchObject({
        name: descriptor.displayName ?? id,
        binary: descriptor.binary,
        source: 'descriptor',
      });
      expect(agent?.detectCommands).toEqual(descriptor.detectCommands);
      expect(agent?.presenceDirs).toEqual(descriptor.presenceDirs);
      expect(agent?.installCmd).toEqual(descriptor.installCmd);
    }
  });

  it('derives both native runtime definitions from their ACP descriptors', () => {
    expect(NATIVE_RUNTIME_DEFINITIONS.map((definition) => definition.runtime)).toEqual(['codex', 'claude']);
    expect(NATIVE_RUNTIME_DEFINITIONS.map((definition) => definition.id)).toEqual(['codex-acp', 'claude']);
    expect(nativeRuntimeDefinitions).toBe(NATIVE_RUNTIME_DEFINITIONS);
    for (const definition of NATIVE_RUNTIME_DEFINITIONS) {
      const descriptor = AGENT_DESCRIPTORS[definition.id];
      expect(descriptor, `descriptor ${definition.id} for native ${definition.runtime}`).toBeDefined();
      expect(definition).toMatchObject({
        name: descriptor.displayName,
        command: descriptor.binary,
        installCmd: descriptor.installCmd,
        packageName: packageNameFromInstallCmd(descriptor.installCmd),
        presenceDirs: descriptor.presenceDirs,
      });
      expect(definition.aliases).toEqual(Array.from(new Set([...getDescriptorAliases(definition.id), definition.runtime])));
    }
  });

  it('matches native agents by every table alias and keeps the name heuristic', () => {
    const [codex, claude] = NATIVE_RUNTIME_DEFINITIONS;
    for (const alias of getDescriptorAliases('codex-acp')) {
      expect(isCodexAgent({ id: alias, name: 'anything' }), alias).toBe(true);
      expect(isClaudeAgent({ id: alias, name: 'anything' }), alias).toBe(false);
      expect(nativeRuntimeIdForAgent({ id: alias, name: 'anything' })).toBe('codex');
    }
    for (const alias of getDescriptorAliases('claude')) {
      expect(isClaudeAgent({ id: alias, name: 'anything' }), alias).toBe(true);
      expect(isCodexAgent({ id: alias, name: 'anything' }), alias).toBe(false);
      expect(nativeRuntimeIdForAgent({ id: alias, name: 'anything' })).toBe('claude');
    }
    expect(matchesNativeRuntime({ id: 'my-wrapper', name: 'Codex Wrapper' }, codex)).toBe(true);
    expect(matchesNativeRuntime({ id: 'my-wrapper', name: 'Claude Bridge' }, claude)).toBe(true);
    expect(nativeRuntimeIdForAgent({ id: 'gemini', name: 'Gemini CLI' })).toBeNull();
  });

  it('builds native descriptors from the definition (aliases, mcpAgentKey, name, install metadata)', () => {
    for (const definition of NATIVE_RUNTIME_DEFINITIONS) {
      const descriptor = nativeDescriptor({
        id: definition.runtime,
        name: definition.name,
        checkedAt: '2026-09-10T00:00:00.000Z',
        missing: {
          id: definition.id,
          name: definition.name,
          installCmd: definition.installCmd,
          packageName: definition.packageName,
        },
      });
      expect(descriptor.aliases).toEqual(definition.aliases);
      expect(descriptor.mcpAgentKey).toBe(definition.mcpAgentKey);
      expect(descriptor.description).toBe(definition.description);
      expect(descriptor.installCmd).toBe(definition.installCmd);
      expect(descriptor.packageName).toBe(definition.packageName);
      expect(descriptor.availability?.diagnosticHints?.join('\n')).toContain(definition.command);
    }
  });

  it('routes detected agents to native descriptors through the definitions, not hand-written ids', () => {
    const payload = buildAgentRuntimesPayload({
      checkedAt: '2026-09-10T00:00:00.000Z',
      installed: [
        { id: 'codex', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
        { id: 'claude-acp', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', status: 'available' },
        { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' },
      ],
      notInstalled: [],
    });
    expect(payload.runtimes.map((runtime) => runtime.id)).toEqual(['mindos', 'codex', 'claude', 'gemini']);
    expect(payload.runtimes.find((runtime) => runtime.id === 'codex')?.sourceAgentId).toBe('codex');
    expect(payload.runtimes.find((runtime) => runtime.id === 'claude')?.sourceAgentId).toBe('claude-acp');
    expect(payload.runtimes.find((runtime) => runtime.id === 'gemini')?.kind).toBe('acp');
  });

  it('leaves no second copy of the packageName regex or native alias literals in the consumers', () => {
    const consumers = [
      'protocols/acp/agent-descriptors.ts',
      'protocols/acp/registry.ts',
      'protocols/acp/detect-local.ts',
      'agent/runtime/registry.ts',
      'agent/runtime/detection.ts',
      'agent/runtime/descriptors.ts',
      'agent/runtime/native-runtimes.ts',
      'server/handlers/agent-runtimes.ts',
    ];
    for (const consumer of consumers) {
      const source = read(consumer);
      expect(source, `${consumer} re-derives packageName`).not.toMatch(/npm install -g \(\.\+\)/);
    }
    for (const consumer of ['agent/runtime/registry.ts', 'agent/runtime/detection.ts', 'agent/runtime/descriptors.ts']) {
      const source = read(consumer);
      expect(source, `${consumer} hard-codes a native alias`).not.toMatch(/'codex-acp'|'claude-code'|'claude-acp'|npm install -g/);
    }
    expect(read('agent/runtime/descriptors.ts')).not.toMatch(/input\.id === 'codex'/);
    // The regex has exactly one home.
    expect(read('agent/runtime/agent-descriptor-table.ts')).toMatch(/npm install -g/);
    expect(join(srcDir, 'agent/runtime/agent-descriptor-table.ts')).toBeTruthy();
  });
});
