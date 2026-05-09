export type MindosServerResponse<T = unknown> = {
  status: number;
  body?: T;
  headers?: Record<string, string>;
};

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export function json<T>(body: T, init: { status?: number; headers?: Record<string, string> } = {}): MindosServerResponse<T> {
  return {
    status: init.status ?? 200,
    body,
    headers: init.headers,
  };
}

export function noContent(headers?: Record<string, string>): MindosServerResponse<undefined> {
  return {
    status: 204,
    headers,
  };
}

export function publicCacheHeaders(seconds: number, etag?: string): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=${seconds}`,
    ...(etag ? { ETag: etag } : {}),
  };
}

export function privateCacheHeaders(seconds: number): Record<string, string> {
  return {
    'Cache-Control': `private, max-age=${seconds}`,
  };
}

export function errorResponse(error: unknown, fallbackStatus = 500): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return json({ error: message }, { status: fallbackStatus });
}
