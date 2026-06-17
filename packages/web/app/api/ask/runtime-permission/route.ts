export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveRuntimePermission } from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const runId = typeof body.runId === 'string' ? body.runId : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  if (!runId || !requestId || !decision) {
    return NextResponse.json({ error: 'runId, requestId, and decision are required.' }, { status: 400 });
  }

  const result = resolveRuntimePermission({ runId, requestId, decision });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
