export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { compileSpaceOverview, isCompileError, collectSpaceFiles } from '@/lib/compile';
import { getMindRoot } from '@/lib/fs';
import { resolveSafe } from '@/lib/core/security';
import { handleRouteErrorSimple } from '@/lib/errors';

const COMPILE_TIMEOUT = 60_000;

/** GET /api/space-overview?space=X — return file stats (lightweight, no LLM) */
export async function GET(req: NextRequest) {
  try {
    const space = req.nextUrl.searchParams.get('space');
    if (!space) {
      return NextResponse.json({ error: 'space parameter required' }, { status: 400 });
    }
    const mindRoot = getMindRoot();
    resolveSafe(mindRoot, space);
    const files = collectSpaceFiles(mindRoot, space);
    return NextResponse.json({ fileCount: files.length });
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}

/** POST /api/space-overview — generate overview with LLM */
export async function POST(req: NextRequest) {
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
