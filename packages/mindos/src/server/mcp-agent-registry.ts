/**
 * Re-export shell: the built-in agent registry now lives in
 * `agent/config/registry.ts` so the server handlers, the Web host and the
 * generated CLI bundle read one table.
 */
export {
  createDefaultMcpAgents,
  createDefaultSkillAgentRegistry,
  customAgentSkillDir,
  customAgentToConfigDef,
  DEFAULT_MCP_AGENTS,
  DEFAULT_SKILL_AGENT_REGISTRY,
  listDownstreamAgentDefs,
} from '../agent/config/registry.js';
