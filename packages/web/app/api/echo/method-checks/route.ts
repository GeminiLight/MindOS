export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import {
  createMethodCheck,
  listMethodChecks,
  getMethodCheck,
  prepareMethodCheck,
  assessMethodCheck,
  captureMethodCheck,
  createMethodHandoff,
  previewMethodHandoff,
  LearningError,
} from '@geminilight/mindos/knowledge';
import { getMindRoot } from '@/lib/fs';
import { GET as readRuntimeList } from '../../agent-runtimes/route';

async function availableTarget(req: NextRequest, target: unknown) {
  if (!target || typeof target !== 'object')
    throw new LearningError('invalid', 'Choose a receiving Agent.');
  const requested = target as { id?: unknown; kind?: unknown };
  const response = await readRuntimeList(
    new Request(new URL('/api/agent-runtimes', req.url)),
  );
  if (!response.ok)
    throw new LearningError('storage', 'Could not check available Agents.');
  const payload = await response.json();
  const selected = payload.runtimes?.find(
    (item: { id: string; kind: string }) =>
      item.id === requested.id && item.kind === requested.kind,
  );
  if (!selected || selected.status !== 'available')
    throw new LearningError(
      'conflict',
      'This Agent is unavailable. Refresh the choices.',
    );
  return { id: selected.id, kind: selected.kind, name: selected.name };
}
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
function failure(error: unknown) {
  const code = error instanceof LearningError ? error.code : 'storage';
  return json(
    { code },
    { invalid: 400, conflict: 409, 'not-found': 404, storage: 500 }[code],
  );
}
async function body(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > 16000) throw new Error('Large request');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid request');
    return value as Record<string, unknown>;
  } catch {
    throw new LearningError('invalid', 'Invalid request');
  }
}
export async function GET(req: NextRequest) {
  try {
    const root = getMindRoot();
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      if (req.nextUrl.searchParams.get('preview') === 'handoff')
        return json(previewMethodHandoff(root, id));
      const view = getMethodCheck(root, id);
      if (!view) throw new LearningError('not-found', 'Check not found');
      if (req.nextUrl.searchParams.get('format') === 'json')
        return new NextResponse(JSON.stringify(view.check, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename="${view.check.id}.json"`,
          },
        });
      return json(view);
    }
    const result = listMethodChecks(
      root,
      req.nextUrl.searchParams.get('learningId') ?? '',
      Number(req.nextUrl.searchParams.get('attemptIndex') ?? -1),
      Number(req.nextUrl.searchParams.get('revisionIndex') ?? 0),
    );
    return json({
      checks: result.checks.map((check) => ({
        id: check.id,
        createdAt: check.createdAt,
        version: check.version,
      })),
      unavailableCount: result.unavailableCount,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    return json({
      check: createMethodCheck(getMindRoot(), await body(req)),
      runs: [],
    });
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const input = await body(req);
    if (typeof input.id !== 'string')
      throw new LearningError('invalid', 'Choose a check');
    const root = getMindRoot();
    if (input.action === 'prepare') {
      if (input.handoffId) {
        const handoff = getMethodCheck(root, input.id)?.check.handoffs?.find(
          (item) => item.id === input.handoffId,
        );
        if (!handoff)
          throw new LearningError('not-found', 'Handoff not found.');
        await availableTarget(req, handoff.target);
      }
      return json(prepareMethodCheck(root, input.id, input));
    }
    if (input.action === 'handoff') {
      const target = await availableTarget(req, input.target);
      const check = createMethodHandoff(root, input.id, { ...input, target });
      return json({ ...getMethodCheck(root, check.id), check });
    }
    const check =
      input.action === 'capture'
        ? captureMethodCheck(root, input.id, input)
        : input.action === 'assess'
          ? assessMethodCheck(root, input.id, input)
          : null;
    if (!check) throw new LearningError('invalid', 'Choose an action');
    return json({ ...getMethodCheck(root, check.id), check });
  } catch (error) {
    return failure(error);
  }
}
