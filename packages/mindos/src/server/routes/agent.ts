import { createAgentCapabilitiesServices } from '../../agent/tool/capability-registry.js';
import { detectLocalAcpAgents, resolveCommandPath, resolveCommandPathCandidates } from '../../protocols/acp/index.js';
import { handleAgentActivity, handleAgentActivityPost } from '../handlers/agent-activity.js';
import { handleAgentCapabilitiesGet } from '../handlers/agent-capabilities.js';
import { handleAgentRunCapsuleRecoveryPost, handleAgentRunCapsulesGet } from '../handlers/agent-run-capsules.js';
import { handleAgentRunsGet } from '../handlers/agent-runs.js';
import {
  defaultCheckNativeRuntimeHealth,
  handleAgentRuntimesGet,
  type AgentRuntimesPayload,
  type AgentRuntimesServices,
} from '../handlers/agent-runtimes.js';
import { handleAgentSessionsDelete, handleAgentSessionsGet, handleAgentSessionsPost } from '../handlers/agent-sessions.js';
import { handleAgentSessionTurnStream } from '../handlers/agent-turn.js';
import {
  handleAgentCopySkillPost,
  handleCustomAgentDetectPost,
  handleCustomAgentsDelete,
  handleCustomAgentsPost,
  handleCustomAgentsPut,
  type AgentCopySkillPayload,
  type CustomAgentDef,
  type CustomAgentDetectPayload,
  type CustomAgentSettingsServices,
} from '../handlers/agents.js';
import { handleAssistantsDelete, handleAssistantsGet, handleAssistantsPost } from '../handlers/assistants.js';
import { handleConnectionsGet, handleConnectionsPost } from '../handlers/connections.js';
import {
  handleAutomationApprovalDecisionPost,
  handlePendingAgentActionsGet,
  handleRuntimePermissionDecisionPost,
  handleUserQuestionDecisionPost,
} from '../handlers/pending-agent-actions.js';
import { json } from '../response.js';
import { defineRoutes } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';

export const agentRoutes = defineRoutes([
  { id: 'agent-activity', method: 'GET', path: '/api/agent-activity', auth: 'required',
    handler: ({ query, services }) => handleAgentActivity(query, services) },
  { id: 'agent-activity.append', method: 'POST', path: '/api/agent-activity', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentActivityPost(await readJsonBody(), services) },
  { id: 'agent-runs', method: 'GET', path: '/api/agent-runs', auth: 'required',
    handler: ({ query, services }) => handleAgentRunsGet(query, { mindRoot: services.mindRoot }) },
  { id: 'agent-run-capsules', method: 'GET', path: '/api/agent-run-capsules', auth: 'required',
    handler: ({ query, services }) => handleAgentRunCapsulesGet(query, { mindRoot: services.mindRoot }) },
  { id: 'agent-run-capsules.recovery', method: 'POST', path: '/api/agent-run-capsules/[capsuleId]/recovery', auth: 'required',
    handler: async ({ params, readJsonBody, services }) => {
      const capsuleId = (params.capsuleId ?? '').trim();
      // The legacy matcher treated a blank id as "no such route".
      if (!capsuleId) return json({ error: 'Not found' }, { status: 404 });
      return handleAgentRunCapsuleRecoveryPost(capsuleId, await readJsonBody(), { mindRoot: services.mindRoot });
    } },
  { id: 'agent.pending-actions', method: 'GET', path: '/api/agent/pending-actions', auth: 'required',
    handler: ({ services }) => handlePendingAgentActionsGet({ mindRoot: services.mindRoot }) },
  { id: 'agent.automation-approval.resolve', method: 'POST', path: '/api/agent/automation-approval', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAutomationApprovalDecisionPost(await readJsonBody(), { mindRoot: services.mindRoot }) },
  { id: 'agent.runtime-permission.resolve', method: 'POST', path: '/api/agent/runtime-permission', auth: 'required',
    handler: async ({ readJsonBody }) => handleRuntimePermissionDecisionPost(await readJsonBody()) },
  { id: 'agent.user-question.resolve', method: 'POST', path: '/api/agent/user-question', auth: 'required',
    handler: async ({ readJsonBody }) => handleUserQuestionDecisionPost(await readJsonBody()) },
  { id: 'assistants', method: 'GET', path: '/api/assistants', auth: 'required',
    handler: ({ services }) => {
      // Hosts that ship built-in assistants scaffold them lazily on first read;
      // a scaffold failure must not hide the assistants that already exist.
      try {
        services.ensureMindSystemDefaults?.(services.mindRoot);
      } catch (error) {
        console.warn('[mindos.assistants] default assistant upgrade skipped:', (error as Error).message);
      }
      return handleAssistantsGet(services);
    } },
  { id: 'assistants.create', method: 'POST', path: '/api/assistants', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAssistantsPost(await readJsonBody(), services) },
  { id: 'assistants.delete', method: 'DELETE', path: '/api/assistants', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAssistantsDelete(await readJsonBody(), services) },
  { id: 'agent-capabilities', method: 'GET', path: '/api/agent-capabilities', auth: 'required',
    handler: ({ query, services }) => handleAgentCapabilitiesGet(
      query,
      services.agentCapabilities ?? createProductAgentCapabilitiesServices(services),
    ) },
  { id: 'connections', method: 'GET', path: '/api/connections', auth: 'required',
    handler: ({ query, services }) => handleConnectionsGet(query, { mindRoot: services.mindRoot }) },
  { id: 'connections.mutate', method: 'POST', path: '/api/connections', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleConnectionsPost(await readJsonBody(), { mindRoot: services.mindRoot }) },
  { id: 'agent.sessions.turns.create', method: 'POST', path: '/api/agent/sessions/[sessionId]/turns', auth: 'required',
    handler: async ({ params, readJsonBody, services }) => {
      const response = handleAgentSessionTurnStream(params.sessionId ?? '', await readJsonBody(), services);
      // `ok` is a discriminator for the handler's callers, not a wire field.
      const { ok: _ok, ...wire } = response;
      return wire;
    } },
  { id: 'agent-sessions', method: 'GET', path: '/api/agent/sessions', auth: 'required',
    handler: ({ services }) => handleAgentSessionsGet({ storePath: services.agentSessionsStorePath }) },
  { id: 'agent-sessions.save', method: 'POST', path: '/api/agent/sessions', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentSessionsPost(await readJsonBody(), { storePath: services.agentSessionsStorePath }) },
  { id: 'agent-sessions.delete', method: 'DELETE', path: '/api/agent/sessions', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentSessionsDelete(await readJsonBody(), { storePath: services.agentSessionsStorePath }) },
  { id: 'agents.custom.create', method: 'POST', path: '/api/agents/custom', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleCustomAgentsPost(await readJsonBody() as Partial<CustomAgentDef>, createCustomAgentServices(services)) },
  { id: 'agents.custom.update', method: 'PUT', path: '/api/agents/custom', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleCustomAgentsPut(await readJsonBody() as Partial<CustomAgentDef> & { key?: string }, createCustomAgentServices(services)) },
  { id: 'agents.custom.delete', method: 'DELETE', path: '/api/agents/custom', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleCustomAgentsDelete(await readJsonBody() as { key?: string }, createCustomAgentServices(services)) },
  { id: 'agents.custom.detect', method: 'POST', path: '/api/agents/custom/detect', auth: 'required',
    handler: async ({ readJsonBody }) => handleCustomAgentDetectPost(await readJsonBody() as CustomAgentDetectPayload) },
  { id: 'agents.copy-skill', method: 'POST', path: '/api/agents/copy-skill', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentCopySkillPost(await readJsonBody() as AgentCopySkillPayload, {
      skillRoots: services.listSkills().skillRoots,
    }) },
]);

/** Custom agent keys may not shadow a built-in one; the host's registry decides which keys are built in. */
function createCustomAgentServices(services: MindosHttpServices): CustomAgentSettingsServices {
  const builtIn = services.mcpAgentServices?.builtInAgents;
  return {
    readSettings: services.readSettings as CustomAgentSettingsServices['readSettings'],
    writeSettings: services.writeSettings as CustomAgentSettingsServices['writeSettings'],
    builtInAgentKeys: builtIn ? Object.keys(builtIn) : undefined,
  };
}

/**
 * The contract declares GET /api/agent-capabilities for every host, but the
 * Product Server never wired it and answered 404. The standalone server has no
 * pi KB toolkit or A2A registry, so those sources are empty here; ACP, native
 * runtime and MCP capabilities come from the same services the Next host uses.
 * Runtime descriptors are listed through the detection handler (shared
 * detection cache) and injected into the tool-layer registry, which must not
 * depend on HTTP handlers itself (spec-runtime-lane-contract).
 */
function createProductAgentCapabilitiesServices(services: MindosHttpServices) {
  return createAgentCapabilitiesServices({
    knowledgeBaseTools: [],
    effectiveMindRoot: () => services.mindRoot,
    listRuntimeDescriptors: async () => {
      const response = await handleAgentRuntimesGet(new URLSearchParams(), {
        readSettings: (() => services.readSettings()) as AgentRuntimesServices['readSettings'],
        detectLocalAcpAgents,
        resolveRuntimeCommand: resolveCommandPath,
        resolveRuntimeCommandCandidates: resolveCommandPathCandidates,
        checkNativeRuntimeHealth: defaultCheckNativeRuntimeHealth,
      });
      if (response.status !== 200 || !response.body || !('runtimes' in response.body)) {
        throw new Error('Could not load agent runtime descriptors.');
      }
      return (response.body as AgentRuntimesPayload).runtimes;
    },
    readMcpConfig: () => services.mcpTools?.readMcpConfig() ?? { mcpServers: {} },
    readMcpToolCache: () => services.mcpTools?.readMcpToolCache() ?? null,
    getDiscoveredAgents: () => [],
  });
}
