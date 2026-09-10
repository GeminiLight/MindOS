import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Repo contract for the generated CLI bundle (spec-agent-config-adapter):
 * `bin/lib` must not contain a hand-copied MCP agent registry or private
 * TOML / YAML / JSONC parsers — those live once in `src/agent/config/` and
 * reach the CLI through `bin/lib/generated/agent-config.mjs`, which
 * `scripts/build-cli-bundles.mjs` produces and `bin/lib/agent-config.js`
 * rebuilds on demand inside a monorepo checkout.
 */

const root = resolve(__dirname, '..', '..');
const binLib = resolve(root, 'packages', 'mindos', 'bin', 'lib');
const bundlePath = resolve(binLib, 'generated', 'agent-config.mjs');

beforeAll(async () => {
  // Importing the loader triggers the on-demand rebuild when the bundle is
  // missing or older than src/agent/config (fresh checkout without build).
  const { ensureAgentConfigBundle } = await import('../../packages/mindos/bin/lib/agent-config.js');
  ensureAgentConfigBundle();
});

function readBinLib(name: string): string {
  return readFileSync(resolve(binLib, name), 'utf-8');
}

describe('generated agent-config bundle', () => {
  it('exists after the loader runs and is up to date with the sources', async () => {
    expect(existsSync(bundlePath), `${bundlePath} was not produced`).toBe(true);
    const { needsAgentConfigBuild } = await import('../../packages/mindos/bin/lib/agent-config.js');
    expect(needsAgentConfigBuild()).toBe(false);
  });

  it('contains no bare package imports (Bun single-binary contract)', () => {
    const source = readFileSync(bundlePath, 'utf-8');
    // Minified output: match import/export specifiers with or without spaces.
    const specifiers = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((match) => match[1] ?? match[2] ?? match[3])
      .filter((specifier): specifier is string => !!specifier);
    const offenders = specifiers.filter((specifier) => !specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('/'));
    expect(offenders).toEqual([]);
    // jsonc-parser must be inlined, not imported.
    expect(source).not.toMatch(/['"]jsonc-parser['"]/);
  });

  it('exports the surface the bin/lib mirrors destructure', async () => {
    const bundle = (await import('../../packages/mindos/bin/lib/generated/agent-config.mjs')) as Record<string, unknown>;
    for (const name of [
      'DEFAULT_MCP_AGENTS', 'DEFAULT_SKILL_AGENT_REGISTRY', 'listDownstreamAgentDefs',
      'detectAgentPresenceUncached', 'resolveAgentConfigProbes',
      'buildTomlEntry', 'mergeTomlEntry', 'removeTomlEntry', 'listTomlServerNames', 'parseTomlMcpServerEntry',
      'buildYamlEntry', 'mergeYamlEntry', 'removeYamlEntry', 'listYamlServerNames', 'parseYamlMcpServerEntry',
      'parseJsonc', 'parseJsoncDocument', 'setJsoncValue', 'removeJsoncValue', 'stripBom',
      'expandHome', 'configPathCandidates', 'entryLocation', 'readMcpServerEntryFromText',
      'resolveAgentHiddenRoot', 'resolveSkillWorkspaceProfile', 'listInstalledSkillNames',
      'buildMindosMcpServerEntry', 'defaultMindosMcpUrl', 'installAgentConnection',
      'createAgentConfigAdapter', 'writeFileAtomically', 'linkSkillToAgent',
    ]) {
      expect(name in bundle, `bundle is missing export ${name}`).toBe(true);
    }
  });
});

describe('bin/lib mirrors (no hand-copied registries or parsers)', () => {
  it('contains no literal MCP_AGENTS = { registry', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(binLib).filter((file) => file.endsWith('.js'))) {
      if (readBinLib(name).includes('MCP_AGENTS = {')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('contains no private TOML/YAML/JSONC parser implementations', () => {
    const parserMarkers = [
      'function parseTomlMcpEntry', 'function parseYamlMcpEntry',
      'function buildTomlEntry', 'function mergeTomlEntry',
      'function buildYamlEntry', 'function mergeYamlEntry',
      'function parseJsoncDocument', 'function setJsoncValue',
      'function unquoteScalar', 'function parseInlineArray',
    ];
    const offenders: string[] = [];
    for (const name of readdirSync(binLib).filter((file) => file.endsWith('.js'))) {
      const source = readBinLib(name);
      for (const marker of parserMarkers) {
        if (source.includes(marker)) offenders.push(`${name}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(['toml.js', 'yaml.js', 'jsonc.js', 'path-expand.js'])(
    '%s is a short mirror that only takes values from ./agent-config.js',
    (name) => {
      const source = readBinLib(name);
      const lines = source.split('\n').filter((line) => line.trim() !== '');
      expect(lines.length, `${name} should stay a thin mirror`).toBeLessThanOrEqual(30);
      const specifiers = [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
      expect(specifiers).toEqual(['./agent-config.js']);
      expect(source).toContain('await loadAgentConfigBundle()');
    },
  );

  it('mcp-agents.js derives the CLI registry from the bundle', () => {
    const source = readBinLib('mcp-agents.js');
    expect(source).toContain('listDownstreamAgentDefs(DEFAULT_MCP_AGENTS)');
    expect(source).toContain('detectAgentPresenceUncached');
  });
});
