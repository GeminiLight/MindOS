import { NextResponse } from 'next/server';
import type { MindosServerResponse } from '@geminilight/mindos/server';

export function toNextResponse<T>(response: MindosServerResponse<T>) {
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
