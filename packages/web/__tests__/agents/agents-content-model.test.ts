import { describe, expect, it } from 'vitest';
import type { AgentInfo, SkillInfo } from '@/components/settings/types';
import {
  aggregateCrossAgentMcpServers,
  aggregateCrossAgentSkills,
  buildUnifiedSkillList,
  buildMcpRiskQueue,
  createBulkSkillTogglePlan,
  filterAgentsForMcpWorkspace,
  filterSkillsForAgentDetail,
  filterSkillsForWorkspace,
  getAgentsNavGroup,
  parseAgentsTab,
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

describe('parseAgentsTab', () => {
  it('accepts canonical IA tabs and falls back for unknown tabs', () => {
    expect(parseAgentsTab('assistant')).toBe('assistant');
    expect(parseAgentsTab('agent')).toBe('agent');
    expect(parseAgentsTab('capabilities')).toBe('capabilities');
    expect(parseAgentsTab('runs')).toBe('runs');
    expect(parseAgentsTab('unknown')).toBe('overview');
    expect(parseAgentsTab(undefined)).toBe('overview');
  });

  it('keeps legacy deep tabs parseable for existing links', () => {
    expect(parseAgentsTab('presets')).toBe('presets');
    expect(parseAgentsTab('mcp')).toBe('mcp');
    expect(parseAgentsTab('skills')).toBe('skills');
    expect(parseAgentsTab('channels')).toBe('channels');
    expect(parseAgentsTab('a2a')).toBe('a2a');
    expect(parseAgentsTab('sessions')).toBe('sessions');
    expect(parseAgentsTab('activity')).toBe('activity');
  });

  it('groups legacy tabs under the five visible IA entries and keeps logs auxiliary', () => {
    expect(getAgentsNavGroup('overview')).toBe('overview');
    expect(getAgentsNavGroup('assistant')).toBe('assistant');
    expect(getAgentsNavGroup('presets')).toBe('assistant');
    expect(getAgentsNavGroup('agent')).toBe('agent');
    expect(getAgentsNavGroup('a2a')).toBe('agent');
    expect(getAgentsNavGroup('capabilities')).toBe('capabilities');
    expect(getAgentsNavGroup('skills')).toBe('capabilities');
    expect(getAgentsNavGroup('mcp')).toBe('capabilities');
    expect(getAgentsNavGroup('channels')).toBe('channels');
    expect(getAgentsNavGroup('runs')).toBe('overview');
    expect(getAgentsNavGroup('sessions')).toBe('overview');
    expect(getAgentsNavGroup('activity')).toBe('overview');
  });
});

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

  it('builds risk queue from mcp running state and buckets (notFound excluded)', () => {
    const queue = buildMcpRiskQueue({
      mcpRunning: false,
      mcpEnabled: true,
      detectedCount: 2,
      notFoundCount: 1,
    });
    expect(queue.length).toBe(2);
  });

  it('omits mcp-stopped risk when mcpEnabled is false', () => {
    const queue = buildMcpRiskQueue({
      mcpRunning: false,
      mcpEnabled: false,
      detectedCount: 2,
      notFoundCount: 1,
    });
    // Only detected-unconfigured, no mcp-stopped
    expect(queue.length).toBe(1);
    expect(queue[0].id).toBe('detected-unconfigured');
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
      { ...agents[0], installedSkillNames: ['mindos', 'custom-a'], installedSkillSourcePath: '/tmp/cursor/skills' } as AgentInfo,
      { ...agents[1], installedSkillNames: ['mindos'], installedSkillSourcePath: '/tmp/ghost/skills' } as AgentInfo,
    ]);
    expect(result.find((s) => s.skillName === 'mindos')?.agents).toHaveLength(2);
    expect(result.find((s) => s.skillName === 'mindos')?.sourcePaths).toEqual(['/tmp/cursor/skills', '/tmp/ghost/skills']);
    expect(result.find((s) => s.skillName === 'custom-a')?.agents).toHaveLength(1);
  });

  it('returns empty for agents with no skills (boundary)', () => {
    const result = aggregateCrossAgentSkills([
      { ...agents[0], installedSkillNames: [] } as AgentInfo,
    ]);
    expect(result).toHaveLength(0);
  });
});

describe('buildUnifiedSkillList', () => {
  it('derives availability from where the body lives: shared pool → global, custom path → private, managed → linked/unlinked', () => {
    const result = buildUnifiedSkillList([
      // Body in the universal shared pool — every universal agent sees it.
      { name: 'pool-skill', description: 'Shared', path: '/Users/test/.agents/skills/pool-skill/SKILL.md', source: 'builtin', origin: 'agents-global', enabled: true, editable: false },
      // Body in an agent's own dir registered via a custom path — that agent's private skill.
      { name: 'codex-own', description: 'Codex private', path: '/Users/test/.codex/skills/codex-own/SKILL.md', source: 'builtin', origin: 'custom', enabled: true, editable: false },
      // MindOS-managed bodies: linked when at least one downstream agent has it, otherwise MindOS-only.
      { name: 'taste-skill', description: 'Design taste', path: '/mind/.skills/taste-skill/SKILL.md', source: 'user', origin: 'mindos-user', enabled: true, editable: true },
      { name: 'drafts-only', description: 'Not linked anywhere', path: '/mind/.skills/drafts-only/SKILL.md', source: 'user', origin: 'mindos-user', enabled: true, editable: true },
    ], [
      { skillName: 'pool-skill', agents: ['Cursor', 'Codex'], sourcePaths: ['/Users/test/.agents/skills'] },
      { skillName: 'codex-own', agents: ['Codex'], sourcePaths: ['/Users/test/.codex/skills'] },
      { skillName: 'taste-skill', agents: ['Codex'], sourcePaths: ['/Users/test/.codex/skills'] },
      { skillName: 'native-only', agents: ['Claude Code'], sourcePaths: ['/Users/test/.claude/skills'] },
    ]);

    expect(result.find((skill) => skill.name === 'pool-skill')).toMatchObject({ kind: 'mindos', availability: 'global' });
    expect(result.find((skill) => skill.name === 'codex-own')).toMatchObject({ kind: 'mindos', availability: 'native-private' });
    expect(result.find((skill) => skill.name === 'taste-skill')).toMatchObject({ kind: 'mindos', availability: 'linked', agents: ['Codex'] });
    expect(result.find((skill) => skill.name === 'drafts-only')).toMatchObject({ kind: 'mindos', availability: 'unlinked', agents: [] });
    expect(result.find((skill) => skill.name === 'native-only')).toMatchObject({
      kind: 'native',
      availability: 'native-private',
      agents: ['Claude Code'],
      sourcePath: '/Users/test/.claude/skills',
    });
  });
});
