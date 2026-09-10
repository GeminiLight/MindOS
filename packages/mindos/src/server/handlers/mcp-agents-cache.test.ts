import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Both the counters and the mock factory live in ONE vi.hoisted scope: vitest
// hoists `vi.mock` above the imports, and the factory closes over `counters`,
// so they must be initialised together before `node:fs` is first imported.
const { counters, fsMockFactory } = vi.hoisted(() => {
  const counters = { readFileSync: 0, statSync: 0, readdirSync: 0 };
  const fsMockFactory = async (importOriginal: () => Promise<unknown>) => {
    const actual = await importOriginal() as typeof import('node:fs');
    const count = <A extends unknown[], R>(fn: (...args: A) => R, key: keyof typeof counters) =>
      (...args: A): R => {
        counters[key] += 1;
        return fn(...args);
      };
    return {
      ...actual,
      readFileSync: count(actual.readFileSync, 'readFileSync'),
      statSync: count(actual.statSync, 'statSync'),
      readdirSync: count(actual.readdirSync, 'readdirSync'),
    };
  };
  return { counters, fsMockFactory };
});

vi.mock('node:fs', fsMockFactory);
vi.mock('fs', fsMockFactory);

const { handleMcpAgentsGet } = await import('./mcp-agents.js');
const { DEFAULT_MCP_AGENTS, DEFAULT_SKILL_AGENT_REGISTRY } = await import('../../agent/config/registry.js');
const { resetAgentPresenceCacheForTests } = await import('../../agent/config/presence.js');
const { resetAgentConfigReadCacheForTests } = await import('../../agent/config/config-read.js');

let home: string;

/** A few agents with real config files on disk and no presenceCli (so no `which` spawn). */
const agents = {
  mindos: DEFAULT_MCP_AGENTS.mindos!,
  'claude-code': { ...DEFAULT_MCP_AGENTS['claude-code']!, presenceCli: undefined },
  codex: { ...DEFAULT_MCP_AGENTS.codex!, presenceCli: undefined },
  hermes: { ...DEFAULT_MCP_AGENTS.hermes!, presenceCli: undefined },
};

function seedConfigs(): void {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { mindos: { command: 'mindos', args: ['mcp'] } } }), 'utf-8');
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), 'model = "o3"\n\n[mcp_servers.mindos]\ncommand = "mindos"\n', 'utf-8');
  mkdirSync(join(home, '.hermes'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'config.yaml'), 'mcp_servers:\n  mindos:\n    command: mindos\n', 'utf-8');
}

async function request() {
  const before = { ...counters };
  const response = await handleMcpAgentsGet({
    agents,
    skillAgentRegistry: DEFAULT_SKILL_AGENT_REGISTRY,
    homeDir: home,
    now: () => new Date(1700000000000),
    fetchHead: async () => ({ status: 200 }),
  });
  expect(response.status).toBe(200);
  return {
    readFileSync: counters.readFileSync - before.readFileSync,
    statSync: counters.statSync - before.statSync,
    readdirSync: counters.readdirSync - before.readdirSync,
  };
}

beforeEach(() => {
  resetAgentPresenceCacheForTests();
  resetAgentConfigReadCacheForTests();
  counters.readFileSync = 0;
  counters.statSync = 0;
  counters.readdirSync = 0;
  home = mkdtempSync(join(tmpdir(), 'mcp-agents-cache-'));
  seedConfigs();
});

afterEach(() => {
  resetAgentPresenceCacheForTests();
  resetAgentConfigReadCacheForTests();
  rmSync(home, { recursive: true, force: true });
});

describe('GET /api/mcp/agents caching (audit P2-1)', () => {
  it('returns the same payload on a warm request', async () => {
    const opts = { agents, skillAgentRegistry: DEFAULT_SKILL_AGENT_REGISTRY, homeDir: home, commandExists: () => false, now: () => new Date(1700000000000), fetchHead: async () => ({ status: 200 }) };
    const cold = await handleMcpAgentsGet(opts);
    const warm = await handleMcpAgentsGet(opts);
    expect(warm.body).toEqual(cold.body);
  });

  it('re-reads no agent config file on the second request (config-read memo)', async () => {
    const cold = await request();
    const warm = await request();

    // Cold request parses each seeded config at least once.
    expect(cold.readFileSync).toBeGreaterThan(0);
    // Warm request re-validates with stat but re-reads only the tiny MindOS
    // self config (~/.mindos/mcp.json, absent here) — never the agent configs.
    expect(warm.readFileSync).toBe(0);
    expect(warm.statSync).toBeGreaterThan(0);
  });

  it('does not walk each agent home with a deep runtime-signal BFS', async () => {
    const cold = await request();
    // The only readdirSync calls are the (missing) skill-workspace listings and
    // the presence scan of the two seeded agent dirs — never a 300-entry BFS.
    expect(cold.readdirSync).toBeLessThan(20);
  });
});
