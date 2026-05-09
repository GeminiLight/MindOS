export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { handleSpaceOverviewGet } from '@geminilight/mindos/server';
import { compileSpaceOverview, isCompileError, collectSpaceFiles } from '@/lib/compile';
import * as mindFs from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

const COMPILE_TIMEOUT = 60_000;

/** GET /api/space-overview?space=X — return file stats (lightweight, no LLM) */
export async function GET(req: NextRequest) {
  try {
    const space = req.nextUrl.searchParams.get('space') ?? undefined;
    const mindRoot = mindFs.getMindRoot();
    const collectAllFiles = getOptionalCollectAllFiles();
    return toNextResponse(handleSpaceOverviewGet(req.nextUrl.searchParams, {
      mindRoot,
      collectAllFiles: typeof collectAllFiles === 'function'
        ? collectAllFiles
        : () => collectSpaceFiles(mindRoot, space ?? '').map((_, index) => `${space}/${index}.md`),
    }));
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}

function getOptionalCollectAllFiles(): (() => string[]) | undefined {
  try {
    return (mindFs as { collectAllFiles?: () => string[] }).collectAllFiles;
  } catch {
    return undefined;
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
