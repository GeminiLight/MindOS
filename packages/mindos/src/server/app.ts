import { Hono } from 'hono';
import { isAuthorizedRequest, readWebPassword, resolveGuardedAuth } from './auth.js';
import { HttpBodyError, readJsonBody } from './body.js';
import { handleStaticArtifact } from './handlers/static.js';
import { CORS_HEADERS, json, type MindosServerResponse } from './response.js';
import { toHonoPath, type MindosRouteContext } from './route-table.js';
import { MINDOS_ROUTE_AUTH_GUARDS, MINDOS_ROUTE_TABLE } from './routes/index.js';
import type { MindosHttpServices } from './services.js';
import { toWebResponse } from './web-response.js';

export type MindosAppAuthMode = 'contract' | 'host';

export type MindosAppOptions = {
  services: MindosHttpServices;
  runtimeRoot?: string;
  /**
   * `contract` enforces each route's `auth` (standalone Product Server).
   * `host` trusts the embedding host, which already authenticated the request
   * (the Next proxy), and skips the bearer gate.
   */
  auth?: MindosAppAuthMode;
  /** Serve the static Web artifact for non-API GETs. Hosts that own their pages disable it. Default `true`. */
  staticFallback?: boolean;
  /**
   * Host hook for errors thrown by a handler. Return a `Response` or a
   * `MindosServerResponse` to override the default `{ error }` JSON
   * (`HttpBodyError.status` or 500); return `undefined` to keep it.
   */
  onError?: (error: unknown) => Response | MindosServerResponse<unknown> | undefined;
};

export type HandleMindosRequestOptions = Omit<MindosAppOptions, 'services'>;

export type MindosApp = Hono;

const UNAUTHORIZED = () => toWebResponse(json({ error: 'Unauthorized' }, { status: 401 }));
const NOT_FOUND = () => toWebResponse(json({ error: 'Not found' }, { status: 404 }));

function isMutatingMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/**
 * Peer address from the `@hono/node-server` env (`{ incoming, outgoing }`).
 * Hosts that call `app.fetch(request)` without an env (Next delegation, tests)
 * get `undefined`, which makes the same-origin exemption fall back to `Host`.
 */
function remoteAddressOf(env: unknown): string | undefined {
  if (!env || typeof env !== 'object') return undefined;
  const incoming = (env as { incoming?: { socket?: { remoteAddress?: unknown } } }).incoming;
  const address = incoming?.socket?.remoteAddress;
  return typeof address === 'string' ? address : undefined;
}

/**
 * Builds the Product Server as a Hono app from the route table. Every host
 * (Node listener, Next delegation, tests) goes through `app.fetch(request)`.
 */
export function createMindosApp(options: MindosAppOptions): MindosApp {
  const { services, runtimeRoot } = options;
  const authMode = options.auth ?? 'contract';
  const staticFallback = options.staticFallback ?? true;
  const invalidateTreeCache = () => services.invalidateTreeCache?.();
  const app = new Hono();

  // Preflight never reaches auth or routing.
  app.options('*', () => new Response(null, { status: 204, headers: CORS_HEADERS }));

  // Any non-read API call may have written into the mind root (file ops,
  // inbox, init, skills, ...). Invalidation is a cheap dirty flag; the watcher
  // covers external writes, this covers internal ones immediately.
  app.use('*', async (c, next) => {
    try {
      await next();
    } finally {
      if (isMutatingMethod(c.req.method)) invalidateTreeCache();
    }
  });

  for (const route of MINDOS_ROUTE_TABLE) {
    app.on(route.method, toHonoPath(route.path), async (c) => {
      const request = c.req.raw;
      if (authMode === 'contract' && !isAuthorizedRequest({
        auth: route.auth,
        headers: request.headers,
        remoteAddress: remoteAddressOf(c.env),
        services,
      })) {
        return UNAUTHORIZED();
      }
      const response = await route.handler(buildContext(request, c.req.param(), services, runtimeRoot));
      return toWebResponse(response, {
        request,
        // Streams outlive the handler; mirror the legacy "invalidate once the
        // whole response has been written" for mutating SSE routes.
        onStreamFinish: isMutatingMethod(request.method) ? invalidateTreeCache : undefined,
      });
    });
  }

  app.notFound((c) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    if (authMode === 'contract') {
      const guardedAuth = resolveGuardedAuth(request.method, url.pathname, MINDOS_ROUTE_AUTH_GUARDS);
      if (!isAuthorizedRequest({
        auth: guardedAuth,
        headers: request.headers,
        remoteAddress: remoteAddressOf(c.env),
        services,
      })) {
        return UNAUTHORIZED();
      }
    }
    if (staticFallback && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (readWebPassword(services)) {
        return toWebResponse(json({
          error: 'Password-protected Web UI requires the Next.js host auth adapter.',
        }, { status: 401 }));
      }
      const staticResponse = handleStaticArtifact({
        staticRoot: services.staticRoot ?? (runtimeRoot ? `${runtimeRoot}/static-web` : undefined),
        path: url.pathname,
      });
      if (staticResponse) return toWebResponse(staticResponse, { request });
    }
    return NOT_FOUND();
  });

  app.onError((error) => {
    const mapped = options.onError?.(error);
    if (mapped instanceof Response) return mapped;
    if (mapped) return toWebResponse(mapped);
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof HttpBodyError ? error.status : 500;
    return toWebResponse(json({ error: message }, { status }));
  });

  return app;
}

function buildContext(
  request: Request,
  params: Record<string, string>,
  services: MindosHttpServices,
  runtimeRoot: string | undefined,
): MindosRouteContext {
  const url = new URL(request.url);
  return {
    request,
    method: request.method,
    url,
    query: url.searchParams,
    params,
    headers: request.headers,
    signal: request.signal,
    services,
    runtimeRoot,
    readJsonBody: (maxBytes) => readJsonBody(request, maxBytes),
  };
}

const appCache = new WeakMap<MindosHttpServices, Map<string, MindosApp>>();

/**
 * Serves one Web-standard request against the shared route table with the
 * given services. Apps are cached per services object and option set, so
 * hosts can call this per request without rebuilding the router.
 */
export function handleMindosRequest(
  request: Request,
  services: MindosHttpServices,
  options: HandleMindosRequestOptions = {},
): Promise<Response> {
  const key = `${options.auth ?? 'contract'}|${options.staticFallback ?? true}|${options.runtimeRoot ?? ''}`;
  let byOptions = appCache.get(services);
  if (!byOptions) {
    byOptions = new Map();
    appCache.set(services, byOptions);
  }
  let app = byOptions.get(key);
  if (!app) {
    app = createMindosApp({ services, ...options });
    byOptions.set(key, app);
  }
  return Promise.resolve(app.fetch(request));
}
