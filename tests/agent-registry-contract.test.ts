import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_AGENTS as CLI_MCP_AGENTS, SKILL_AGENT_REGISTRY as CLI_SKILL_REGISTRY } from '../packages/mindos/bin/lib/mcp-agents.js';
import { DEFAULT_MCP_AGENTS, DEFAULT_SKILL_AGENT_REGISTRY } from '../packages/mindos/src/server/mcp-agent-registry';
import { SKILL_AGENT_REGISTRY as WEB_SKILL_REGISTRY } from '../packages/web/lib/mcp-agent-registry';
import { MCP_AGENTS as WEB_MCP_AGENTS } from '../packages/web/lib/mcp-agents';
import { AGENT_DESCRIPTORS } from '../packages/mindos/src/agent/runtime/agent-descriptor-table';

/**
 * Repo contract: the MCP agent registry exists three times because the CLI
 * (`bin/lib`, node builtins only for the Bun single-binary build) cannot
 * import `src/`. This test pins the copies to each other so a new agent, a
 * moved config path or a changed format cannot land in one copy only.
 */

const root = resolve(__dirname, '..');

type AgentShape = {
  name: string;
  project: string | null;
  global: string;
  projectReadAlso?: string[];
  globalReadAlso?: string[];
  key: string;
  format?: string;
  globalNestedKey?: string;
  entryStyle?: string;
  skillDir?: string;
  preferredTransport: string;
};

/** Windows registry copies build paths with different separators; compare them as forward-slash paths. */
function normalizePath(value: string | null | undefined): string | null | undefined {
  return typeof value === 'string' ? value.replace(/\\/g, '/') : value;
}

function comparableAgent(agent: AgentShape): Record<string, unknown> {
  return {
    name: agent.name,
    project: normalizePath(agent.project),
    global: normalizePath(agent.global),
    projectReadAlso: agent.projectReadAlso?.map((entry) => normalizePath(entry)),
    globalReadAlso: agent.globalReadAlso?.map((entry) => normalizePath(entry)),
    key: agent.key,
    format: agent.format,
    globalNestedKey: agent.globalNestedKey,
    entryStyle: agent.entryStyle,
    skillDir: normalizePath(agent.skillDir),
    preferredTransport: agent.preferredTransport,
  };
}

describe('MCP agent registry parity (CLI bin/lib vs core vs web)', () => {
  it('registers the same downstream agents in the CLI and the core registry', () => {
    // The `mindos` self entry only exists where the UI renders MindOS as a row.
    const coreKeys = Object.keys(DEFAULT_MCP_AGENTS).filter((key) => key !== 'mindos').sort();
    expect(Object.keys(CLI_MCP_AGENTS).sort()).toEqual(coreKeys);
  });

  it('agrees on config paths, section keys, formats, entry styles and skill dirs for every agent', () => {
    for (const key of Object.keys(CLI_MCP_AGENTS)) {
      const cli = CLI_MCP_AGENTS[key as keyof typeof CLI_MCP_AGENTS] as AgentShape;
      const core = DEFAULT_MCP_AGENTS[key] as AgentShape;
      expect(comparableAgent(cli), `registry drift for agent "${key}"`).toEqual(comparableAgent(core));
    }
  });

  it('keeps the skill-install registry identical across CLI, core and web', () => {
    expect(CLI_SKILL_REGISTRY).toEqual(DEFAULT_SKILL_AGENT_REGISTRY);
    expect(WEB_SKILL_REGISTRY).toEqual(DEFAULT_SKILL_AGENT_REGISTRY);
    expect(Object.keys(DEFAULT_SKILL_AGENT_REGISTRY).sort()).toEqual(Object.keys(CLI_MCP_AGENTS).sort());
  });

  it('defaults the http transport URL to 127.0.0.1 in both the CLI and the core installer', () => {
    const cliInstall = readFileSync(resolve(root, 'packages/mindos/bin/lib/mcp-install.js'), 'utf-8');
    const coreInstall = readFileSync(resolve(root, 'packages/mindos/src/server/handlers/mcp-install.ts'), 'utf-8');
    // localhost may resolve to ::1 first on some Windows stacks while the MCP server binds IPv4.
    expect(cliInstall).toContain('http://127.0.0.1:${mcpPort}/mcp');
    expect(cliInstall).not.toContain('http://localhost:${mcpPort}/mcp');
    expect(coreInstall).toContain('http://127.0.0.1:${fallbackPort}/mcp');
    expect(coreInstall).not.toContain('http://localhost:');
  });
});

/**
 * The ACP descriptor table is the single source of truth for launch/detection
 * metadata; the MCP registries are keyed by MCP agent key and own the MCP
 * config paths. Agents known to both must agree on at least one home-style
 * (`~/…`) presence directory, so a moved config home cannot land in one table
 * only. The CLI `bin/lib` copy cannot import `src/`, which is why this stays a
 * parity contract instead of a derivation.
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

describe('presenceDirs parity (ACP descriptor table vs CLI/web MCP registries)', () => {
  it('shares a home-style presence dir for every agent known to both tables', () => {
    for (const [acpId, mcpKey] of Object.entries(ACP_ID_TO_MCP_KEY)) {
      const descriptor = AGENT_DESCRIPTORS[acpId];
      expect(descriptor, `ACP descriptor ${acpId}`).toBeDefined();
      const homeDirs = (descriptor?.presenceDirs ?? []).filter((dir) => dir.startsWith('~/'));
      expect(homeDirs.length, `${acpId} declares no ~/ presence dir`).toBeGreaterThan(0);

      const cli = (CLI_MCP_AGENTS as Record<string, { presenceDirs?: string[] }>)[mcpKey];
      expect(cli, `CLI MCP registry entry ${mcpKey}`).toBeDefined();
      expect(
        overlaps(homeDirs, cli?.presenceDirs),
        `presenceDirs drift between ACP descriptor ${acpId} and CLI MCP registry ${mcpKey}`,
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
