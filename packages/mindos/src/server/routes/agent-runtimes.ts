import {
  checkAcpHandshakeHealth,
  closeSession as defaultCloseAcpSession,
  createSession as defaultCreateAcpSession,
  listCachedAcpHandshakeHealth,
  type AcpHandshakeHealthResult,
  type AcpSession,
} from '../../protocols/acp/index.js';
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

/** Product detection defaults plus host overrides (Web injects its settings-aware detectors). */
function createHttpRuntimeServices(services: MindosHttpServices) {
  const { decoratePayload: _decoratePayload, ...overrides } = services.agentRuntimes ?? {};
  return { readSettings: services.readSettings, ...overrides };
}

/** Codex thread routes discover the binary with the host's detectors and may use a host-provided app-server client. */
function createHttpCodexServices(services: MindosHttpServices) {
  return {
    readSettings: services.readSettings,
    createCodexClient: services.createCodexClient,
    resolveRuntimeCommand: services.agentRuntimes?.resolveRuntimeCommand,
    resolveRuntimeCommandCandidates: services.agentRuntimes?.resolveRuntimeCommandCandidates,
  };
}

/** Threads and forks default to the mind root so a UI never lists another project's Codex threads by accident. */
function withDefaultCwd(query: URLSearchParams, mindRoot: string): URLSearchParams {
  if (query.has('cwd') || !mindRoot) return query;
  const next = new URLSearchParams(query);
  next.set('cwd', mindRoot);
  return next;
}

function withDefaultCwdBody(body: unknown, mindRoot: string): unknown {
  if (!mindRoot || !body || typeof body !== 'object' || Array.isArray(body) || 'cwd' in body) return body;
  return { ...(body as Record<string, unknown>), cwd: mindRoot };
}

export const agentRuntimeRoutes = defineRoutes([
  { id: 'agent-runtimes', method: 'GET', path: '/api/agent-runtimes', auth: 'required',
    handler: async ({ query, services }) => {
      const response = await handleAgentRuntimesGet(query, createHttpRuntimeServices(services));
      const decorate = services.agentRuntimes?.decoratePayload;
      if (!decorate || response.status !== 200 || !response.body || 'error' in response.body) return response;
      return { ...response, body: decorate(response.body) };
    } },
  { id: 'agent-runtimes.mcp-projections', method: 'GET', path: '/api/agent-runtimes/mcp-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeMcpProjectionsGet(query, createHttpMcpProjectionServices(services, query)) },
  { id: 'agent-runtimes.adapter-projections', method: 'GET', path: '/api/agent-runtimes/adapter-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimeAdapterProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.permission-projections', method: 'GET', path: '/api/agent-runtimes/permission-projections', auth: 'required',
    handler: ({ query, services }) => handleAgentRuntimePermissionProjectionsGet(query, createHttpRuntimeProjectionServices(services, query)) },
  { id: 'agent-runtimes.session-projections', method: 'GET', path: '/api/agent-runtimes/session-projections', auth: 'required',
    handler: ({ query, services }) => handleRuntimeSessionProjectionsGet(query, {
      ...createHttpRuntimeProjectionServices(services, query),
      getAcpSessionSnapshots: () => getAcpSessionSnapshots(services.acp),
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
      getAcpSessionSnapshots: () => getAcpSessionSnapshots(services.acp),
    }) },
  { id: 'agent-runtimes.extensions', method: 'GET', path: '/api/agent-runtimes/extensions', auth: 'required',
    handler: ({ services }) => handleAgentRuntimeExtensionsGet(services) },
  { id: 'agent-runtimes.extensions.preflight', method: 'POST', path: '/api/agent-runtimes/extensions/preflight', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentRuntimeExtensionPreflightPost(await readJsonBody(), services) },
  { id: 'agent-runtimes.extensions.install', method: 'POST', path: '/api/agent-runtimes/extensions/install', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAgentRuntimeExtensionInstallPost(await readJsonBody(), services) },
  { id: 'agent-runtimes.codex.models', method: 'GET', path: '/api/agent-runtimes/codex/models', auth: 'required',
    handler: ({ services }) => handleCodexModelsGet(createHttpCodexServices(services)) },
  { id: 'agent-runtimes.codex.threads', method: 'GET', path: '/api/agent-runtimes/codex/threads', auth: 'required',
    handler: ({ query, services }) => handleCodexThreadsGet(withDefaultCwd(query, services.mindRoot), createHttpCodexServices(services)) },
  { id: 'agent-runtimes.codex.thread', method: 'GET', path: '/api/agent-runtimes/codex/threads/[threadId]', auth: 'required',
    handler: ({ params, query, services }) => handleCodexThreadGet(params.threadId ?? '', query, createHttpCodexServices(services)) },
  { id: 'agent-runtimes.codex.thread.fork', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/fork', auth: 'required',
    handler: async ({ params, readJsonBody, services }) => handleCodexThreadForkPost(
      params.threadId ?? '',
      withDefaultCwdBody(await readJsonBody(), services.mindRoot),
      createHttpCodexServices(services),
    ) },
  { id: 'agent-runtimes.codex.thread.archive', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/archive', auth: 'required',
    handler: ({ params, services }) => handleCodexThreadArchivePost(params.threadId ?? '', createHttpCodexServices(services)) },
  { id: 'agent-runtimes.codex.thread.unarchive', method: 'POST', path: '/api/agent-runtimes/codex/threads/[threadId]/unarchive', auth: 'required',
    handler: ({ params, services }) => handleCodexThreadUnarchivePost(params.threadId ?? '', createHttpCodexServices(services)) },
]);

/** Runtime descriptors as GET /api/agent-runtimes builds them; `force=1` bypasses the health cache. */
export async function listHttpRuntimeDescriptors(services: MindosHttpServices, searchParams: URLSearchParams) {
  const runtimeParams = new URLSearchParams();
  if (searchParams.get('force') === '1') runtimeParams.set('force', '1');
  const response = await handleAgentRuntimesGet(runtimeParams, createHttpRuntimeServices(services));
  if (response.status === 200 && response.body && 'runtimes' in response.body) return response.body.runtimes;
  throw new Error('Failed to build runtime descriptors for runtime projections.');
}

type RuntimeDescriptors = Awaited<ReturnType<typeof listHttpRuntimeDescriptors>>;

/**
 * ACP handshake health for the available ACP runtimes. Without `probe` only the
 * cache is consulted (cheap, never spawns); with it each agent gets a real
 * handshake through the host's session factory so settings overrides and env
 * apply exactly as they would for a user session.
 */
export async function listHttpAcpHandshakeHealth(
  services: MindosHttpServices,
  runtimes: Array<Pick<RuntimeDescriptors[number], 'id' | 'kind' | 'status'>>,
  options: { probe?: boolean; force?: boolean } = {},
): Promise<AcpHandshakeHealthResult[]> {
  const agentIds = runtimes
    .filter((runtime) => runtime.kind === 'acp' && runtime.status === 'available')
    .map((runtime) => runtime.id);
  if (agentIds.length === 0) return [];
  if (!options.probe) return listCachedAcpHandshakeHealth(agentIds);

  const createSession = services.acp?.createSession ?? defaultCreateAcpSession;
  const closeSession = services.acp?.closeSession ?? defaultCloseAcpSession;
  const overrides = services.readSettings().acpAgents;
  const settled = await Promise.allSettled(agentIds.map((agentId) => checkAcpHandshakeHealth(agentId, {
    createSession: (id, launch) => createSession(id, { ...launch, overrides }) as Promise<AcpSession>,
    closeSession: async (sessionId) => {
      await closeSession(sessionId);
    },
    force: options.force,
  })));
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function createHttpRuntimeProjectionServices(services: MindosHttpServices, searchParams: URLSearchParams) {
  return {
    listRuntimes: () => listHttpRuntimeDescriptors(services, searchParams),
    listAcpHandshakeHealth: ({ runtimes, probe, force }: { runtimes: RuntimeDescriptors; probe?: boolean; force?: boolean }) => (
      listHttpAcpHandshakeHealth(services, runtimes, { probe, force })
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
