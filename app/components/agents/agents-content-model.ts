import type { AgentInfo, SkillInfo } from '@/components/settings/types';

export type AgentsDashboardTab = 'overview' | 'mcp' | 'skills';
export type AgentResolvedStatus = 'connected' | 'detected' | 'notFound';
export type SkillCapability = 'research' | 'coding' | 'docs' | 'ops' | 'memory';
export type SkillSourceFilter = 'all' | 'builtin' | 'user';
export type AgentStatusFilter = 'all' | 'connected' | 'detected' | 'notFound';

export interface RiskItem {
  id: string;
  severity: 'warn' | 'error';
  title: string;
}

export interface AgentBuckets {
  connected: AgentInfo[];
  detected: AgentInfo[];
  notFound: AgentInfo[];
}

export function parseAgentsTab(tab: string | undefined): AgentsDashboardTab {
  if (tab === 'mcp' || tab === 'skills') return tab;
  return 'overview';
}

export function bucketAgents(agents: AgentInfo[]): AgentBuckets {
  return {
    connected: agents.filter((a) => a.present && a.installed),
    detected: agents.filter((a) => a.present && !a.installed),
    notFound: agents.filter((a) => !a.present),
  };
}

export function resolveAgentStatus(agent: AgentInfo): AgentResolvedStatus {
  if (agent.present && agent.installed) return 'connected';
  if (agent.present) return 'detected';
  return 'notFound';
}

export function capabilityForSkill(skill: SkillInfo): SkillCapability {
  const text = `${skill.name} ${skill.description}`.toLowerCase();
  if (text.includes('search') || text.includes('research')) return 'research';
  if (text.includes('doc') || text.includes('write')) return 'docs';
  if (text.includes('deploy') || text.includes('ops') || text.includes('ci')) return 'ops';
  if (text.includes('memory') || text.includes('mind')) return 'memory';
  return 'coding';
}

export function groupSkillsByCapability(skills: SkillInfo[]): Record<SkillCapability, SkillInfo[]> {
  return {
    research: skills.filter((s) => capabilityForSkill(s) === 'research'),
    coding: skills.filter((s) => capabilityForSkill(s) === 'coding'),
    docs: skills.filter((s) => capabilityForSkill(s) === 'docs'),
    ops: skills.filter((s) => capabilityForSkill(s) === 'ops'),
    memory: skills.filter((s) => capabilityForSkill(s) === 'memory'),
  };
}

export function buildRiskQueue(args: {
  mcpRunning: boolean;
  detectedCount: number;
  notFoundCount: number;
  allSkillsDisabled: boolean;
}): RiskItem[] {
  const items: RiskItem[] = [];
  if (!args.mcpRunning) items.push({ id: 'mcp-stopped', severity: 'error', title: 'MCP server is not running' });
  if (args.detectedCount > 0) items.push({ id: 'detected-unconfigured', severity: 'warn', title: `${args.detectedCount} detected agent(s) need configuration` });
  if (args.notFoundCount > 0) items.push({ id: 'not-found', severity: 'warn', title: `${args.notFoundCount} agent(s) not detected on this machine` });
  if (args.allSkillsDisabled) items.push({ id: 'skills-disabled', severity: 'warn', title: 'All skills are disabled' });
  return items;
}

export function filterSkills(skills: SkillInfo[], query: string, source: SkillSourceFilter): SkillInfo[] {
  const q = query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (source !== 'all' && skill.source !== source) return false;
    if (!q) return true;
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function filterAgentsByStatus(agents: AgentInfo[], status: AgentStatusFilter): AgentInfo[] {
  if (status === 'all') return agents;
  return agents.filter((agent) => resolveAgentStatus(agent) === status);
}

export function filterAgentsForMcpTable(agents: AgentInfo[], query: string, status: AgentStatusFilter): AgentInfo[] {
  const q = query.trim().toLowerCase();
  const byStatus = filterAgentsByStatus(agents, status);
  if (!q) return byStatus;
  return byStatus.filter((agent) => agent.name.toLowerCase().includes(q));
}
