import { describe, expect, it } from 'vitest';
import type { AgentInfo, SkillInfo } from '@/components/settings/types';
import {
  aggregateCrossAgentMcpServers,
  aggregateCrossAgentSkills,
  buildMcpRiskQueue,
  createBulkSkillTogglePlan,
  filterAgentsForMcpWorkspace,
  filterSkillsForAgentDetail,
  filterSkillsForWorkspace,
  resolveMatrixAgents,
  summarizeMcpBulkReconnectResults,
  summarizeBulkSkillToggleResults,
} from '@/components/agents/agents-content-model';

const skills: SkillInfo[] = [
  { name: 'mindos', description: 'memory ops', path: '/skills/mindos', source: 'builtin', enabled: true, editable: false },
  { name: 'project-wiki', description: 'docs write helper', path: '/skills/project-wiki', source: 'user', enabled: false, editable: true },
  { name: 'deploy-ci', description: 'ops ci deploy', path: '/skills/deploy-ci', source: 'builtin', enabled: true, editable: false },
];

const agents: AgentInfo[] = [
  {
    key: 'cursor',
    name: 'Cursor',
    present: true,
    installed: true,
    hasProjectScope: true,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: '/tmp/cursor.json',
  },
  {
    key: 'ghost',
    name: 'Ghost',
    present: false,
    installed: false,
    hasProjectScope: false,
    hasGlobalScope: false,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: '/tmp/ghost.json',
  },
];

describe('filterSkillsForWorkspace', () => {
  it('filters by query + source + status on normal path', () => {
    const filtered = filterSkillsForWorkspace(skills, {
      query: 'doc',
      source: 'user',
      status: 'disabled',
      capability: 'all',
    });
    expect(filtered.map((s) => s.name)).toEqual(['project-wiki']);
  });

  it('handles boundary inputs (empty query, all source, all status)', () => {
    const filtered = filterSkillsForWorkspace(skills, {
      query: '',
      source: 'all',
      status: 'all',
      capability: 'all',
    });
    expect(filtered).toHaveLength(3);
  });
});

describe('filterSkillsForAgentDetail', () => {
  it('filters by query and source on normal path', () => {
    const filtered = filterSkillsForAgentDetail(skills, { query: 'deploy', source: 'builtin' });
    expect(filtered.map((s) => s.name)).toEqual(['deploy-ci']);
  });

  it('returns all skills on empty query and all source (boundary path)', () => {
    const filtered = filterSkillsForAgentDetail(skills, { query: '', source: 'all' });
    expect(filtered).toHaveLength(skills.length);
  });

  it('returns empty list for unmatched query (error path)', () => {
    const filtered = filterSkillsForAgentDetail(skills, { query: 'not-exist', source: 'all' });
    expect(filtered).toEqual([]);
  });
});

describe('resolveMatrixAgents', () => {
  it('returns single focused agent on normal path', () => {
    const focused = resolveMatrixAgents(agents, 'cursor');
    expect(focused).toHaveLength(1);
    expect(focused[0]?.key).toBe('cursor');
  });

  it('returns empty array for invalid focus key (error path)', () => {
    const focused = resolveMatrixAgents(agents, 'missing-agent');
    expect(focused).toEqual([]);
  });
});

describe('bulk skill toggle helpers', () => {
  it('creates minimal toggle plan and summarizes partial failure', () => {
    const plan = createBulkSkillTogglePlan(skills, true);
    expect(plan).toEqual(['project-wiki']);

    const summary = summarizeBulkSkillToggleResults([
      { skillName: 'project-wiki', ok: false, reason: 'network error' },
    ]);
    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.total).toBe(1);
  });
});

describe('MCP workspace model helpers', () => {
  it('filters agents by query + status + transport (normal path)', () => {
    const filtered = filterAgentsForMcpWorkspace(
      [
        { ...agents[0], transport: 'stdio' },
        { ...agents[1], transport: 'http' },
      ],
      { query: 'cur', status: 'connected', transport: 'stdio' },
    );
    expect(filtered.map((a) => a.key)).toEqual(['cursor']);
  });

  it('keeps all agents on boundary all-filters', () => {
    const filtered = filterAgentsForMcpWorkspace(
      [
        { ...agents[0], transport: 'stdio' },
        { ...agents[1], transport: undefined },
      ],
      { query: '', status: 'all', transport: 'all' },
    );
    expect(filtered).toHaveLength(2);
  });

  it('returns stable summary for empty reconnect results (error path)', () => {
    const summary = summarizeMcpBulkReconnectResults([]);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('builds risk queue from mcp running state and buckets', () => {
    const queue = buildMcpRiskQueue({
      mcpRunning: false,
      detectedCount: 2,
      notFoundCount: 1,
    });
    expect(queue.length).toBe(3);
  });
});

describe('aggregateCrossAgentMcpServers', () => {
  it('aggregates servers across agents (normal path)', () => {
    const result = aggregateCrossAgentMcpServers([
      { ...agents[0], configuredMcpServers: ['mindos', 'github'] } as AgentInfo,
      { ...agents[1], configuredMcpServers: ['mindos', 'slack'] } as AgentInfo,
    ]);
    expect(result.find((s) => s.serverName === 'mindos')?.agents).toHaveLength(2);
    expect(result.find((s) => s.serverName === 'github')?.agents).toHaveLength(1);
    expect(result.find((s) => s.serverName === 'slack')?.agents).toHaveLength(1);
  });

  it('returns empty for agents with no servers (boundary)', () => {
    const result = aggregateCrossAgentMcpServers([
      { ...agents[0], configuredMcpServers: [] } as AgentInfo,
    ]);
    expect(result).toHaveLength(0);
  });

  it('handles undefined configuredMcpServers (error path)', () => {
    const result = aggregateCrossAgentMcpServers([
      { ...agents[0], configuredMcpServers: undefined } as unknown as AgentInfo,
    ]);
    expect(result).toHaveLength(0);
  });
});

describe('aggregateCrossAgentSkills', () => {
  it('aggregates skills across agents (normal path)', () => {
    const result = aggregateCrossAgentSkills([
      { ...agents[0], installedSkillNames: ['mindos', 'custom-a'] } as AgentInfo,
      { ...agents[1], installedSkillNames: ['mindos'] } as AgentInfo,
    ]);
    expect(result.find((s) => s.skillName === 'mindos')?.agents).toHaveLength(2);
    expect(result.find((s) => s.skillName === 'custom-a')?.agents).toHaveLength(1);
  });

  it('returns empty for agents with no skills (boundary)', () => {
    const result = aggregateCrossAgentSkills([
      { ...agents[0], installedSkillNames: [] } as AgentInfo,
    ]);
    expect(result).toHaveLength(0);
  });
});
