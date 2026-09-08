import { handleA2aAgentsGet, handleA2aDelegationsGet, handleA2aDiscoverPost, handleA2aOptions, handleA2aPost } from '../handlers/a2a.js';
import { defineRoutes } from '../route-table.js';

export const A2A_JSON_BODY_LIMIT = 100_000;

export const a2aRoutes = defineRoutes([
  { id: 'a2a', method: 'POST', path: '/api/a2a', auth: 'required',
    handler: async ({ headers, readJsonBody }) => handleA2aPost({
      contentLength: Number(headers.get('content-length') || 0),
      body: await readJsonBody(A2A_JSON_BODY_LIMIT),
    }) },
  // Preflight is answered by the app-level OPTIONS handler before routing; the
  // entry stays in the table so the contract keeps publishing it.
  { id: 'a2a.options', method: 'OPTIONS', path: '/api/a2a', auth: 'public',
    handler: () => handleA2aOptions() },
  { id: 'a2a.agents', method: 'GET', path: '/api/a2a/agents', auth: 'required',
    handler: () => handleA2aAgentsGet() },
  { id: 'a2a.delegations', method: 'GET', path: '/api/a2a/delegations', auth: 'required',
    handler: () => handleA2aDelegationsGet() },
  { id: 'a2a.discover', method: 'POST', path: '/api/a2a/discover', auth: 'required',
    handler: async ({ readJsonBody }) => handleA2aDiscoverPost(await readJsonBody()) },
]);
