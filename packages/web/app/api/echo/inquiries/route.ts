import { NextRequest } from 'next/server';
import {
  createInquiry,
  getInquiry,
  listInquiries,
  updateInquiry,
  prepareInquiry,
  inquiryRuns,
  LearningError,
} from '@geminilight/mindos/knowledge';
import { z } from 'zod';
import { getMindRoot } from '@/lib/fs';
import { json, body, ownerBoundary, failure } from '@/lib/research-http';
import {
  completedSourceSelection,
  readCompletedReply,
  sourceHash,
} from '@/lib/echo-completed-source';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const create = completedSourceSelection
  .extend({
    requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/),
    locale: z.enum(['en', 'zh']),
  })
  .strict();
function view(id: string) {
  const root = getMindRoot();
  const inquiry = getInquiry(root, id);
  if (!inquiry) throw new LearningError('not-found', 'Question not found.');
  return { inquiry, runs: inquiryRuns(root, inquiry) };
}
export async function GET(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    if ([...req.nextUrl.searchParams.keys()].some((k) => k !== 'id'))
      throw new LearningError('invalid', 'Choose a question.');
    const id = req.nextUrl.searchParams.get('id');
    return json(id ? view(id) : listInquiries(getMindRoot()));
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const parsed = create.safeParse(await body(req));
    if (!parsed.success)
      throw new LearningError('invalid', 'Choose a completed source reply.');
    const input = parsed.data;
    const source = readCompletedReply(input);
    if (!source.question)
      throw new LearningError(
        'invalid',
        'This reply has no preceding user question.',
      );
    const inquiry = createInquiry(getMindRoot(), {
      requestId: input.requestId,
      locale: input.locale,
      source: {
        sessionId: input.sessionId,
        messageIndex: input.messageIndex,
        messageHash: input.messageHash,
        quote: source.text.trim().slice(0, 1000),
        question: source.question.slice(0, 4000),
        questionHash: sourceHash(source.question),
      },
    });
    return json({ inquiry, runs: [] });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const denied = await ownerBoundary(req);
    if (denied) return denied;
    const { id, ...command } = await body(req);
    if (typeof id !== 'string')
      throw new LearningError('invalid', 'Choose a question.');
    if (command.action === 'prepare') {
      const { action: _action, ...input } = command;
      const prepared = prepareInquiry(getMindRoot(), id, input);
      return json({
        ...prepared,
        runs: inquiryRuns(getMindRoot(), prepared.inquiry),
      });
    }
    const inquiry = updateInquiry(getMindRoot(), id, command);
    return json({ inquiry, runs: inquiryRuns(getMindRoot(), inquiry) });
  } catch (error) {
    return failure(error);
  }
}
