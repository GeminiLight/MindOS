import type { AgentInfo, SkillInfo } from '@/components/settings/types';

export type AgentsDashboardTab = 'overview' | 'mcp' | 'skills' | 'a2a' | 'sessions';
export type AgentResolvedStatus = 'connected' | 'detected' | 'notFound';
export type SkillCapability = 'research' | 'coding' | 'docs' | 'ops' | 'memory';
export type SkillSourceFilter = 'all' | 'builtin' | 'user';
export type UnifiedSourceFilter = 'all' | 'builtin' | 'user' | 'native';
export type AgentStatusFilter = 'all' | 'connected' | 'detected' | 'notFound';
export type AgentTransportFilter = 'all' | 'stdio' | 'http' | 'other';
export type SkillWorkspaceStatusFilter = 'all' | 'enabled' | 'disabled' | 'attention';
export type SkillCapabilityFilter = SkillCapability | 'all';
export type AgentDetailSkillSourceFilter = 'all' | 'builtin' | 'user';

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
  if (tab === 'mcp' || tab === 'skills' || tab === 'a2a' || tab === 'sessions') return tab;
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
  return capabilityFromText(`${skill.name} ${skill.description}`);
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

export interface RiskCopy {
  riskMcpStopped: string;
  riskDetected: (n: number) => string;
  riskSkillsDisabled: string;
}

export function buildRiskQueue(args: {
  mcpRunning: boolean;
  detectedCount: number;
  notFoundCount: number;
  allSkillsDisabled: boolean;
  copy: RiskCopy;
}): RiskItem[] {
  const items: RiskItem[] = [];
  if (!args.mcpRunning) items.push({ id: 'mcp-stopped', severity: 'error', title: args.copy.riskMcpStopped });
  if (args.detectedCount > 0) items.push({ id: 'detected-unconfigured', severity: 'warn', title: args.copy.riskDetected(args.detectedCount) });
  if (args.allSkillsDisabled) items.push({ id: 'skills-disabled', severity: 'warn', title: args.copy.riskSkillsDisabled });
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

export function buildSkillAttentionSet(skills: SkillInfo[]): Set<string> {
  return new Set(
    skills
      .filter((skill) => (!skill.enabled && skill.source === 'user') || skill.description.trim().length === 0)
      .map((skill) => skill.name),
  );
}

export function filterSkillsForWorkspace(
  skills: SkillInfo[],
  filters: {
    query: string;
    source: SkillSourceFilter;
    status: SkillWorkspaceStatusFilter;
    capability: SkillCapabilityFilter;
  },
): SkillInfo[] {
  const attention = buildSkillAttentionSet(skills);
  const byQueryAndSource = filterSkills(skills, filters.query, filters.source);
  return byQueryAndSource.filter((skill) => {
    if (filters.status === 'enabled' && !skill.enabled) return false;
    if (filters.status === 'disabled' && skill.enabled) return false;
    if (filters.status === 'attention' && !attention.has(skill.name)) return false;
    if (filters.capability !== 'all' && capabilityForSkill(skill) !== filters.capability) return false;
    return true;
  });
}

export function resolveMatrixAgents(agents: AgentInfo[], focusKey: string): AgentInfo[] {
  if (focusKey === 'all') return agents;
  const focused = agents.find((agent) => agent.key === focusKey);
  return focused ? [focused] : [];
}

export function createBulkSkillTogglePlan(skills: SkillInfo[], targetEnabled: boolean): string[] {
  return skills.filter((skill) => skill.enabled !== targetEnabled).map((skill) => skill.name);
}

export interface BulkSkillToggleResult {
  skillName: string;
  ok: boolean;
  reason?: string;
}

export function summarizeBulkSkillToggleResults(results: BulkSkillToggleResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  failedSkills: string[];
} {
  const failedSkills = results.filter((item) => !item.ok).map((item) => item.skillName);
  return {
    total: results.length,
    succeeded: results.length - failedSkills.length,
    failed: failedSkills.length,
    failedSkills,
  };
}

export function filterAgentsByStatus(agents: AgentInfo[], status: AgentStatusFilter): AgentInfo[] {
  if (status === 'all') return agents;
  return agents.filter((agent) => resolveAgentStatus(agent) === status);
}

export function filterAgentsForMcpTable(agents: AgentInfo[], query: string, status: AgentStatusFilter): AgentInfo[] {
  const q = query.trim().toLowerCase();
  const byStatus = filterAgentsByStatus(agents, status);
  if (!q) return byStatus;
  return byStatus.filter((agent) => {
    const haystack = `${agent.name} ${agent.key} ${agent.configPath ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

export function resolveAgentTransport(agent: AgentInfo): AgentTransportFilter {
  const transport = (agent.transport ?? agent.preferredTransport ?? '').toLowerCase();
  if (transport === 'stdio' || transport === 'http') return transport;
  return 'other';
}

export function filterAgentsForMcpWorkspace(
  agents: AgentInfo[],
  filters: { query: string; status: AgentStatusFilter; transport: AgentTransportFilter },
): AgentInfo[] {
  const q = filters.query.trim().toLowerCase();
  return agents.filter((agent) => {
    if (filters.status !== 'all' && resolveAgentStatus(agent) !== filters.status) return false;
    if (filters.transport !== 'all' && resolveAgentTransport(agent) !== filters.transport) return false;
    if (!q) return true;
    const haystack = `${agent.name} ${agent.key} ${agent.configPath ?? ''}`.toLowerCase();
    return haystack.includes(q);
  });
}

const defaultRiskCopy: RiskCopy = {
  riskMcpStopped: 'MCP server is not running.',
  riskDetected: (n: number) => `${n} detected agent(s) need configuration.`,
  riskSkillsDisabled: 'All skills are disabled.',
};

export function buildMcpRiskQueue(args: {
  mcpRunning: boolean;
  detectedCount: number;
  notFoundCount: number;
}): RiskItem[] {
  return buildRiskQueue({ ...args, allSkillsDisabled: false, copy: defaultRiskCopy });
}

export interface McpBulkReconnectResult {
  agentKey: string;
  ok: boolean;
}

export function summarizeMcpBulkReconnectResults(results: McpBulkReconnectResult[]): {
  total: number;
  succeeded: number;
  failed: number;
} {
  const failed = results.filter((item) => !item.ok).length;
  return {
    total: results.length,
    succeeded: results.length - failed,
    failed,
  };
}

export interface CrossAgentMcpServer {
  serverName: string;
  agents: string[];
}

export function aggregateCrossAgentMcpServers(agents: AgentInfo[]): CrossAgentMcpServer[] {
  const map = new Map<string, string[]>();
  for (const agent of agents) {
    for (const server of agent.configuredMcpServers ?? []) {
      const existing = map.get(server);
      if (existing) existing.push(agent.name);
      else map.set(server, [agent.name]);
    }
  }
  return [...map.entries()]
    .map(([serverName, agentNames]) => ({ serverName, agents: agentNames }))
    .sort((a, b) => b.agents.length - a.agents.length || a.serverName.localeCompare(b.serverName));
}

export interface CrossAgentSkill {
  skillName: string;
  agents: string[];
}

export function aggregateCrossAgentSkills(agents: AgentInfo[]): CrossAgentSkill[] {
  const map = new Map<string, string[]>();
  for (const agent of agents) {
    for (const skill of agent.installedSkillNames ?? []) {
      const existing = map.get(skill);
      if (existing) existing.push(agent.name);
      else map.set(skill, [agent.name]);
    }
  }
  return [...map.entries()]
    .map(([skillName, agentNames]) => ({ skillName, agents: agentNames }))
    .sort((a, b) => b.agents.length - a.agents.length || a.skillName.localeCompare(b.skillName));
}

const STATUS_ORDER: Record<AgentResolvedStatus, number> = { connected: 0, detected: 1, notFound: 2 };

export function sortAgentsByStatus(agents: AgentInfo[]): AgentInfo[] {
  return [...agents].sort((a, b) => {
    const sa = STATUS_ORDER[resolveAgentStatus(a)];
    const sb = STATUS_ORDER[resolveAgentStatus(b)];
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

export function filterSkillsForAgentDetail(
  skills: SkillInfo[],
  filters: { query: string; source: AgentDetailSkillSourceFilter },
): SkillInfo[] {
  const q = filters.query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (filters.source !== 'all' && skill.source !== filters.source) return false;
    if (!q) return true;
    const haystack = `${skill.name} ${skill.description} ${skill.path}`.toLowerCase();
    return haystack.includes(q);
  });
}

/* ────────── Unified Skill List (MindOS + Native) ────────── */

export interface UnifiedSkillItem {
  name: string;
  kind: 'mindos' | 'native';
  mindosSkill?: SkillInfo;
  agents: string[];
  capability: SkillCapability;
  enabled: boolean;
  source: 'builtin' | 'user' | 'native';
  description: string;
}

export function capabilityFromText(text: string): SkillCapability {
  const lower = text.toLowerCase();
  if (lower.includes('search') || lower.includes('research') || lower.includes('arxiv') || lower.includes('paper')) return 'research';
  if (lower.includes('doc') || lower.includes('write') || lower.includes('readme') || lower.includes('copy') || lower.includes('slide') || lower.includes('ppt')) return 'docs';
  if (lower.includes('deploy') || lower.includes('ops') || lower.includes('ci') || lower.includes('ship') || lower.includes('qa') || lower.includes('review') || lower.includes('test')) return 'ops';
  if (lower.includes('memory') || lower.includes('mind') || lower.includes('handoff') || lower.includes('session')) return 'memory';
  return 'coding';
}

export function buildUnifiedSkillList(
  mindosSkills: SkillInfo[],
  crossAgentSkills: CrossAgentSkill[],
): UnifiedSkillItem[] {
  const mindosNames = new Set(mindosSkills.map((s) => s.name));
  const crossMap = new Map<string, string[]>();
  for (const cs of crossAgentSkills) crossMap.set(cs.skillName, cs.agents);

  const result: UnifiedSkillItem[] = [];

  for (const skill of mindosSkills) {
    result.push({
      name: skill.name,
      kind: 'mindos',
      mindosSkill: skill,
      agents: crossMap.get(skill.name) ?? [],
      capability: capabilityForSkill(skill),
      enabled: skill.enabled,
      source: skill.source,
      description: skill.description,
    });
  }

  for (const cs of crossAgentSkills) {
    if (mindosNames.has(cs.skillName)) continue;
    result.push({
      name: cs.skillName,
      kind: 'native',
      agents: cs.agents,
      capability: capabilityFromText(cs.skillName),
      enabled: true,
      source: 'native',
      description: '',
    });
  }

  return result;
}

export function groupUnifiedSkills(skills: UnifiedSkillItem[]): Record<SkillCapability, UnifiedSkillItem[]> {
  return {
    research: skills.filter((s) => s.capability === 'research'),
    coding: skills.filter((s) => s.capability === 'coding'),
    docs: skills.filter((s) => s.capability === 'docs'),
    ops: skills.filter((s) => s.capability === 'ops'),
    memory: skills.filter((s) => s.capability === 'memory'),
  };
}

export function filterUnifiedSkills(
  skills: UnifiedSkillItem[],
  filters: {
    query: string;
    source: UnifiedSourceFilter;
    status: SkillWorkspaceStatusFilter;
    capability: SkillCapabilityFilter;
  },
): UnifiedSkillItem[] {
  const q = filters.query.trim().toLowerCase();
  const attentionSet = new Set(
    skills
      .filter((s) => s.kind === 'mindos' && ((!s.enabled && s.source === 'user') || s.description.trim().length === 0))
      .map((s) => s.name),
  );

  return skills.filter((skill) => {
    if (filters.source !== 'all') {
      if (filters.source === 'native' && skill.kind !== 'native') return false;
      if (filters.source === 'builtin' && skill.source !== 'builtin') return false;
      if (filters.source === 'user' && skill.source !== 'user') return false;
    }
    if (filters.status === 'enabled' && !skill.enabled) return false;
    if (filters.status === 'disabled' && skill.enabled) return false;
    if (filters.status === 'attention' && !attentionSet.has(skill.name)) return false;
    if (filters.capability !== 'all' && skill.capability !== filters.capability) return false;
    if (q) {
      const haystack = `${skill.name} ${skill.description}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function createBulkUnifiedTogglePlan(skills: UnifiedSkillItem[], targetEnabled: boolean): string[] {
  return skills
    .filter((s) => s.kind === 'mindos' && s.enabled !== targetEnabled)
    .map((s) => s.name);
}
