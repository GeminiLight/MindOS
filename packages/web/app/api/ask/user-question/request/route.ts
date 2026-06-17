export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { askUserQuestionForRun } from '@geminilight/mindos/agent/bridges/user-question-bridge';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const runId = typeof body.runId === 'string' ? body.runId : '';
  const toolCallId = typeof body.toolCallId === 'string' && body.toolCallId.trim()
    ? body.toolCallId
    : `ask-user-question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!runId) {
    return NextResponse.json({ error: 'runId is required.' }, { status: 400 });
  }

  const result = await askUserQuestionForRun({
    runId,
    toolCallId,
    params: isRecord(body.params) ? body.params : { questions: body.questions },
    signal: req.signal,
  });

  return NextResponse.json(result);
}
