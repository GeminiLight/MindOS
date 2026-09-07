export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { listTransferPractices, getTransferPractice, startTransferPractice, updateTransferPractice, transferPracticeId, LearningError, getTransferMethods, prepareTransferHelp, inspectTransferHelp } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
  const code = error instanceof LearningError ? error.code : 'storage';
  return json({ code }, { invalid: 400, conflict: 409, 'not-found': 404, storage: 500 }[code]);
}
async function body(req: NextRequest) {
  try {
    const text = await req.text(); if (text.length > 16000) throw new Error('Too large');
    const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid');
    return value as Record<string, unknown>;
  } catch { throw new LearningError('invalid', 'Invalid request body.'); }
}
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('list') === 'pending') return json(listTransferPractices(getMindRoot()));
    const id = req.nextUrl.searchParams.get('id') ?? transferPracticeId(req.nextUrl.searchParams.get('learningId') ?? '');
    const practice = getTransferPractice(getMindRoot(), id);
    if (req.nextUrl.searchParams.get('format') === 'json' && practice) {
      return new NextResponse(JSON.stringify(practice, null, 2), { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${practice.id}.json"` } });
    }
    return json({ practice, methods: !practice && req.nextUrl.searchParams.get('learningId') ? getTransferMethods(getMindRoot(), req.nextUrl.searchParams.get('learningId')!) : [] });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const input = await body(req); if (typeof input.learningId !== 'string') throw new LearningError('invalid', 'Choose a learning record.');
    return json({ practice: startTransferPractice(getMindRoot(), input.learningId, input.locale === 'zh' ? 'zh' : 'en', new Date(), input.methodMatch) });
  } catch (error) { return failure(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const input = await body(req); if (typeof input.id !== 'string') throw new LearningError('invalid', 'Choose a practice.');
    if (input.action === 'prepare-help') return json(prepareTransferHelp(getMindRoot(), input.id, input));
    if (input.action === 'inspect-help') return json({ practice: inspectTransferHelp(getMindRoot(), input.id, input) });
    return json({ practice: updateTransferPractice(getMindRoot(), input.id, input) });
  } catch (error) { return failure(error); }
}
