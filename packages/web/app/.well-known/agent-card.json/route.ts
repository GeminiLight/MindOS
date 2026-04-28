export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { buildAgentCard } from '@/lib/a2a/agent-card';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'public, max-age=300',
};

export async function GET(req: NextRequest) {
  // Prefer explicit config; fall back to request headers
  const configuredUrl = process.env.MINDOS_BASE_URL;
  let baseUrl: string;
  if (configuredUrl) {
    baseUrl = configuredUrl.replace(/\/+$/, '');
  } else {
    const proto = req.headers.get('x-forwarded-proto') ?? 'http';
    const host = req.headers.get('host') ?? `localhost:${process.env.PORT || 3456}`;
    baseUrl = `${proto}://${host}`;
  }

  const card = buildAgentCard(baseUrl);

  const res = NextResponse.json(card);
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
