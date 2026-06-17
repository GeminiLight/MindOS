export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  answerAskUserQuestion,
  cancelAskUserQuestion,
  type AskUserQuestionAnswer,
} from '@geminilight/mindos/agent/bridges/user-question-bridge';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAnswers(value: unknown): AskUserQuestionAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((answer) => ({
    questionIndex: typeof answer.questionIndex === 'number' ? answer.questionIndex : -1,
    question: typeof answer.question === 'string' ? answer.question : '',
    kind: answer.kind === 'custom' || answer.kind === 'chat' || answer.kind === 'multi' ? answer.kind : 'option',
    answer: typeof answer.answer === 'string' ? answer.answer : null,
    ...(Array.isArray(answer.selected) ? { selected: answer.selected.filter((item): item is string => typeof item === 'string') } : {}),
    ...(typeof answer.notes === 'string' ? { notes: answer.notes } : {}),
    ...(typeof answer.preview === 'string' ? { preview: answer.preview } : {}),
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const runId = typeof body.runId === 'string' ? body.runId : '';
  const toolCallId = typeof body.toolCallId === 'string' ? body.toolCallId : '';
  if (!runId || !toolCallId) {
    return NextResponse.json({ error: 'runId and toolCallId are required.' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : 'answer';
  const result = action === 'cancel'
    ? cancelAskUserQuestion({ runId, toolCallId, reason: typeof body.reason === 'string' ? body.reason : 'user_cancelled' })
    : answerAskUserQuestion({
        runId,
        toolCallId,
        answers: normalizeAnswers(body.answers),
        cancelled: body.cancelled === true,
      });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}
