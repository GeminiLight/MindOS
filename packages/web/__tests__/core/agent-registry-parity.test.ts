import { describe, expect, it } from 'vitest';
import { DEFAULT_MCP_AGENTS, DEFAULT_SKILL_AGENT_REGISTRY } from '@geminilight/mindos/server';
import { MCP_AGENTS } from '@/lib/mcp-agents';
import { SKILL_AGENT_REGISTRY } from '@/lib/mcp-agent-registry';

/**
 * The Web keeps its own copy of the MCP agent registry (platform paths are
 * computed at module load for the Web process). Pin it to the core registry
 * so a new agent or a moved config path cannot land on one side only; the
 * CLI copy is pinned by tests/agent-registry-contract.test.ts.
 */

function normalizePath(value: string | null | undefined): string | null | undefined {
  return typeof value === 'string' ? value.replace(/\\/g, '/') : value;
}

function comparable(agent: (typeof MCP_AGENTS)[string]) {
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
    presenceCli: agent.presenceCli,
  };
}

describe('Web MCP agent registry parity with the core registry', () => {
  it('registers exactly the same agent keys', () => {
    expect(Object.keys(MCP_AGENTS).sort()).toEqual(Object.keys(DEFAULT_MCP_AGENTS).sort());
  });

  it('agrees on config paths, formats, entry styles, skill dirs and presence CLIs', () => {
    for (const key of Object.keys(MCP_AGENTS)) {
      expect(comparable(MCP_AGENTS[key]), `registry drift for agent "${key}"`)
        .toEqual(comparable(DEFAULT_MCP_AGENTS[key] as (typeof MCP_AGENTS)[string]));
    }
  });

  it('keeps the skill registry identical', () => {
    expect(SKILL_AGENT_REGISTRY).toEqual(DEFAULT_SKILL_AGENT_REGISTRY);
  });
});
