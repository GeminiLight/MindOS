export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requestRuntimePermissionForRun } from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';
import type { MindosRuntimePermissionOption } from '@geminilight/mindos/agent/runtime';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRuntime(value: unknown): 'codex' | 'claude' | null {
  if (value === 'codex' || value === 'claude') return value;
  return null;
}

function normalizeIntent(value: unknown): MindosRuntimePermissionOption['intent'] | undefined {
  return value === 'allow' || value === 'deny' || value === 'cancel' ? value : undefined;
}

function normalizeOptions(value: unknown): MindosRuntimePermissionOption[] {
  if (!Array.isArray(value)) return [
    { id: 'accept', label: 'Allow once', description: 'Run this action one time.', intent: 'allow' },
    { id: 'decline', label: 'Deny', description: 'Reject this action.', intent: 'deny' },
  ];
  return value
    .filter(isRecord)
    .map((option) => ({
      id: typeof option.id === 'string' ? option.id : '',
      label: typeof option.label === 'string' ? option.label : '',
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
      ...(normalizeIntent(option.intent) ? { intent: normalizeIntent(option.intent) } : {}),
    }))
    .filter(option => option.id && option.label);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const runId = typeof body.runId === 'string' ? body.runId : '';
  const toolCallId = typeof body.toolCallId === 'string' && body.toolCallId.trim()
    ? body.toolCallId
    : `runtime-permission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const toolName = typeof body.toolName === 'string' && body.toolName.trim()
    ? body.toolName
    : 'approval_request';
  if (!runId) {
    return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
  }
  const runtime = normalizeRuntime(body.runtime);
  if (!runtime) {
    return NextResponse.json({ error: 'runtime must be codex or claude.' }, { status: 400 });
  }

  const result = await requestRuntimePermissionForRun(runId, {
    runtime,
    toolCallId,
    toolName,
    input: body.input ?? {},
    options: normalizeOptions(body.options),
    ...(typeof body.reason === 'string' && body.reason.trim() ? { reason: body.reason } : {}),
  }, { signal: req.signal });

  return NextResponse.json(result);
}
