export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { compileSpaceOverview, isCompileError } from '@/lib/compile';
import { handleRouteErrorSimple } from '@/lib/errors';
import { delegateToMindos } from '../_mindos-adapter';

export const GET = delegateToMindos('GET', '/api/space-overview');

const COMPILE_TIMEOUT = 60_000;

/** POST /api/space-overview — generate the overview with the Web host LLM client; not part of the Product Server contract. */
export async function POST(req: Request) {
  try {
    const { space } = await req.json() as { space?: string };
    if (!space || typeof space !== 'string') {
      return NextResponse.json({ error: 'space field required' }, { status: 400 });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COMPILE_TIMEOUT);
    try {
      const result = await compileSpaceOverview(space, ctrl.signal);
      if (isCompileError(result)) {
        const status = result.code === 'no_api_key' ? 401 : 400;
        return NextResponse.json({ error: result.message, code: result.code }, { status });
      }
      return NextResponse.json(result);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
