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

export const acpRoutes = defineRoutes([
  { id: 'acp.config', method: 'GET', path: '/api/acp/config', auth: 'required',
    handler: ({ services }) => handleAcpConfigGet(services) },
  { id: 'acp.config.update', method: 'POST', path: '/api/acp/config', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpConfigPost(await readJsonBody(), services) },
  { id: 'acp.config.delete', method: 'DELETE', path: '/api/acp/config', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpConfigDelete(await readJsonBody(), services) },
  { id: 'acp.detect', method: 'GET', path: '/api/acp/detect', auth: 'required',
    handler: ({ query, services }) => handleAcpDetectGet(query, services) },
  { id: 'acp.install', method: 'POST', path: '/api/acp/install', auth: 'required',
    handler: async ({ readJsonBody }) => handleAcpInstallPost(await readJsonBody()) },
  { id: 'acp.registry', method: 'GET', path: '/api/acp/registry', auth: 'required',
    handler: ({ query, services }) => handleAcpRegistryGet(query, services) },
  { id: 'acp.session', method: 'GET', path: '/api/acp/session', auth: 'required',
    handler: ({ services }) => handleAcpSessionGet(services) },
  { id: 'acp.session.action', method: 'POST', path: '/api/acp/session', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpSessionPost(await readJsonBody(), services) },
  { id: 'acp.session.close', method: 'DELETE', path: '/api/acp/session', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleAcpSessionDelete(await readJsonBody(), services) },
]);
