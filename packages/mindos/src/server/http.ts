import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import {
  collectAllFilesFromMindRoot,
  getDefaultMindRoot,
  getRecentlyModifiedFromMindRoot,
  getTreeVersionFromMindRoot,
  listDirectoriesFromMindRoot,
  listMindSpacesFromMindRoot,
  readLinesFromMindRoot,
  readRuntimeSettings,
  readTextFileFromMindRoot,
  searchMindRoot,
  getSkillRootsFromRuntime,
  writeRuntimeSettings,
  type MindosRuntimeOptions,
  type MindosRuntimeSettings,
} from './runtime.js';
import { MINDOS_SERVER_ROUTES } from './contract.js';
import { createDefaultMcpAgents, createDefaultSkillAgentRegistry } from './mcp-agent-registry.js';
import { handleA2aAgentsGet, handleA2aDelegationsGet, handleA2aDiscoverPost, handleA2aOptions, handleA2aPost } from './handlers/a2a.js';
import {
  handleAcpConfigDelete,
  handleAcpConfigGet,
  handleAcpConfigPost,
  handleAcpDetectGet,
  handleAcpInstallPost,
  handleAcpRegistryGet,
  handleAcpSessionDelete,
  handleAcpSessionGet,
  handleAcpSessionPost,
} from './handlers/acp.js';
import { handleAgentActivity } from './handlers/agent-activity.js';
import {
  handleCodexThreadArchivePost,
  handleCodexThreadForkPost,
  handleCodexThreadGet,
  handleCodexThreadUnarchivePost,
  handleCodexThreadsGet,
  type CodexThreadManagerServices,
} from './handlers/agent-runtime-codex.js';
import { handleAgentRuntimesGet } from './handlers/agent-runtimes.js';
import {
  handleAgentCopySkillPost,
  handleCustomAgentDetectPost,
  handleCustomAgentsDelete,
  handleCustomAgentsPost,
  handleCustomAgentsPut,
  type AgentCopySkillPayload,
  type CustomAgentDef,
  type CustomAgentDetectPayload,
} from './handlers/agents.js';
import { handleAskSessionsDelete, handleAskSessionsGet, handleAskSessionsPost } from './handlers/ask-sessions.js';
import { handleAssistantsDelete, handleAssistantsGet, handleAssistantsPost } from './handlers/assistants.js';
import { handleBootstrapGet } from './handlers/bootstrap.js';
import { handleChannelsVerifyPost, type ChannelsVerifyServices } from './handlers/channels-verify.js';
import { handleFileGet, handleFilePost } from './handlers/file.js';
import { handleChangesGet, handleChangesPost } from './handlers/changes.js';
import { handleConnectGet } from './handlers/connect.js';
import { handleEmbeddingGet, handleEmbeddingPost } from './handlers/embedding.js';
import { EXTRACT_DOCX_MAX_BODY_BYTES, handleExtractDocxPost, type ExtractDocxServices } from './handlers/extract-docx.js';
import { EXTRACT_PDF_MAX_BODY_BYTES, handleExtractPdfPost, type ExtractPdfServices } from './handlers/extract-pdf.js';
import { handleFiles } from './handlers/files.js';
import { handleBacklinks, handleGraph } from './handlers/graph.js';
import { handleGit } from './handlers/git.js';
import { handleHealth } from './handlers/health.js';
import { handleInitPost } from './handlers/init.js';
import { handleImActivityGet } from './handlers/im-activity.js';
import { handleImConfigDelete, handleImConfigGet, handleImConfigPut, type ImConfigServices } from './handlers/im-config.js';
import { handleImFeishuLongConnectionDelete, handleImFeishuLongConnectionGet, handleImFeishuLongConnectionPost } from './handlers/im-feishu-long-connection.js';
import { handleImFeishuOAuthCallbackGet, handleImFeishuOAuthGet } from './handlers/im-feishu-oauth.js';
import { handleImStatusGet, handleImWebhookStatusGet, type ImStatusServices } from './handlers/im-status.js';
import { handleImTestPost, type ImTestServices } from './handlers/im-test.js';
import { handleInboxDelete, handleInboxGet, handleInboxPost } from './handlers/inbox.js';
import { handleMonitoringGet } from './handlers/monitoring.js';
import {
  handleMcpInstallPost,
  handleMcpUninstallPost,
  type MindosMcpAgentDef,
  type MindosMcpInstallRequest,
  type MindosMcpUninstallRequest,
} from './handlers/mcp-install.js';
import {
  handleMcpAgentsGet,
  type MindosMcpAgentRegistryDef,
} from './handlers/mcp-agents.js';
import {
  handleMcpDirectToolsPost,
  handleMcpToolsGet,
  type MindosMcpConfigFile,
  type MindosMcpDirectToolsRequest,
  type MindosMcpToolCacheEntry,
} from './handlers/mcp-tools.js';
import {
  handleMcpInstallSkillPost,
  type MindosMcpInstallSkillRequest,
} from './handlers/mcp-install-skill.js';
import { handleMcpRestartPost } from './handlers/mcp-restart.js';
import { handleMcpStatus, handleMcpTokenReveal, type MindosMcpStatusServices, type MindosMcpStatusSettings } from './handlers/mcp-status.js';
import { handleRawFile } from './handlers/file-raw.js';
import { handleAskStream } from './handlers/ask.js';
import { handleRecentFiles } from './handlers/recent-files.js';
import { handleSearch } from './handlers/search.js';
import { handleSearchPrewarm } from './handlers/search-prewarm.js';
import {
  handleSettingsGet,
  handleSettingsPost,
  handleSettingsResetTokenPost,
  type MindosServerSettings,
  type MindosSettingsServices,
  type MindosWebSearchConfig,
} from './handlers/settings.js';
import { handleSettingsListModelsPost } from './handlers/settings-list-models.js';
import { handleSettingsTestKeyPost } from './handlers/settings-test-key.js';
import {
  MINDOS_PROVIDER_PRESETS,
  buildMindosEndpointCandidates,
  findMindosProvider,
  getMindosApiKeyFromEnv,
  isMindosProviderEntryId,
  isMindosProviderId,
  parseMindosProviders,
  resolveMindosProviderConfig,
} from './provider-settings.js';
import { handleUninstallPost } from './handlers/uninstall.js';
import { handleSetupCheckPort } from './handlers/setup-port.js';
import { handleSetupGenerateToken } from './handlers/setup-token.js';
import { handleSetupCheckPath, handleSetupListDirectories } from './handlers/setup-path.js';
import { handleSetupGet, handleSetupPatch, handleSetupPost } from './handlers/setup.js';
import { handleSkillsGet, handleSkillsPost, type MindosSkillRoot } from './handlers/skills.js';
import { handleSpaceOverviewGet } from './handlers/space-overview.js';
import { handleStaticArtifact } from './handlers/static.js';
import { handleSyncGet, handleSyncPost } from './handlers/sync.js';
import { handleTreeVersion } from './handlers/tree-version.js';
import { handleRestartPost, handleUpdateCheckGet, handleUpdatePost, handleUpdateStatusGet } from './handlers/update.js';
import { handleWorkflowsGet, handleWorkflowsPost } from './handlers/workflows.js';
import { CORS_HEADERS, json, type MindosServerResponse } from './response.js';
import { encodeMindosSseEvent, type MindOSSSEvent } from '../session/index.js';
import { getLocalIPv4 } from './handlers/connect.js';

export type MindosChannelServices =
  ChannelsVerifyServices &
  ImConfigServices &
  ImStatusServices &
  ImTestServices;

export type MindosHttpServices = {
  mindRoot: string;
  runtimeRoot?: string;
  staticRoot?: string;
  askSessionsStorePath?: string;
  updateStatusPath?: string;
  collectAllFiles(): string[];
  getRecentlyModified(limit: number): Array<{ path: string; mtime: number }>;
  getTreeVersion(): number;
  readTextFile(path: string): string;
  readLines(path: string): string[];
  listSpaces(): string[];
  listDirectories(): string[];
  search(query: string, options: { limit: number }): Promise<unknown[]>;
  readSettings(): MindosRuntimeSettings;
  writeSettings(settings: MindosRuntimeSettings): void;
  mcpAgents?: Record<string, MindosMcpAgentDef>;
  mcpTools?: {
    readMcpConfig(): MindosMcpConfigFile;
    readMcpToolCache(): Record<string, MindosMcpToolCacheEntry> | null;
    updateServerDirectTools(server: string, directTools: boolean | string[]): void;
  };
  listSkills(): { disabledSkills?: string[]; skillRoots: MindosSkillRoot[] };
  askStream(input: unknown): AsyncIterable<MindOSSSEvent>;
  createCodexClient?: CodexThreadManagerServices['createCodexClient'];
  documentExtraction?: ExtractPdfServices & ExtractDocxServices;
  channels?: MindosChannelServices;
  syncDaemon?: {
    start?(mindRoot: string): void;
    stop?(): void;
    reconfigure?(mindRoot: string): void;
    restart?(mindRoot: string): void;
  };
};

export type MindosHttpServerOptions = {
  hostname?: string;
  port?: number;
  runtimeRoot?: string;
  staticRoot?: string;
  services?: MindosHttpServices;
  runtime?: MindosRuntimeOptions;
  syncDaemon?: MindosHttpServices['syncDaemon'];
};

type DefaultMindosHttpServicesOptions = MindosRuntimeOptions & {
  runtimeRoot?: string;
  staticRoot?: string;
  mcpAgents?: Record<string, MindosMcpAgentDef>;
  documentExtraction?: ExtractPdfServices & ExtractDocxServices;
  syncDaemon?: MindosHttpServices['syncDaemon'];
};

export type MindosHttpServer = {
  server: Server;
  url: string;
  listen(): Promise<void>;
  close(): Promise<void>;
};

export function createDefaultMindosHttpServices(options: DefaultMindosHttpServicesOptions = {}): MindosHttpServices {
  const mindRoot = getDefaultMindRoot(options);
  const channels: MindosChannelServices = {};
  if (options.homeDir) {
    channels.configPath = `${options.homeDir}/.mindos/im.json`;
  }
  return {
    mindRoot,
    runtimeRoot: options.runtimeRoot,
    staticRoot: options.staticRoot,
    askSessionsStorePath: options.homeDir ? `${options.homeDir}/.mindos/sessions.json` : undefined,
    updateStatusPath: options.homeDir ? `${options.homeDir}/.mindos/update-status.json` : undefined,
    collectAllFiles: () => collectAllFilesFromMindRoot(mindRoot),
    getRecentlyModified: (limit) => getRecentlyModifiedFromMindRoot(mindRoot, limit),
    getTreeVersion: () => getTreeVersionFromMindRoot(mindRoot),
    readTextFile: (filePath) => readTextFileFromMindRoot(mindRoot, filePath),
    readLines: (filePath) => readLinesFromMindRoot(mindRoot, filePath),
    listSpaces: () => listMindSpacesFromMindRoot(mindRoot),
    listDirectories: () => listDirectoriesFromMindRoot(mindRoot),
    search: (query, searchOptions) => searchMindRoot(mindRoot, query, searchOptions),
    readSettings: () => readRuntimeSettings(options),
    writeSettings: (settings) => writeRuntimeSettings(settings, options),
    mcpAgents: options.mcpAgents ?? createDefaultMcpAgents(),
    documentExtraction: options.documentExtraction,
    channels,
    syncDaemon: options.syncDaemon,
    mcpTools: {
      readMcpConfig: () => ({ mcpServers: {} }),
      readMcpToolCache: () => null,
      updateServerDirectTools: () => {},
    },
    listSkills: () => ({
      disabledSkills: readRuntimeSettings(options).disabledSkills,
      skillRoots: getSkillRootsFromRuntime({
        mindRoot,
        runtimeRoot: options.runtimeRoot,
        homeDir: options.homeDir,
        settings: readRuntimeSettings(options),
      }),
    }),
    askStream: async function* () {
      yield {
        type: 'error',
        message: 'Product ask runtime is not configured. Start the Next adapter or inject an askStream service.',
      };
    },
  };
}

export function createMindosHttpServer(options: MindosHttpServerOptions = {}): MindosHttpServer {
  const hostname = options.hostname ?? process.env.MINDOS_WEB_HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.MINDOS_WEB_PORT || 3456);
  const services = options.services ?? createDefaultMindosHttpServices({
    ...options.runtime,
    runtimeRoot: options.runtimeRoot,
    staticRoot: options.staticRoot,
    syncDaemon: options.syncDaemon,
  });
  const server = createServer((req, res) => {
    void handleRequest(req, res, services, options.runtimeRoot);
  });

  return {
    server,
    url: `http://${hostname}:${port}`,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, hostname, () => {
          server.off('error', reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  services: MindosHttpServices,
  runtimeRoot?: string,
) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      writeResponse(res, { status: 204, headers: CORS_HEADERS });
      return;
    }

    const method = req.method ?? 'GET';
    const route = `${method} ${url.pathname}`;
    if (!isAuthorizedRequest(resolveAuthRoute(method, url.pathname), req, services)) {
      writeResponse(res, json({ error: 'Unauthorized' }, { status: 401 }));
      return;
    }

    if (route === 'GET /api/health') {
      writeResponse(res, handleHealth({ runtimeRoot: runtimeRoot ?? services.runtimeRoot }));
      return;
    }
    if (route === 'GET /api/files') {
      writeResponse(res, handleFiles(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/recent-files') {
      writeResponse(res, handleRecentFiles(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/tree-version') {
      writeResponse(res, handleTreeVersion(services));
      return;
    }
    if (route === 'GET /api/search') {
      writeResponse(res, await handleSearch(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/search/prewarm') {
      writeResponse(res, handleSearchPrewarm(services));
      return;
    }
    if (route === 'GET /api/backlinks') {
      writeResponse(res, handleBacklinks(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/graph') {
      writeResponse(res, handleGraph(services));
      return;
    }
    if (route === 'GET /api/agent-activity') {
      writeResponse(res, await handleAgentActivity(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/assistants') {
      writeResponse(res, handleAssistantsGet(services));
      return;
    }
    if (route === 'POST /api/assistants') {
      writeResponse(res, handleAssistantsPost(await readJsonBody(req), services));
      return;
    }
    if (route === 'DELETE /api/assistants') {
      writeResponse(res, handleAssistantsDelete(await readJsonBody(req), services));
      return;
    }
    if (route === 'GET /api/agent-runtimes') {
      writeResponse(res, await handleAgentRuntimesGet(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/agent-runtimes/codex/threads') {
      writeResponse(res, await handleCodexThreadsGet(url.searchParams, services));
      return;
    }
    const codexThreadRoute = parseCodexThreadRoute(method, url.pathname);
    if (codexThreadRoute) {
      if (codexThreadRoute.action === null && method === 'GET') {
        writeResponse(res, await handleCodexThreadGet(codexThreadRoute.threadId, url.searchParams, services));
        return;
      }
      if (codexThreadRoute.action === 'fork' && method === 'POST') {
        writeResponse(res, await handleCodexThreadForkPost(codexThreadRoute.threadId, await readJsonBody(req), services));
        return;
      }
      if (codexThreadRoute.action === 'archive' && method === 'POST') {
        writeResponse(res, await handleCodexThreadArchivePost(codexThreadRoute.threadId, services));
        return;
      }
      if (codexThreadRoute.action === 'unarchive' && method === 'POST') {
        writeResponse(res, await handleCodexThreadUnarchivePost(codexThreadRoute.threadId, services));
        return;
      }
    }
    if (route === 'OPTIONS /api/a2a') {
      writeResponse(res, handleA2aOptions());
      return;
    }
    if (route === 'POST /api/a2a') {
      writeResponse(res, await handleA2aPost({
        contentLength: Number(req.headers['content-length'] || 0),
        body: await readJsonBody(req, 100_000),
      }));
      return;
    }
    if (route === 'GET /api/a2a/agents') {
      writeResponse(res, handleA2aAgentsGet());
      return;
    }
    if (route === 'GET /api/a2a/delegations') {
      writeResponse(res, handleA2aDelegationsGet());
      return;
    }
    if (route === 'POST /api/a2a/discover') {
      writeResponse(res, await handleA2aDiscoverPost(await readJsonBody(req)));
      return;
    }
    if (route === 'GET /api/acp/config') {
      writeResponse(res, handleAcpConfigGet(services));
      return;
    }
    if (route === 'POST /api/acp/config') {
      writeResponse(res, handleAcpConfigPost(await readJsonBody(req), services));
      return;
    }
    if (route === 'DELETE /api/acp/config') {
      writeResponse(res, handleAcpConfigDelete(await readJsonBody(req), services));
      return;
    }
    if (route === 'GET /api/acp/detect') {
      writeResponse(res, await handleAcpDetectGet(url.searchParams, services));
      return;
    }
    if (route === 'POST /api/acp/install') {
      writeResponse(res, await handleAcpInstallPost(await readJsonBody(req)));
      return;
    }
    if (route === 'GET /api/acp/registry') {
      writeResponse(res, await handleAcpRegistryGet(url.searchParams));
      return;
    }
    if (route === 'GET /api/acp/session') {
      writeResponse(res, handleAcpSessionGet());
      return;
    }
    if (route === 'POST /api/acp/session') {
      writeResponse(res, await handleAcpSessionPost(await readJsonBody(req)));
      return;
    }
    if (route === 'DELETE /api/acp/session') {
      writeResponse(res, await handleAcpSessionDelete(await readJsonBody(req)));
      return;
    }
    if (route === 'GET /api/bootstrap') {
      writeResponse(res, handleBootstrapGet(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/connect') {
      writeResponse(res, handleConnectGet({ port: process.env.MINDOS_WEB_PORT }));
      return;
    }
    if (route === 'GET /api/embedding') {
      writeResponse(res, await handleEmbeddingGet());
      return;
    }
    if (route === 'POST /api/embedding') {
      writeResponse(res, await handleEmbeddingPost(await readJsonBody(req)));
      return;
    }
    if (route === 'POST /api/channels/verify') {
      writeResponse(res, await handleChannelsVerifyPost(await readJsonBody(req), services.channels));
      return;
    }
    if (route === 'GET /api/im/activity') {
      writeResponse(res, handleImActivityGet(url.searchParams));
      return;
    }
    if (route === 'GET /api/im/config') {
      writeResponse(res, handleImConfigGet(services.channels));
      return;
    }
    if (route === 'PUT /api/im/config') {
      writeResponse(res, handleImConfigPut(await readJsonBody(req), services.channels));
      return;
    }
    if (route === 'DELETE /api/im/config') {
      writeResponse(res, handleImConfigDelete(url.searchParams, services.channels));
      return;
    }
    if (route === 'GET /api/im/status') {
      writeResponse(res, await handleImStatusGet(services.channels));
      return;
    }
    if (route === 'POST /api/im/test') {
      writeResponse(res, await handleImTestPost(await readJsonBody(req), services.channels));
      return;
    }
    if (route === 'GET /api/im/webhook-status') {
      writeResponse(res, handleImWebhookStatusGet(url.searchParams, services.channels));
      return;
    }
    if (route === 'GET /api/im/feishu/oauth') {
      writeResponse(res, handleImFeishuOAuthGet(url.searchParams));
      return;
    }
    if (route === 'GET /api/im/feishu/oauth/callback') {
      writeResponse(res, await handleImFeishuOAuthCallbackGet(url.searchParams));
      return;
    }
    if (route === 'GET /api/im/feishu/long-connection') {
      writeResponse(res, handleImFeishuLongConnectionGet());
      return;
    }
    if (route === 'POST /api/im/feishu/long-connection') {
      writeResponse(res, await handleImFeishuLongConnectionPost());
      return;
    }
    if (route === 'DELETE /api/im/feishu/long-connection') {
      writeResponse(res, handleImFeishuLongConnectionDelete());
      return;
    }
    if (route === 'GET /api/monitoring') {
      writeResponse(res, handleMonitoringGet(services));
      return;
    }
    if (route === 'GET /api/update-status') {
      writeResponse(res, handleUpdateStatusGet({ statusPath: services.updateStatusPath }));
      return;
    }
    if (route === 'GET /api/update-check') {
      writeResponse(res, await handleUpdateCheckGet());
      return;
    }
    if (route === 'POST /api/restart') {
      writeResponse(res, handleRestartPost({ runtimeRoot: services.runtimeRoot }));
      return;
    }
    if (route === 'POST /api/update') {
      writeResponse(res, handleUpdatePost({ runtimeRoot: services.runtimeRoot }));
      return;
    }
    if (route === 'POST /api/uninstall') {
      writeResponse(res, handleUninstallPost(await readJsonBody(req), { runtimeRoot: services.runtimeRoot }));
      return;
    }
    if (route === 'POST /api/init') {
      writeResponse(res, handleInitPost(await readJsonBody(req), {
        mindRoot: services.mindRoot,
        runtimeRoot: services.runtimeRoot,
      }));
      return;
    }
    if (route === 'GET /api/sync') {
      writeResponse(res, await handleSyncGet());
      return;
    }
    if (route === 'POST /api/sync') {
      writeResponse(res, await handleSyncPost(await readJsonBody(req), {
        runtimeRoot: services.runtimeRoot,
        syncDaemon: services.syncDaemon,
      }));
      return;
    }
    if (route === 'GET /api/inbox') {
      writeResponse(res, handleInboxGet(services));
      return;
    }
    if (route === 'POST /api/inbox') {
      writeResponse(res, handleInboxPost(await readJsonBody(req), services));
      return;
    }
    if (route === 'DELETE /api/inbox') {
      writeResponse(res, handleInboxDelete(await readJsonBody(req), services));
      return;
    }
    if (route === 'GET /api/setup') {
      writeResponse(res, handleSetupGet(createHttpSetupServices(services)));
      return;
    }
    if (route === 'POST /api/setup') {
      writeResponse(res, handleSetupPost(await readJsonBody(req), createHttpSetupServices(services)));
      return;
    }
    if (route === 'PATCH /api/setup') {
      writeResponse(res, handleSetupPatch(await readJsonBody(req), createHttpSetupServices(services)));
      return;
    }
    if (route === 'POST /api/setup/check-path') {
      writeResponse(res, handleSetupCheckPath(await readJsonBody(req)));
      return;
    }
    if (route === 'POST /api/setup/check-port') {
      writeResponse(res, await handleSetupCheckPort(await readJsonBody(req), {
        myWebPort: Number(process.env.MINDOS_WEB_PORT) || 0,
        myMcpPort: Number(process.env.MINDOS_MCP_PORT) || 0,
      }));
      return;
    }
    if (route === 'POST /api/setup/generate-token') {
      writeResponse(res, handleSetupGenerateToken(await readJsonBody(req)));
      return;
    }
    if (route === 'POST /api/setup/ls') {
      writeResponse(res, handleSetupListDirectories(await readJsonBody(req)));
      return;
    }
    if (route === 'GET /api/workflows') {
      writeResponse(res, handleWorkflowsGet(services));
      return;
    }
    if (route === 'POST /api/workflows') {
      writeResponse(res, handleWorkflowsPost(await readJsonBody(req), services));
      return;
    }
    if (route === 'GET /api/skills') {
      writeResponse(res, handleSkillsGet(services.listSkills()));
      return;
    }
    if (route === 'GET /api/mcp/tools') {
      writeResponse(res, handleMcpToolsGet(services.mcpTools ?? {
        readMcpConfig: () => ({ mcpServers: {} }),
        readMcpToolCache: () => null,
      }));
      return;
    }
    if (route === 'GET /api/mcp/agents') {
      writeResponse(res, await handleMcpAgentsGet({
        agents: (services.mcpAgents ?? {}) as Record<string, MindosMcpAgentRegistryDef>,
        readSettings: services.readSettings,
        env: process.env,
        mindRoot: services.mindRoot,
        projectRoot: services.runtimeRoot ?? process.cwd(),
        skillAgentRegistry: createDefaultSkillAgentRegistry(),
      }));
      return;
    }
    if (route === 'GET /api/mcp/status') {
      writeResponse(res, await handleMcpStatus(createHttpMcpStatusServices(services), {
        host: typeof req.headers.host === 'string' ? req.headers.host : undefined,
      }));
      return;
    }
    if (route === 'POST /api/mcp/token/reveal') {
      writeResponse(res, await handleMcpTokenReveal(createHttpMcpStatusServices(services)));
      return;
    }
    if (route === 'POST /api/mcp/direct-tools') {
      writeResponse(res, handleMcpDirectToolsPost(await readJsonBody(req) as MindosMcpDirectToolsRequest, services.mcpTools ?? {
        updateServerDirectTools: () => {},
      }));
      return;
    }
    if (route === 'POST /api/mcp/install') {
      writeResponse(res, await handleMcpInstallPost(await readJsonBody(req) as MindosMcpInstallRequest, {
        agents: services.mcpAgents ?? {},
        readSettings: services.readSettings,
        env: process.env,
        skillAgentRegistry: createDefaultSkillAgentRegistry(),
      }));
      return;
    }
    if (route === 'POST /api/mcp/install-skill') {
      writeResponse(res, handleMcpInstallSkillPost(await readJsonBody(req) as MindosMcpInstallSkillRequest, {
        env: process.env,
      }));
      return;
    }
    if (route === 'POST /api/mcp/restart') {
      writeResponse(res, await handleMcpRestartPost({
        readSettings: services.readSettings,
        env: process.env,
        projectRoot: services.runtimeRoot ?? process.cwd(),
      }));
      return;
    }
    if (route === 'POST /api/mcp/uninstall') {
      writeResponse(res, handleMcpUninstallPost(await readJsonBody(req) as MindosMcpUninstallRequest, {
        agents: services.mcpAgents ?? {},
      }));
      return;
    }
    if (route === 'POST /api/skills') {
      writeResponse(res, handleSkillsPost(await readJsonBody(req), {
        mindRoot: services.mindRoot,
        skillRoots: services.listSkills().skillRoots,
        readSettings: services.readSettings,
        writeSettings: services.writeSettings,
      }));
      return;
    }
    if (route === 'POST /api/settings/reset-token') {
      writeResponse(res, handleSettingsResetTokenPost({
        readSettings: services.readSettings,
        writeSettings: (settings) => services.writeSettings(settings),
      }));
      return;
    }
    if (route === 'POST /api/settings/test-key') {
      writeResponse(res, await handleSettingsTestKeyPost(
        await readJsonBody(req),
        createHttpSettingsTestKeyServices(services),
      ));
      return;
    }
    if (route === 'POST /api/settings/list-models') {
      writeResponse(res, await handleSettingsListModelsPost(
        await readJsonBody(req),
        createHttpSettingsListModelsServices(services),
      ));
      return;
    }
    if (route === 'GET /api/settings') {
      writeResponse(res, handleSettingsGet(createHttpSettingsServices(services)));
      return;
    }
    if (route === 'POST /api/settings') {
      writeResponse(res, handleSettingsPost(
        await readJsonBody(req) as Partial<MindosServerSettings> & { webSearch?: unknown },
        createHttpSettingsServices(services),
      ));
      return;
    }
    if (route === 'POST /api/agents/custom') {
      writeResponse(res, handleCustomAgentsPost(await readJsonBody(req) as Partial<CustomAgentDef>, services));
      return;
    }
    if (route === 'PUT /api/agents/custom') {
      writeResponse(res, handleCustomAgentsPut(await readJsonBody(req) as Partial<CustomAgentDef> & { key?: string }, services));
      return;
    }
    if (route === 'DELETE /api/agents/custom') {
      writeResponse(res, handleCustomAgentsDelete(await readJsonBody(req) as { key?: string }, services));
      return;
    }
    if (route === 'POST /api/agents/custom/detect') {
      writeResponse(res, handleCustomAgentDetectPost(await readJsonBody(req) as CustomAgentDetectPayload));
      return;
    }
    if (route === 'POST /api/agents/copy-skill') {
      writeResponse(res, await handleAgentCopySkillPost(await readJsonBody(req) as AgentCopySkillPayload, {
        skillRoots: services.listSkills().skillRoots,
      }));
      return;
    }
    if (route === 'GET /api/changes') {
      writeResponse(res, await handleChangesGet(url.searchParams, services));
      return;
    }
    if (route === 'POST /api/changes') {
      writeResponse(res, await handleChangesPost(await readJsonBody(req), services));
      return;
    }
    if (route === 'POST /api/ask') {
      const body = await readJsonBody(req);
      const response = handleAskStream(body, services);
      if (!response.ok) {
        writeResponse(res, response);
        return;
      }
      await writeSseResponse(res, response);
      return;
    }
    if (route === 'GET /api/ask-sessions') {
      writeResponse(res, handleAskSessionsGet({ storePath: services.askSessionsStorePath }));
      return;
    }
    if (route === 'GET /api/space-overview') {
      writeResponse(res, handleSpaceOverviewGet(url.searchParams, services));
      return;
    }
    if (route === 'GET /api/git') {
      writeResponse(res, await handleGit(url.searchParams, services));
      return;
    }
    if (route === 'POST /api/ask-sessions') {
      writeResponse(res, handleAskSessionsPost(await readJsonBody(req), { storePath: services.askSessionsStorePath }));
      return;
    }
    if (route === 'DELETE /api/ask-sessions') {
      writeResponse(res, handleAskSessionsDelete(await readJsonBody(req), { storePath: services.askSessionsStorePath }));
      return;
    }
    if (route === 'GET /api/file') {
      writeResponse(res, handleFileGet(url.searchParams, services));
      return;
    }
    if (route === 'POST /api/file') {
      writeResponse(res, await handleFilePost(await readJsonBody(req), { mindRoot: services.mindRoot }, {
        sourceHeader: req.headers['x-mindos-source'] as string | undefined,
        agentHeader: req.headers['x-mindos-agent'] as string | undefined,
      }));
      return;
    }
    if (route === 'POST /api/extract-pdf') {
      writeResponse(res, await handleExtractPdfPost(await readJsonBody(req, EXTRACT_PDF_MAX_BODY_BYTES), {
        ...services.documentExtraction,
        runtimeRoot: services.documentExtraction?.runtimeRoot ?? services.runtimeRoot,
        env: services.documentExtraction?.env ?? process.env,
      }));
      return;
    }
    if (route === 'POST /api/extract-docx') {
      writeResponse(res, await handleExtractDocxPost(await readJsonBody(req, EXTRACT_DOCX_MAX_BODY_BYTES), {
        ...services.documentExtraction,
        runtimeRoot: services.documentExtraction?.runtimeRoot ?? services.runtimeRoot,
        env: services.documentExtraction?.env ?? process.env,
      }));
      return;
    }
    if (route === 'GET /api/file/raw') {
      writeResponse(res, handleRawFile(url.searchParams, services, { range: req.headers.range }));
      return;
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const staticResponse = handleStaticArtifact({
        staticRoot: optionsStaticRoot(services, runtimeRoot),
        path: url.pathname,
      });
      if (staticResponse) {
        writeResponse(res, staticResponse);
        return;
      }
    }

    writeResponse(res, json({ error: 'Not found' }, { status: 404 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpBodyError ? error.status : 500;
    writeResponse(res, json({ error: message }, { status }));
  }
}

const ROUTE_AUTH = new Map(MINDOS_SERVER_ROUTES.map((route) => [`${route.method} ${route.path}`, route.auth]));

function isAuthorizedRequest(route: string, req: IncomingMessage, services: MindosHttpServices): boolean {
  if (ROUTE_AUTH.get(route) !== 'required') return true;

  const token = readAuthToken(services);
  if (!token) return true;

  if (req.headers['sec-fetch-site'] === 'same-origin') return true;

  const authorization = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const candidate = match?.[1];
  return typeof candidate === 'string' && safeTokenEquals(candidate, token);
}

function resolveAuthRoute(method: string, pathname: string): string {
  const codexThreadRoute = parseCodexThreadRoute(method, pathname);
  if (!codexThreadRoute) {
    if (
      (method === 'GET' || method === 'POST')
      && pathname.startsWith('/api/agent-runtimes/codex/threads/')
    ) {
      return 'GET /api/agent-runtimes/codex/threads';
    }
    return `${method} ${pathname}`;
  }
  const suffix = codexThreadRoute.action ? `/${codexThreadRoute.action}` : '';
  return `${method} /api/agent-runtimes/codex/threads/[threadId]${suffix}`;
}

function parseCodexThreadRoute(
  method: string,
  pathname: string,
): { threadId: string; action: null | 'fork' | 'archive' | 'unarchive' } | null {
  if (method !== 'GET' && method !== 'POST') return null;
  const match = /^\/api\/agent-runtimes\/codex\/threads\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!match) return null;
  const threadId = match[1];
  if (!threadId) return null;
  const action = match[2] ?? null;
  if (action !== null && action !== 'fork' && action !== 'archive' && action !== 'unarchive') return null;
  return {
    threadId: decodeURIComponent(threadId),
    action,
  };
}

function readAuthToken(services: MindosHttpServices): string {
  try {
    const settings = services.readSettings();
    if (typeof settings.authToken === 'string') return settings.authToken;
  } catch {
    // Fall through to environment fallback.
  }

  return process.env.MINDOS_AUTH_TOKEN || process.env.AUTH_TOKEN || '';
}

function safeTokenEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

function createHttpSettingsServices(services: MindosHttpServices): MindosSettingsServices {
  return {
    env: process.env,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    writeSettings: (settings) => {
      const current = services.readSettings();
      services.writeSettings({ ...current, ...(settings as MindosRuntimeSettings) });
    },
    readWebSearchConfig: () => {
      const raw = services.readSettings().webSearch;
      return raw && typeof raw === 'object' ? raw as MindosWebSearchConfig : {};
    },
    writeWebSearchConfig: (config) => {
      const current = services.readSettings();
      services.writeSettings({ ...current, webSearch: config });
    },
    parseProviders: parseMindosProviders,
    getEmbeddingStatus: () => ({ enabled: false, ready: false, building: false, docCount: 0 }),
    invalidateCache: () => {},
    providerEnv: {
      ids: Object.keys(MINDOS_PROVIDER_PRESETS),
      getApiKeyEnvVar: (id) => MINDOS_PROVIDER_PRESETS[id]?.envKeys[0],
      getApiKeyFromEnv: (id) => getMindosApiKeyFromEnv(id),
    },
  };
}

function normalizeSettingsForHttp(settings: MindosRuntimeSettings) {
  const ai = settings.ai && typeof settings.ai === 'object'
    ? settings.ai as { activeProvider?: string; providers?: unknown }
    : {};
  const providers = parseMindosProviders(ai.providers, ai.activeProvider);
  return {
    ...settings,
    ai: {
      activeProvider: normalizeHttpActiveProvider(ai.activeProvider, providers),
      providers,
    },
  };
}

function normalizeHttpActiveProvider(activeProvider: unknown, providers: Array<{ id: string; protocol: string }>): string {
  const active = typeof activeProvider === 'string' ? activeProvider : '';
  if (active && isMindosProviderEntryId(active) && providers.some((provider) => provider.id === active)) {
    return active;
  }
  if (active && isMindosProviderId(active)) {
    return providers.find((provider) => provider.protocol === active)?.id ?? providers[0]?.id ?? '';
  }
  return providers[0]?.id ?? '';
}

function createHttpSettingsTestKeyServices(services: MindosHttpServices) {
  return {
    isProviderId: isMindosProviderId,
    isProviderEntryId: isMindosProviderEntryId,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    findProvider: findMindosProvider,
    effectiveAiConfig: (provider: string) => resolveMindosProviderConfig(
      normalizeSettingsForHttp(services.readSettings()),
      provider,
      process.env,
    ),
    testModel: testProviderConnectivity,
    clearCompatCacheForBaseUrl: () => undefined,
  };
}

function createHttpSettingsListModelsServices(services: MindosHttpServices) {
  return {
    isProviderId: isMindosProviderId,
    isProviderEntryId: isMindosProviderEntryId,
    readSettings: () => normalizeSettingsForHttp(services.readSettings()),
    findProvider: findMindosProvider,
    effectiveAiConfig: (provider: string) => resolveMindosProviderConfig(
      normalizeSettingsForHttp(services.readSettings()),
      provider,
      process.env,
    ),
    supportsListModels: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.supportsListModels !== false,
    getRegistryModels: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.registryModels ?? [],
    getProviderApiType: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.apiType ?? 'openai-completions',
    getDefaultBaseUrl: (provider: string) => MINDOS_PROVIDER_PRESETS[provider]?.defaultBaseUrl ?? '',
    buildEndpointCandidates: buildMindosEndpointCandidates,
    fetch: async (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => fetch(input, init),
  };
}

async function testProviderConnectivity(input: {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  signal: AbortSignal;
}): Promise<void> {
  const preset = MINDOS_PROVIDER_PRESETS[input.provider];
  const apiType = preset?.apiType ?? 'openai-completions';
  const baseUrl = input.baseUrl || preset?.defaultBaseUrl || '';
  const model = input.model || preset?.defaultModel || '';

  if (!model) throw new Error('Model is required');
  if (!baseUrl) throw new Error('No base URL configured');

  if (apiType === 'anthropic-messages') {
    const endpoint = buildMindosEndpointCandidates(baseUrl, '/messages', apiType)[0];
    if (!endpoint) throw new Error('No endpoint configured');
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: input.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return;
  }

  if (apiType === 'gemini') {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: input.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return;
  }

  const endpoint = buildMindosEndpointCandidates(baseUrl, '/chat/completions', apiType)[0];
  if (!endpoint) throw new Error('No endpoint configured');
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

function createHttpSetupServices(services: MindosHttpServices) {
  return {
    readSettings: () => normalizeSetupSettingsForHttp(services.readSettings()),
    writeSettings: (settings: ReturnType<typeof normalizeSetupSettingsForHttp>) => services.writeSettings(settings as MindosRuntimeSettings),
  };
}

function normalizeSetupSettingsForHttp(settings: MindosRuntimeSettings) {
  const ai = settings.ai && typeof settings.ai === 'object'
    ? settings.ai as { activeProvider?: unknown; providers?: unknown }
    : {};
  return {
    ...settings,
    mindRoot: typeof settings.mindRoot === 'string' ? settings.mindRoot : '',
    ai: {
      activeProvider: typeof ai.activeProvider === 'string' ? ai.activeProvider : '',
      providers: Array.isArray(ai.providers) ? ai.providers as any[] : [],
    },
  };
}

function createHttpMcpStatusServices(services: MindosHttpServices): MindosMcpStatusServices {
  return {
    env: process.env,
    readSettings: () => normalizeMcpStatusSettings(services.readSettings()),
    fetchHealth: fetchJsonHealth,
    getLocalIP: getLocalIPv4,
    maskToken,
  };
}

function normalizeMcpStatusSettings(settings: MindosRuntimeSettings): MindosMcpStatusSettings {
  const connectionMode = settings.connectionMode && typeof settings.connectionMode === 'object'
    ? settings.connectionMode as { cli?: unknown; mcp?: unknown }
    : undefined;
  return {
    mcpPort: typeof settings.mcpPort === 'number' ? settings.mcpPort : undefined,
    authToken: typeof settings.authToken === 'string' ? settings.authToken : undefined,
    connectionMode: typeof connectionMode?.cli === 'boolean' && typeof connectionMode.mcp === 'boolean'
      ? { cli: connectionMode.cli, mcp: connectionMode.mcp }
      : undefined,
  };
}

async function fetchJsonHealth(url: string, timeoutMs: number): Promise<{ ok: boolean; body?: { ok?: boolean; service?: string } }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(() => undefined) as { ok?: boolean; service?: string } | undefined;
    return { ok: response.ok, body };
  } finally {
    clearTimeout(timeout);
  }
}

function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '***set***';
  return `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

function optionsStaticRoot(services: MindosHttpServices, runtimeRoot?: string): string | undefined {
  return services.staticRoot
    ?? (runtimeRoot ? `${runtimeRoot}/static-web` : undefined);
}

class HttpBodyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

function readJsonBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        chunks.length = 0;
        reject(new HttpBodyError('Request body too large', 413));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new HttpBodyError('Invalid JSON body', 400));
      }
    });
    req.on('error', (error) => {
      if (!rejected) reject(error);
    });
  });
}

async function writeSseResponse(
  res: ServerResponse,
  response: { status: number; headers: Record<string, string>; body: AsyncIterable<MindOSSSEvent> },
) {
  res.writeHead(response.status, {
    ...CORS_HEADERS,
    ...response.headers,
  });
  try {
    for await (const event of response.body) {
      res.write(encodeMindosSseEvent(event));
    }
  } finally {
    res.end();
  }
}

function writeResponse<T>(res: ServerResponse, response: MindosServerResponse<T>) {
  const headers = {
    ...CORS_HEADERS,
    ...(response.body instanceof Uint8Array || Buffer.isBuffer(response.body)
      ? {}
      : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...(response.headers ?? {}),
  };

  res.writeHead(response.status, headers);
  if (response.status === 204 || response.body === undefined) {
    res.end();
  } else if (response.body instanceof Uint8Array || Buffer.isBuffer(response.body)) {
    res.end(response.body);
  } else {
    res.end(JSON.stringify(response.body));
  }
}
