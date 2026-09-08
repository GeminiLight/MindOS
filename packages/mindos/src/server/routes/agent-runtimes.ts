import { listCachedAcpHandshakeHealth } from '../../protocols/acp/index.js';
import { getAcpSessionSnapshots } from '../handlers/acp.js';
import {
  handleCodexModelsGet,
  handleCodexThreadArchivePost,
  handleCodexThreadForkPost,
  handleCodexThreadGet,
  handleCodexThreadUnarchivePost,
  handleCodexThreadsGet,
} from '../handlers/agent-runtimes-codex.js';
import { handleAgentRuntimesGet } from '../handlers/agent-runtimes.js';
import { handleMcpAgentsGet } from '../handlers/mcp-agents.js';
import { handleAgentRuntimeMcpProjectionsGet } from '../handlers/mcp-runtime-projections.js';
import { handleAgentRuntimeAdapterProjectionsGet } from '../handlers/runtime-adapter-projections.js';
import { handleAgentRuntimeArtifactProjectionsGet } from '../handlers/runtime-artifact-projections.js';
import { handleAgentRuntimeAutomationProjectionsGet } from '../handlers/runtime-automation-projections.js';
import { handleRuntimeControlPlaneGet, handleRuntimeControlPlanePost } from '../handlers/runtime-control-plane.js';
import {
  handleAgentRuntimeExtensionInstallPost,
  handleAgentRuntimeExtensionPreflightPost,
  handleAgentRuntimeExtensionsGet,
} from '../handlers/runtime-extensions.js';
import { handleAgentRuntimePermissionProjectionsGet } from '../handlers/runtime-permission-projections.js';
import { handleAgentRuntimeReadinessGet } from '../handlers/runtime-readiness.js';
import { handleRuntimeSessionProjectionsGet } from '../handlers/runtime-session-projections.js';
import { defineRoutes, type MindosRouteAuthGuard } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';
import { createHttpMcpAgentsServices } from './mcp.js';

const CODEX_THREADS_PREFIX = '/api/agent-runtimes/codex/threads/';

/**
 * The legacy dispatcher mapped every GET/POST under the codex threads prefix
 * to a protected route before matching, so an unknown action (e.g. `/delete`)
 * answered 401 without a token and 404 with one. Kept as a guard so the table
 * does not have to publish a catch-all route.
 */
export const codexThreadAuthGuard: MindosRouteAuthGuard = {
  methods: ['GET', 'POST'],
  prefix: CODEX_THREADS_PREFIX,
  auth: 'required',
};

export const agentRuntimeRoutes = defineRoutes([
  { id: 'agent-runtimes', method: 'GET', path: '/api/agent-runtimes', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimesGet(query, services) },
  { id: 'agent-runtimes.mcp-projections', method: 'GET', path: '/api/agent-runtimes/mcp-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeMcpProjectionsGet(query, createHttpMcpProjectionServices(services, query)) },
  { id: 'agent-runtimes.adapter-projections', method: 'GET', path: '/api/agent-runtimes/adapter-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeAdapterProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.permission-projections', method: 'GET', path: '/api/agent-runtimes/permission-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimePermissionProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.session-projections', method: 'GET', path: '/api/agent-runtimes/session-projections', auth: 'required',
    handler: ({ query, services }) => handleRuntimeSessionProjectionsGet(query, {
      ...createHttpRuntimeProjectionServices(services, query),
      getAcpSessionSnapshots: () => getAcpSessionSnapshots(services),
    }) },
  { id: 'agent-runtimes.artifact-projections', method: 'GET', path: '/api/agent-runtimes/artifact-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeArtifactProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.automation-projections', method: 'GET', path: '/api/agent-runtimes/automation-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeAutomationProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.control-plane', method: 'GET', path: '/api/agent-runtimes/control-plane', auth: 'required',
    handler: ({ query, services }) => handleRuntimeControlPlaneGet(query, { mindRoot: services.mindRoot }) },
  { id: 'agent-runtimes.control-plane.mutate', method: 'POST', path: '/api/agent-runtimes/control-plane', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleRuntimeControlPlanePost(await readJsonBody(), { mindRoot: services.mindRoot }) },
  { id: 'agent-runtimes.readiness', method: 'GET', path: '/api/agent-runtimes/readiness', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeReadinessGet(query, {
      ...createHttpMcpProjectionServices(services, query),
      getAcpSessionSnapshots: () => getAcpSessionSnapshots(services),
    }) },
  { id: 'agent-runtimes.extensions', method: 'GET', path: '/api/agent-runtimes/extensions', auth: 'required',
    handler: ({ services }) => handleAgentRuntimeExtensionsGet(services) },
  { id: 'agent-runtimes.extensions.preflight', method: 'POST', path: '/api/agent-runtimes/extensions/preflight', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentRuntimeExtensionPreflightPost(await readJsonBody(), services) },
  { id: 'agent-runtimes.extensions.install', method: 'POST', path: '/api/agent-runtimes/extensions/install', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentRuntimeExtensionInstallPost(await readJsonBody(), services) },
  { id: 'agent-runtimes.codex.models', method: 'GET', path: '/api/agent-runtimes/codex/models', auth: 'required',
    handler: ({ services }) => handleCodexModelsGet(services) },
  { id: 'agent-runtimes.codex.threads', method: 'GET', path: '/api/agent-runtimes/codex/threads', auth: 'required',
    handler: ({ query, services }) => handleCodexThreadsGet(query, services) },
  { id: 'agent-runtimes.codex.thread', method: 'GET', path: '/api/agent-runtimes/codex/threads/[threadId]', auth: 'required',
    handler: ({ params, query, services }) => handleCodexThreadGet(params.threadId ?? '', query, services) },
  { id: 'agent-runtimes.codex.thread.fork', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/fork', auth: 'required',
    handler: async ({ params, readJsonBody, services }) => handleCodexThreadForkPost(params.threadId ?? '', await readJsonBody(), services) },
  { id: 'agent-runtimes.codex.thread.archive', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/archive', auth: 'required',
    handler: ({ params, services }) => handleCodexThreadArchivePost(params.threadId ?? '', services) },
  { id: 'agent-runtimes.codex.thread.unarchive', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/unarchive', auth: 'required',
    handler: ({ params, services }) => handleCodexThreadUnarchivePost(params.threadId ?? '', services) },
]);

/** Runtime descriptors as GET /api/agent-runtimes builds them; `force=1` bypasses the health cache. */
export async function listHttpRuntimeDescriptors(services: MindosHttpServices, searchParams: URLSearchParams) {
  const runtimeParams = new URLSearchParams();
  if (searchParams.get('force') === '1') runtimeParams.set('force', '1');
  const response = await handleAgentRuntimesGet(runtimeParams, services);
  if (response.status === 200 && response.body && 'runtimes' in response.body) return response.body.runtimes;
  throw new Error('Failed to build runtime descriptors for runtime projections.');
}

type RuntimeDescriptors = Awaited<ReturnType<typeof listHttpRuntimeDescriptors>>;

function createHttpRuntimeProjectionServices(services: MindosHttpServices, searchParams: URLSearchParams) {
  return {
    listRuntimes: () => listHttpRuntimeDescriptors(services, searchParams),
    listAcpHandshakeHealth: ({ runtimes }: { runtimes: RuntimeDescriptors }) => (
      listCachedAcpHandshakeHealth(runtimes.filter((runtime) => runtime.kind === 'acp').map((runtime) => runtime.id))
    ),
  };
}

function createHttpMcpProjectionServices(services: MindosHttpServices, searchParams: URLSearchParams) {
  return {
    ...createHttpRuntimeProjectionServices(services, searchParams),
    listMcpAgents: async () => {
      const response = await handleMcpAgentsGet(createHttpMcpAgentsServices(services));
      if (response.status === 200 && response.body && 'agents' in response.body) return response.body.agents;
      throw new Error('Failed to build MCP agent profiles for runtime projections.');
    },
    readMcpConfig: () => services.mcpTools?.readMcpConfig() ?? { mcpServers: {} },
  };
}
