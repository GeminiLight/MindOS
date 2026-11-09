import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindosAgentCapabilityRegistryServices } from './capability-registry.js';

/**
 * The capability list must describe the subagents pi-subagents will actually
 * run. pi-subagents reads user agents from `<PI_CODING_AGENT_DIR>/agents` and
 * `~/.agents`; MindOS points that directory at ~/.mindos/pi. Listing the
 * user's own `~/.pi/agent/agents` here advertised agents from another product
 * and disagreed with what the session would execute.
 */

const home = vi.hoisted(() => ({ dir: '' }));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir };
});

const { createAgentCapabilitiesServices } = await import('./capability-registry.js');

function services(): MindosAgentCapabilityRegistryServices {
  return {
    knowledgeBaseTools: [],
    effectiveMindRoot: () => join(home.dir, 'mind'),
    listRuntimeDescriptors: async () => [],
    readMcpConfig: () => ({}),
    readMcpToolCache: () => null,
    getDiscoveredAgents: () => [],
    resolveBuiltinSubagentsDir: () => null,
  };
}

function writeAgent(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), ['---', `name: ${name}`, `description: ${name} agent`, '---', '', 'body'].join('\n'));
}

async function userAgentNames(): Promise<string[]> {
  const caps = await createAgentCapabilitiesServices(services()).subagents();
  return caps.filter((cap) => cap.id.startsWith('pi-subagent:user:')).map((cap) => cap.id).sort();
}

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'mindos-subagent-home-'));
});

afterEach(() => {
  rmSync(home.dir, { recursive: true, force: true });
});

describe('user subagent discovery', () => {
  it('lists subagents kept in the MindOS-owned Pi directory', async () => {
    writeAgent(join(home.dir, '.mindos', 'pi', 'agents'), 'reviewer');

    expect(await userAgentNames()).toEqual(['pi-subagent:user:reviewer']);
  });

  it('does not list subagents from the user\'s own Pi installation', async () => {
    writeAgent(join(home.dir, '.pi', 'agent', 'agents'), 'their-pi-agent');

    expect(await userAgentNames()).toEqual([]);
  });

  it('still lists ~/.agents, which pi-subagents itself reads and MindOS cannot redirect', async () => {
    writeAgent(join(home.dir, '.agents'), 'shared');

    expect(await userAgentNames()).toEqual(['pi-subagent:user:shared']);
  });

  it('lists nothing when no user directory exists', async () => {
    expect(await userAgentNames()).toEqual([]);
  });
});
