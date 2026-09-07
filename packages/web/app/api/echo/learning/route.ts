export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import {
  getLearningLoop, learningAgentEvidence, learningMarkdown, LearningError, listLearningLoops,
  startLearningLoop, updateLearningLoop, prepareLearningMethodTrial,
} from '@geminilight/mindos/knowledge';
import { getMindRoot, invalidateCache } from '@/lib/fs';
import { readEchoCardsState } from '@/lib/echo-card-generator';

const headers = { 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function failure(error: unknown) {
  if (error instanceof LearningError) {
    const status = { invalid: 400, 'not-found': 404, conflict: 409, storage: 500 }[error.code];
    return json({ error: error.message, code: error.code }, status);
  }
  return json({ error: 'Learning records are unavailable. Please try again.', code: 'storage' }, 500);
}

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await req.text();
    if (raw.length > 64_000) throw new Error('Too large');
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
    return body;
  } catch { throw new LearningError('invalid', 'Invalid request body.'); }
}

export async function GET(req: NextRequest) {
  try {
    const root = getMindRoot();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return json({ loops: listLearningLoops(root) });
    const loop = getLearningLoop(root, id);
    if (!loop) throw new LearningError('not-found', 'Learning record not found.');
    if (req.nextUrl.searchParams.get('action') === 'trial') {
      const index = req.nextUrl.searchParams.get('attemptIndex');
      const revision = req.nextUrl.searchParams.get('revisionIndex') ?? '0';
      if (!/^\d+$/.test(revision)) throw new LearningError('invalid', 'Choose a valid method version.');
      const version = req.nextUrl.searchParams.get('version');
      if (index === null || version === null || !/^-?\d+$/.test(index) || !/^\d+$/.test(version)) throw new LearningError('invalid', 'Choose a method version.');
      return json({ trial: prepareLearningMethodTrial(root, id, Number(index), Number(version), Number(revision)) });
    }
    if (req.nextUrl.searchParams.get('format') === 'markdown') {
      return new NextResponse(learningMarkdown(loop, req.nextUrl.searchParams.get('locale') === 'zh' ? 'zh' : 'en'), {
        headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + loop.id + '.md"' },
      });
    }
    return json({ loop, agentEvidence: learningAgentEvidence(root, loop) });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readBody(req);
    if (typeof body.cardId !== 'string' || !body.cardId.trim() || body.cardId.length > 120) {
      throw new LearningError('invalid', 'Choose an insight first.');
    }
    const root = getMindRoot();
    // The client supplies only an id; evidence and text always come from the persisted card.
    const card = readEchoCardsState(root).cards.find((item) => item.id === body.cardId && item.segment === 'insight' && item.status === 'active');
    if (!card) throw new LearningError('not-found', 'This insight is no longer available.');
    return json({ loop: startLearningLoop(root, {
      cardId: card.id, title: card.title, content: card.content,
      sessions: card.source.sessions.filter((session) => session.messageRefs?.length),
    }) });
  } catch (error) { return failure(error); }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...command } = await readBody(req);
    if (typeof id !== 'string') throw new LearningError('invalid', 'A learning record id is required.');
    try {
      return json({ loop: updateLearningLoop(getMindRoot(), id, command) });
    } finally {
      // Publication may succeed before the journal write fails; refresh in either case.
      if (['approve-agent', 'pause-agent', 'resume-agent'].includes(String(command.action))) {
        invalidateCache();
        try { revalidatePath('/', 'layout'); } catch { /* No Next cache context in unit tests. */ }
      }
    }
  } catch (error) { return failure(error); }
}
