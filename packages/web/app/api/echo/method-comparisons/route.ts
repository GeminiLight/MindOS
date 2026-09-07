export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { LearningError, createMethodComparison, getMethodComparison, listMethodComparisons, beginMethodComparisonRun, finishMethodComparisonRun, assessMethodComparison } from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { currentComparisonRuntime } from '@/lib/method-comparison-runtime';
import { executeMethodComparison } from '@/lib/study-coaching-executor';
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
  const code = error instanceof LearningError ? error.code : 'storage';
  return json({ code }, { invalid: 400, 'not-found': 404, conflict: 409, storage: 500 }[code]);
}
async function body(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const raw = await req.text(); if (raw.length > 26000) throw Error();
    const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value;
  } catch { throw new LearningError('invalid', 'Invalid comparison request.'); }
}
export async function GET(req: NextRequest) {
  try {
    const root = getMindRoot(), id = req.nextUrl.searchParams.get('id');
    if (id) {
      const comparison = getMethodComparison(root, id); if (!comparison) throw new LearningError('not-found', 'Comparison not found.');
      if (req.nextUrl.searchParams.get('format') === 'json') return new NextResponse(JSON.stringify(comparison, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${comparison.id}.json"` } });
      return json({ comparison });
    }
    const result = listMethodComparisons(root, req.nextUrl.searchParams.get('learningId') ?? '', Number(req.nextUrl.searchParams.get('attemptIndex')));
    return json({ comparisons: result.comparisons.map(c => ({ id: c.id, createdAt: c.createdAt, revisions: c.methods.map(m => m.revisionIndex) })), unavailableCount: result.unavailableCount, runtime: currentComparisonRuntime() });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const input = await body(req), current = currentComparisonRuntime();
    const requested = input.runtime as Record<string, unknown> | undefined;
    if (!current || !requested || Object.entries(current).some(([key, value]) => JSON.stringify(requested[key]) !== JSON.stringify(value))) throw new LearningError('conflict', 'The model configuration changed or is unavailable.');
    return json({ comparison: createMethodComparison(getMindRoot(), { ...input, runtime: current }) });
  } catch (error) { return failure(error); }
}
export async function PATCH(req: NextRequest) {
  try {
    const input = await body(req); if (typeof input.id !== 'string') throw new LearningError('invalid', 'Choose a comparison.');
    const root = getMindRoot();
    if (input.action === 'assess') return json({ comparison: assessMethodComparison(root, input.id, input) });
    if (input.action !== 'run') throw new LearningError('invalid', 'Choose an action.');
    const reserved = beginMethodComparisonRun(root, input.id, input);
    if (!reserved.execute || !reserved.request) return json({ comparison: reserved.record });
    // Every invocation is a fresh stateless request. The shared executor rechecks frozen configuration.
    const result = await executeMethodComparison(reserved.request, req.signal);
    return json({ comparison: finishMethodComparisonRun(root, input.id, reserved.runId, result) });
  } catch (error) { return failure(error); }
}
