export const dynamic = 'force-dynamic';

import { revalidatePath } from 'next/cache';
import { NextRequest } from 'next/server';
import { handleFileGet, handleFilePost, handleOpenInFileManagerGet, json } from '@geminilight/mindos/server';
import {
  appendContentChange,
  flushWatcherChanges,
  getFileContent,
  handleWatcherEvent,
  invalidateCache,
  readLines,
} from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import {
  isPayloadTooLarge,
  KNOWLEDGE_WRITE_MAX_BODY_BYTES,
  payloadTooLargeResponse,
  readJsonBodyWithLimit,
} from '@/lib/api/request-utils';
import { effectiveSopRoot } from '@/lib/settings';
import { SYSTEM_FILES } from '@/lib/types';
import { toNextResponse } from '../_mindos-adapter';

function mindRoot() {
  return effectiveSopRoot().trim();
}

function normalizeAgentHeader(value: string | null): string | undefined {
  const normalized = value?.replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
  return normalized || undefined;
}

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('op') === 'open_in_file_manager') {
      return toNextResponse(await handleOpenInFileManagerGet(req.nextUrl.searchParams, { mindRoot: mindRoot() }));
    }

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
    body = await readJsonBodyWithLimit(req, KNOWLEDGE_WRITE_MAX_BODY_BYTES);
  } catch (err) {
    if (isPayloadTooLarge(err)) return payloadTooLargeResponse(KNOWLEDGE_WRITE_MAX_BODY_BYTES);
    return toNextResponse(json({ error: 'invalid JSON' }, { status: 400 }));
  }

  try {
    const agentName = normalizeAgentHeader(req.headers.get('x-mindos-agent'));
    const response = await handleFilePost(body, { mindRoot: mindRoot() }, {
      sourceHeader: req.headers.get('x-mindos-source'),
      agentHeader: agentName,
      protectedRootFiles: SYSTEM_FILES,
    });

    refreshFileCaches(response.treeChanged, response.changeEvent?.path);

    if (response.treeChanged) {
      try { revalidatePath('/', 'layout'); } catch { /* noop in test env */ }
    }

    if (response.changeEvent) {
      try {
        appendContentChange({
          ...response.changeEvent,
          source: response.source ?? 'user',
          agentName: response.source === 'agent' ? agentName : undefined,
        });
      } catch (logError) {
        console.warn('[file.route] failed to append content change log:', (logError as Error).message);
      }
    }

    return toNextResponse(response);
  } catch (e) {
    return handleRouteErrorSimple(e);
  }
}

/**
 * The product handler writes straight to disk, bypassing the lib/fs in-memory
 * caches (file tree, known-file set, search and link indexes). Without this the
 * sidebar, search and backlinks keep serving stale data until the TTL or the
 * file watcher catches up. Tree-shape operations drop everything; content
 * edits take the same incremental path the watcher uses, which keeps the
 * search index warm instead of forcing a full rebuild on every save.
 */
function refreshFileCaches(treeChanged: boolean | undefined, changedPath: string | undefined): void {
  if (treeChanged) {
    invalidateCache();
    return;
  }
  if (!changedPath) return;
  handleWatcherEvent(changedPath);
  flushWatcherChanges();
}
