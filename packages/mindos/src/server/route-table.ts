import type { MindosServerResponse } from './response.js';
import type { MindosHttpServices } from './services.js';

export type MindosRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
export type MindosRouteAuth = 'public' | 'required';

/**
 * Everything a route handler may read from the request. Built once per request
 * by the Hono app; handlers never touch Node `req`/`res` or Hono's context, so
 * the same table serves the standalone Product Server and the Next host.
 */
export type MindosRouteContext = {
  request: Request;
  method: string;
  url: URL;
  query: URLSearchParams;
  /** Decoded dynamic segments declared with `[param]` in the route path. */
  params: Record<string, string>;
  headers: Headers;
  /** Aborts when the client disconnects; SSE handlers stop pulling their generator. */
  signal: AbortSignal;
  services: MindosHttpServices;
  runtimeRoot?: string;
  /** Streams and parses the JSON body; 413 above `maxBytes` (default 1 MB), 400 on invalid JSON, `{}` when empty. */
  readJsonBody(maxBytes?: number): Promise<unknown>;
};

export type MindosRouteResponse = MindosServerResponse<unknown>;
export type MindosRouteHandler = (ctx: MindosRouteContext) => MindosRouteResponse | Promise<MindosRouteResponse>;

/** One row of the route table. `MINDOS_SERVER_ROUTES` is the `{ id, method, path, auth }` projection of these rows. */
export type MindosRouteDefinition = {
  id: string;
  method: MindosRouteMethod;
  /** Contract path with `[param]` segments, e.g. `/api/agent/sessions/[sessionId]/turns`. */
  path: string;
  auth: MindosRouteAuth;
  handler: MindosRouteHandler;
};

/**
 * Auth rule for requests that match no route but live under a protected prefix.
 * The legacy dispatcher answered 401 (not 404) for unknown codex thread
 * sub-paths; guards keep that fail-closed behaviour without inventing routes.
 */
export type MindosRouteAuthGuard = {
  methods: MindosRouteMethod[];
  prefix: string;
  auth: 'required';
};

/** Identity helper that gives domain files a typed literal without `as const` noise. */
export function defineRoutes(routes: MindosRouteDefinition[]): MindosRouteDefinition[] {
  return routes;
}

/** `/api/x/[id]/y` → `/api/x/:id/y`. */
export function toHonoPath(path: string): string {
  return path.replace(/\[([^/\]]+)\]/g, ':$1');
}
