import { HttpBodyError } from '../body.js';
import { handleA2aAgentsGet, handleA2aDelegationsGet, handleA2aDiscoverPost, handleA2aOptions, handleA2aPost, type A2aPostInput } from '../handlers/a2a.js';
import { defineRoutes, type MindosRouteContext } from '../route-table.js';

export const A2A_JSON_BODY_LIMIT = 100_000;

/**
 * JSON-RPC clients expect protocol-shaped errors: an oversized body must become
 * the handler's `-32600` 413 and unparsable JSON its `-32700`, not the generic
 * `{ error }` the shared body reader throws for every other route. A declared
 * size above the limit is answered before the body is read at all.
 */
async function readA2aBody({ headers, readJsonBody }: MindosRouteContext): Promise<A2aPostInput> {
  const contentLength = Number(headers.get('content-length') || 0);
  if (contentLength > A2A_JSON_BODY_LIMIT) return { contentLength };
  try {
    return { contentLength, body: await readJsonBody(A2A_JSON_BODY_LIMIT) };
  } catch (error) {
    if (error instanceof HttpBodyError && error.status === 400) return { contentLength, parseError: true };
    throw error;
  }
}

export const a2aRoutes = defineRoutes([
  { id: 'a2a', method: 'POST', path: '/api/a2a', auth: 'required',
    handler: async (ctx) => handleA2aPost(await readA2aBody(ctx), ctx.services.a2a) },
  // Preflight is answered by the app-level OPTIONS handler before routing; the
  // entry stays in the table so the contract keeps publishing it.
  { id: 'a2a.options', method: 'OPTIONS', path: '/api/a2a', auth: 'public',
    handler: () => handleA2aOptions() },
  { id: 'a2a.agents', method: 'GET', path: '/api/a2a/agents', auth: 'required',
    handler: ({ services }) => handleA2aAgentsGet(services.a2a) },
  { id: 'a2a.delegations', method: 'GET', path: '/api/a2a/delegations', auth: 'required',
    handler: ({ services }) => handleA2aDelegationsGet(services.a2a) },
  { id: 'a2a.discover', method: 'POST', path: '/api/a2a/discover', auth: 'required',
    handler: async ({ readJsonBody, services }) => handleA2aDiscoverPost(await readJsonBody(), services.a2a) },
]);
