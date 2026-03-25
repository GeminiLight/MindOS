import { describe, expect, it } from 'vitest';
import type { AgentInfo, SkillInfo } from '@/components/settings/types';
import {
  createBulkSkillTogglePlan,
  filterSkillsForWorkspace,
  resolveMatrixAgents,
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
