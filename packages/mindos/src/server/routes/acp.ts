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
} from '../handlers/acp.js';
import { defineRoutes } from '../route-table.js';
import type { MindosHttpServices } from '../services.js';

/** Product defaults (settings-driven overrides) plus whatever the host layers on (Web adds env overlay + MCP config). */
export function createHttpAcpServices(services: MindosHttpServices) {
  return { readSettings: services.readSettings, ...services.acp };
}

export const acpRoutes = defineRoutes([
  { id: 'acp.config', method: 'GET', path: '/api/acp/config', auth: 'required',
    handler: ({ services }) => handleAcpConfigGet(services) },
  { id: 'acp.config.update', method: 'POST', path: '/api/acp/config', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpConfigPost(await readJsonBody(), services) },
  { id: 'acp.config.delete', method: 'DELETE', path: '/api/acp/config', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpConfigDelete(await readJsonBody(), services) },
  { id: 'acp.detect', method: 'GET', path: '/api/acp/detect', auth: 'required',
    handler: ({ query, services }) => handleAcpDetectGet(query, createHttpAcpServices(services)) },
  { id: 'acp.install', method: 'POST', path: '/api/acp/install', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpInstallPost(await readJsonBody(), createHttpAcpServices(services)) },
  { id: 'acp.registry', method: 'GET', path: '/api/acp/registry', auth: 'required',
    handler: ({ query, services }) => handleAcpRegistryGet(query, createHttpAcpServices(services)) },
  { id: 'acp.session', method: 'GET', path: '/api/acp/session', auth: 'required',
    handler: ({ services }) => handleAcpSessionGet(createHttpAcpServices(services)) },
  { id: 'acp.session.action', method: 'POST', path: '/api/acp/session', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpSessionPost(await readJsonBody(), createHttpAcpServices(services)) },
  { id: 'acp.session.close', method: 'DELETE', path: '/api/acp/session', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpSessionDelete(await readJsonBody(), createHttpAcpServices(services)) },
]);
