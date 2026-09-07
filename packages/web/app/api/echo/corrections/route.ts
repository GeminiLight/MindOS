export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startLearningCorrection, LearningError } from '@geminilight/mindos/knowledge';
import { readCompletedReply } from '@/lib/echo-completed-source';
import { getMindRoot } from '@/lib/fs';
const field = z.string().trim().min(1).max(1600);
const schema = z.object({ sessionId: z.string().min(1).max(200), messageIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), messageHash: z.string().regex(/^[a-f0-9]{64}$/), behavior: field, scope: field, check: field });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > 16_000) return json({ code: 'invalid' }, 400);
    let input: z.infer<typeof schema>;
    try { input = schema.parse(JSON.parse(raw)); } catch { return json({ code: 'invalid' }, 400); }
    const { session, text: reply } = readCompletedReply(input);
    const identity = hash(JSON.stringify(input)).slice(0, 24);
    const loop = startLearningCorrection(getMindRoot(), {
      cardId: 'correction-' + identity, title: input.behavior.slice(0, 100), content: input.behavior,
      sessions: [{ id: session.id, title: typeof session.title === 'string' ? session.title.slice(0, 200) : undefined,
        messageRefs: [{ messageIndex: input.messageIndex, role: 'assistant', quote: reply.slice(0, 1000) }] }],
    }, { behavior: input.behavior, scope: input.scope, check: input.check });
    return json({ loop });
  } catch (error) {
    const code = error instanceof LearningError ? error.code : 'storage';
    return json({ code }, { invalid: 400, conflict: 409, 'not-found': 404, storage: 500 }[code]);
  }
}
