import { handleConnectGet } from '../handlers/connect.js';
import { handleInitPost } from '../handlers/init.js';
import { handleSetupGet, handleSetupPatch, handleSetupPost } from '../handlers/setup.js';
import { handleSetupCheckPath, handleSetupListDirectories } from '../handlers/setup-path.js';
import { handleSetupCheckPort } from '../handlers/setup-port.js';
import { handleSetupGenerateToken } from '../handlers/setup-token.js';
import { defineRoutes } from '../route-table.js';
import type { MindosRuntimeSettings } from '../runtime.js';
import type { MindosHttpServices } from '../services.js';

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

function createHttpSetupServices(services: MindosHttpServices) {
  return {
    readSettings: () => normalizeSetupSettingsForHttp(services.readSettings()),
    writeSettings: (settings: ReturnType<typeof normalizeSetupSettingsForHttp>) => services.writeSettings(settings as MindosRuntimeSettings),
  };
}

export const setupRoutes = defineRoutes([
  { id: 'connect', method: 'GET', path: '/api/connect', auth: 'public',
    handler: ({ services }) => handleConnectGet({ port: process.env.MINDOS_WEB_PORT, mindRoot: services.mindRoot }) },
  { id: 'init', method: 'POST', path: '/api/init', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleInitPost(await readJsonBody(), {
      mindRoot: services.mindRoot,
      runtimeRoot: services.runtimeRoot,
    }) },
  { id: 'setup.check-path', method: 'POST', path: '/api/setup/check-path', auth: 'required',
    handler: async ({ readJsonBody }) => handleSetupCheckPath(await readJsonBody()) },
  { id: 'setup.check-port', method: 'POST', path: '/api/setup/check-port', auth: 'required',
    handler: async ({ readJsonBody }) => handleSetupCheckPort(await readJsonBody(), {
      myWebPort: Number(process.env.MINDOS_WEB_PORT) || 0,
      myMcpPort: Number(process.env.MINDOS_MCP_PORT) || 0,
    }) },
  { id: 'setup.generate-token', method: 'POST', path: '/api/setup/generate-token', auth: 'required',
    handler: async ({ readJsonBody }) => handleSetupGenerateToken(await readJsonBody()) },
  { id: 'setup.ls', method: 'POST', path: '/api/setup/ls', auth: 'required',
    handler: async ({ readJsonBody }) => handleSetupListDirectories(await readJsonBody()) },
  { id: 'setup', method: 'GET', path: '/api/setup', auth: 'required',
    handler: ({ services }) => handleSetupGet(createHttpSetupServices(services)) },
  { id: 'setup.apply', method: 'POST', path: '/api/setup', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSetupPost(await readJsonBody(), createHttpSetupServices(services)) },
  { id: 'setup.guide-state', method: 'PATCH', path: '/api/setup', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleSetupPatch(await readJsonBody(), createHttpSetupServices(services)) },
]);
