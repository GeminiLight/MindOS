import type { AgentEntry } from './types';

export type SetupAgentTargets = {
  skillAgentKeys: string[];
  mcpAgentKeys: string[];
};

export function resolveSetupAgentTargets({
  agents,
  selectedAgents,
  mcpEnabled,
}: {
  agents: AgentEntry[];
  selectedAgents: Set<string>;
  mcpEnabled: boolean;
}): SetupAgentTargets {
  const presentAgentKeys = new Set(agents.filter(agent => agent.present).map(agent => agent.key));
  const selectedPresentAgentKeys = Array.from(selectedAgents).filter(key => presentAgentKeys.has(key));
  return {
    skillAgentKeys: selectedPresentAgentKeys,
    mcpAgentKeys: mcpEnabled ? selectedPresentAgentKeys : [],
  };
}
