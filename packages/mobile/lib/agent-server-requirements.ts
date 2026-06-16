export type AgentServerRequirementId =
  | 'agent-tasks'
  | 'runtime-permissions'
  | 'user-questions'
  | 'native-sessions'
  | 'run-tree';

export interface AgentServerRequirement {
  id: AgentServerRequirementId;
  title: string;
  summary: string;
  unlocks: string;
  requiredEndpoints: string[];
  requiredCapabilities: string[];
}

export interface AgentServerRequirementsContract {
  version: 1;
  mobileSurface: 'agent-runs';
  mobileCanSubmit: false;
  requirements: AgentServerRequirement[];
  note: string;
}

export const AGENT_SERVER_REQUIREMENTS: AgentServerRequirement[] = [
  {
    id: 'agent-tasks',
    title: 'Cloud task adapter',
    summary: 'Create, list, subscribe, and review cloud coding tasks.',
    unlocks: 'Codex Cloud, Claude Code Web, and Copilot task launch/review.',
    requiredEndpoints: [
      'POST /api/agent-tasks',
      'GET /api/agent-tasks',
      'GET/SSE /api/agent-tasks/stream',
    ],
    requiredCapabilities: [
      'agentTasks.create',
      'agentTasks.list',
      'agentTasks.subscribe',
      'agentTasks.reviewLinks',
    ],
  },
  {
    id: 'runtime-permissions',
    title: 'Runtime permission queue',
    summary: 'Expose pending Allow/Deny requests from host runtimes.',
    unlocks: 'Mobile approval sheets for Codex, Claude Code, and MindOS tool gates.',
    requiredEndpoints: [
      'GET /api/runtime-permissions/pending',
      'POST /api/runtime-permissions/resolve',
      'GET/SSE /api/runtime-permissions/stream',
    ],
    requiredCapabilities: [
      'runtimePermissions.pending',
      'runtimePermissions.resolve',
      'runtimePermissions.subscribe',
    ],
  },
  {
    id: 'user-questions',
    title: 'Ask-user question queue',
    summary: 'Expose pending user questions and resolve answers across clients.',
    unlocks: 'Mobile answer sheets for MindOS, Codex, Claude Code, Pi, ACP, and A2A runs.',
    requiredEndpoints: [
      'GET /api/user-questions/pending',
      'POST /api/user-questions/resolve',
      'GET/SSE /api/user-questions/stream',
    ],
    requiredCapabilities: [
      'userQuestions.pending',
      'userQuestions.resolve',
      'userQuestions.subscribe',
    ],
  },
  {
    id: 'native-sessions',
    title: 'Native session history',
    summary: 'List and resume Codex threads and Claude Code sessions by owner.',
    unlocks: 'Runtime-scoped mobile session pickers without mixing MindOS chats.',
    requiredEndpoints: [
      'GET /api/agent-sessions?runtime=codex|claude',
      'POST /api/agent-sessions/resume',
    ],
    requiredCapabilities: [
      'nativeSessions.list',
      'nativeSessions.resume',
      'nativeSessions.ownerScoped',
    ],
  },
  {
    id: 'run-tree',
    title: 'Structured run tree',
    summary: 'Represent parent/child, background, and parallel agent runs.',
    unlocks: 'Pi subagent, MindOS subagent, ACP, and A2A timeline trees on mobile.',
    requiredEndpoints: [
      'GET /api/agent-runs/tree',
      'GET/SSE /api/agent-runs/stream',
    ],
    requiredCapabilities: [
      'agentRuns.tree',
      'agentRuns.subscribe',
      'agentRuns.backgroundStatus',
    ],
  },
];

export function buildAgentServerRequirementsContract(): AgentServerRequirementsContract {
  return {
    version: 1,
    mobileSurface: 'agent-runs',
    mobileCanSubmit: false,
    requirements: AGENT_SERVER_REQUIREMENTS.map((requirement) => ({
      ...requirement,
      requiredEndpoints: [...requirement.requiredEndpoints],
      requiredCapabilities: [...requirement.requiredCapabilities],
    })),
    note: 'MindOS Mobile can observe, route, and draft today. These Product Server contracts unlock real mobile control without moving runtime ownership onto the phone.',
  };
}

export function formatAgentServerRequirementsContract(): string {
  return JSON.stringify(buildAgentServerRequirementsContract(), null, 2);
}

export function summarizeAgentServerRequirements(): {
  requirementCount: number;
  endpointCount: number;
  capabilityCount: number;
} {
  const endpoints = new Set<string>();
  const capabilities = new Set<string>();

  for (const requirement of AGENT_SERVER_REQUIREMENTS) {
    for (const endpoint of requirement.requiredEndpoints) endpoints.add(endpoint);
    for (const capability of requirement.requiredCapabilities) capabilities.add(capability);
  }

  return {
    requirementCount: AGENT_SERVER_REQUIREMENTS.length,
    endpointCount: endpoints.size,
    capabilityCount: capabilities.size,
  };
}
