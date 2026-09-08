import { NextResponse } from 'next/server';
import {
  createMindosApp,
  type MindosApp,
  type MindosHttpServices,
  type MindosRouteMethod,
  type MindosServerResponse,
} from '@geminilight/mindos/server';
import { handleRouteErrorSimple } from '@/lib/errors';
import { createWebMindosServices } from './_mindos-services';

/**
 * Converts a Product Server handler result into a Next response. A
 * Web-standard `Response` (from the shared Hono app) passes through untouched.
 */
export function toNextResponse<T>(response: MindosServerResponse<T> | Response): Response {
  if (response instanceof Response) return response;

  if (response.body instanceof Uint8Array) {
    return new Response(response.body as BodyInit, {
      status: response.status,
      headers: response.headers,
    });
  }

  const next = response.status === 204
    ? new Response(null, { status: 204 })
    : NextResponse.json(response.body, { status: response.status });

  for (const [key, value] of Object.entries(response.headers ?? {})) {
    next.headers.set(key, value);
  }

  return next;
}

/**
 * A Next route export that also accepts no argument (tests call `GET()`); the
 * last overload keeps Next's route type validation happy.
 */
export type MindosDelegatedRouteHandler = {
  (): Promise<Response>;
  (request: Request): Promise<Response>;
};

export type DelegateToMindosOptions = {
  /** Per-route service overrides on top of the Web host services (e.g. a content-aware tree version). */
  services?: Partial<MindosHttpServices>;
};

/**
 * Serves a Web route through the shared Product Server route table. The Next
 * proxy has already authenticated the request, so the app runs in `host` auth
 * mode; pages stay with Next, so the static fallback is off; thrown errors map
 * through the Web error policy (`handleRouteErrorSimple`).
 */
export function delegateToMindos(
  method: MindosRouteMethod,
  path: string,
  options: DelegateToMindosOptions = {},
): MindosDelegatedRouteHandler {
  let app: MindosApp | undefined;
  const getApp = () => {
    app ??= createMindosApp({
      services: createWebMindosServices(options.services),
      auth: 'host',
      staticFallback: false,
      onError: (error) => handleRouteErrorSimple(error),
    });
    return app;
  };

  return async (request?: Request): Promise<Response> => {
    const target = request ?? new Request(`http://localhost${path}`, { method });
    return toNextResponse(await getApp().fetch(target));
  };
}
