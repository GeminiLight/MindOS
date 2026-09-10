import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_AGENTS as CLI_MCP_AGENTS, SKILL_AGENT_REGISTRY as CLI_SKILL_REGISTRY } from '../packages/mindos/bin/lib/mcp-agents.js';
import {
  DEFAULT_MCP_AGENTS,
  DEFAULT_SKILL_AGENT_REGISTRY,
  listDownstreamAgentDefs,
} from '../packages/mindos/src/agent/config/registry';
import { SKILL_AGENT_REGISTRY as WEB_SKILL_REGISTRY } from '../packages/web/lib/mcp-agent-registry';
import { MCP_AGENTS as WEB_MCP_AGENTS } from '../packages/web/lib/mcp-agents';
import { AGENT_DESCRIPTORS } from '../packages/mindos/src/agent/runtime/agent-descriptor-table';

/**
 * Repo contract: the MCP agent registry has ONE source — core
 * `src/agent/config/registry.ts`. The CLI copy is generated: importing
 * `bin/lib/mcp-agents.js` loads `bin/lib/generated/agent-config.mjs` (esbuild
 * bundle of `src/agent/config/index.ts`, rebuilt on demand by
 * `bin/lib/agent-config.js`), so these tests assert DERIVATION from the core
 * table instead of pinning hand-copied literals (spec-agent-config-adapter).
 */

const root = resolve(__dirname, '..');

describe('MCP agent registry derivation (CLI bundle vs core)', () => {
  it('registers exactly the core downstream agents (core registry minus the mindos self row)', () => {
    // Deep equality over EVERY field (paths, keys, formats, presence probes):
    // a stale generated bundle or a core edit that skipped regeneration fails here.
    expect(CLI_MCP_AGENTS).toEqual(listDownstreamAgentDefs(DEFAULT_MCP_AGENTS));
    expect(Object.keys(CLI_MCP_AGENTS)).not.toContain('mindos');
  });

  it('keeps the skill-install registry identical across CLI, core and web', () => {
    expect(CLI_SKILL_REGISTRY).toEqual(DEFAULT_SKILL_AGENT_REGISTRY);
    expect(WEB_SKILL_REGISTRY).toEqual(DEFAULT_SKILL_AGENT_REGISTRY);
    expect(Object.keys(DEFAULT_SKILL_AGENT_REGISTRY).sort()).toEqual(Object.keys(CLI_MCP_AGENTS).sort());
  });

  it('keeps the web registry equal to the core table', () => {
    expect(WEB_MCP_AGENTS).toEqual(DEFAULT_MCP_AGENTS);
  });

  it('defaults the http transport URL to 127.0.0.1 in the single shared entry builder', () => {
    // localhost may resolve to ::1 first on some Windows stacks while the MCP server binds IPv4.
    const entryBuilder = readFileSync(resolve(root, 'packages/mindos/src/agent/config/entry.ts'), 'utf-8');
    expect(entryBuilder).toContain('http://127.0.0.1:${port}/mcp');
    expect(entryBuilder).not.toContain('http://localhost:');

    // The CLI install flow delegates to that builder instead of spelling a URL.
    const cliInstall = readFileSync(resolve(root, 'packages/mindos/bin/lib/mcp-install.js'), 'utf-8');
    expect(cliInstall).toContain('defaultMindosMcpUrl');
    expect(cliInstall).toContain('buildMindosMcpServerEntry');
    expect(cliInstall).not.toContain('http://localhost:');

    const coreInstall = readFileSync(resolve(root, 'packages/mindos/src/server/handlers/mcp-install.ts'), 'utf-8');
    expect(coreInstall).toContain('buildMindosMcpServerEntry');
    expect(coreInstall).not.toContain('http://localhost:');
  });
});

/**
 * The ACP descriptor table is the single source of truth for launch/detection
 * metadata; the MCP registry owns the MCP config paths. Agents known to both
 * must agree on at least one home-style (`~/…`) presence directory, so a moved
 * config home cannot land in one table only. Compared against the CORE
 * registry — the CLI and web copies derive from it (asserted above).
 */
const ACP_ID_TO_MCP_KEY: Record<string, string> = {
  'claude': 'claude-code',
  'gemini': 'gemini-cli',
  'codebuddy-code': 'codebuddy',
  'kimi': 'kimi-cli',
  'qwen-code': 'qwen-code',
  'auggie': 'augment',
  'openclaw': 'openclaw',
  'cursor': 'cursor',
  'cline': 'cline',
  'codex-acp': 'codex',
  'lingma': 'lingma',
};

/** Windows builds Code-relative paths (`Code/User/…`); a tail match is the same directory. */
function samePresenceDir(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/');
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function overlaps(homeDirs: string[], registryDirs: string[] | undefined): boolean {
  return homeDirs.some((dir) => (registryDirs ?? []).some((candidate) => samePresenceDir(dir, candidate)));
}

describe('presenceDirs parity (ACP descriptor table vs core MCP registry)', () => {
  it('shares a home-style presence dir for every agent known to both tables', () => {
    for (const [acpId, mcpKey] of Object.entries(ACP_ID_TO_MCP_KEY)) {
      const descriptor = AGENT_DESCRIPTORS[acpId];
      expect(descriptor, `ACP descriptor ${acpId}`).toBeDefined();
      const homeDirs = (descriptor?.presenceDirs ?? []).filter((dir) => dir.startsWith('~/'));
      expect(homeDirs.length, `${acpId} declares no ~/ presence dir`).toBeGreaterThan(0);

      const core = (DEFAULT_MCP_AGENTS as Record<string, { presenceDirs?: string[] }>)[mcpKey];
      expect(core, `core MCP registry entry ${mcpKey}`).toBeDefined();
      expect(
        overlaps(homeDirs, core?.presenceDirs),
        `presenceDirs drift between ACP descriptor ${acpId} and core MCP registry ${mcpKey}`,
      ).toBe(true);

      const web = WEB_MCP_AGENTS[mcpKey];
      expect(web, `web MCP registry entry ${mcpKey}`).toBeDefined();
      expect(
        overlaps(homeDirs, web?.presenceDirs),
        `presenceDirs drift between ACP descriptor ${acpId} and web MCP registry ${mcpKey}`,
      ).toBe(true);
    }
  });
});
