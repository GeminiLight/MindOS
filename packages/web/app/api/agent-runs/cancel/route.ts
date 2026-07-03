export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAgentRun } from '@geminilight/mindos/agent/ledger/run-ledger';
import { cancelAgentRunTree } from '@geminilight/mindos/agent/ledger/run-cancellation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'JSON body must be an object' }, { status: 400 });
  }

  const rootRunId = typeof body.rootRunId === 'string' ? body.rootRunId.trim() : '';
  if (!rootRunId) {
    return NextResponse.json({ error: 'rootRunId is required' }, { status: 400 });
  }

  const record = getAgentRun(rootRunId);
  const chatSessionId = typeof body.chatSessionId === 'string' ? body.chatSessionId.trim() : '';
  if (chatSessionId && record?.chatSessionId && record.chatSessionId !== chatSessionId) {
    return NextResponse.json({ error: 'rootRunId does not belong to this chat session' }, { status: 404 });
  }

  await cancelAgentRunTree(rootRunId, {
    reason: 'Agent run was stopped by the user.',
    metadata: {
      canceledBy: 'user',
      source: 'agent-runs-cancel-api',
      ...(chatSessionId ? { chatSessionId } : {}),
    },
  });

  return NextResponse.json({ ok: true, rootRunId });
}
