export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { NextRequest } from 'next/server';
import { handleFileGet, handleFilePost, json } from '@geminilight/mindos/server';
import { appendContentChange, getFileContent, readLines } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { effectiveSopRoot } from '@/lib/settings';
import { SYSTEM_FILES } from '@/lib/types';
import { toNextResponse } from '../_mindos-adapter';

function mindRoot() {
  return effectiveSopRoot().trim();
}

export async function GET(req: NextRequest) {
  try {
    return toNextResponse(handleFileGet(req.nextUrl.searchParams, {
      mindRoot: mindRoot(),
      readTextFile: getFileContent,
      readLines,
      listSpaces: () => [],
      listDirectories: () => [],
    }));
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toNextResponse(json({ error: 'invalid JSON' }, { status: 400 }));
  }

  try {
    const response = await handleFilePost(body, { mindRoot: mindRoot() }, {
      sourceHeader: req.headers.get('x-mindos-source'),
      agentHeader: req.headers.get('x-mindos-agent'),
      protectedRootFiles: SYSTEM_FILES,
    });

    if (response.treeChanged) {
      try { revalidatePath('/', 'layout'); } catch { /* noop in test env */ }
    }

    if (response.changeEvent) {
      try {
        appendContentChange({ ...response.changeEvent, source: response.source ?? 'user' });
      } catch (logError) {
        console.warn('[file.route] failed to append content change log:', (logError as Error).message);
      }
    }

    return toNextResponse(response);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}
