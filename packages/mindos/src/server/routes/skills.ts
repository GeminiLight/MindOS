import { resolveSkillLinkAgents, type MindosMcpAgentRegistryDef } from '../handlers/mcp-agents.js';
import { handleSkillRuntimeMatchesGet } from '../handlers/skill-runtime-matches.js';
import type { MindosSkillLinkAgent } from '../handlers/skill-links.js';
import { handleSkillMatrixGet, handleSkillsGet, handleSkillsPost } from '../handlers/skills.js';
import { createDefaultSkillAgentRegistry } from '../mcp-agent-registry.js';
import { defineRoutes } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';
import { listHttpRuntimeDescriptors } from './agent-runtimes.js';

export const skillRoutes = defineRoutes([
  { id: 'skills', method: 'GET', path: '/api/skills', auth: 'required',
    handler: ({ services }) => handleSkillsGet(services.listSkills()) },
  { id: 'skills.matrix', method: 'GET', path: '/api/skills/matrix', auth: 'required',
    handler: ({ services }) => {
      const { disabledSkills, skillRoots } = services.listSkills();
      return handleSkillMatrixGet({ disabledSkills, skillRoots, listLinkAgents: createHttpSkillLinkAgents(services) });
    } },
  { id: 'skills.runtime-matches', method: 'GET', path: '/api/skills/runtime-matches', auth: 'required',
    handler: ({ query, services }) => {
      const { disabledSkills, skillRoots } = services.listSkills();
      return handleSkillRuntimeMatchesGet(query, {
        disabledSkills,
        skillRoots,
        listRuntimes: () => listHttpRuntimeDescriptors(services, query),
      });
    } },
  { id: 'skills.action', method: 'POST', path: '/api/skills', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSkillsPost(await readJsonBody(), {
      mindRoot: services.mindRoot,
      skillRoots: services.listSkills().skillRoots,
      readSettings: services.readSettings,
      writeSettings: services.writeSettings,
      listLinkAgents: createHttpSkillLinkAgents(services),
      events: services.events,
    }) },
]);

/** Downstream agents eligible for skill linking, sourced like GET /api/mcp/agents. */
function createHttpSkillLinkAgents(services: MindosHttpServices): () => MindosSkillLinkAgent[] {
  return () => resolveSkillLinkAgents({
    agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
    skillAgentRegistry: createDefaultSkillAgentRegistry(),
  });
}
