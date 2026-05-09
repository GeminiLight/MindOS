export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  handleInboxDelete,
  handleInboxGet,
  handleInboxPost,
  type InboxArchiveResult,
  type InboxSaveResult,
} from '@geminilight/mindos/server';
import { effectiveSopRoot } from '@/lib/settings';
import { invalidateCache } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

export function GET() {
  try {
    return toNextResponse(handleInboxGet({ mindRoot: effectiveMindRoot() }));
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = handleInboxPost(body, { mindRoot: effectiveMindRoot() });
    if (hasSavedFiles(response.body)) {
      refreshKnowledgeViews();
    }
    return toNextResponse(response);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function DELETE(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const response = handleInboxDelete(body, { mindRoot: effectiveMindRoot() });
    if (hasArchivedFiles(response.body)) {
      refreshKnowledgeViews();
    }
    return toNextResponse(response);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

function effectiveMindRoot() {
  return effectiveSopRoot().trim();
}

function hasSavedFiles(body: unknown): body is InboxSaveResult {
  return Boolean(body && typeof body === 'object' && Array.isArray((body as InboxSaveResult).saved) && (body as InboxSaveResult).saved.length > 0);
}

function hasArchivedFiles(body: unknown): body is InboxArchiveResult {
  return Boolean(body && typeof body === 'object' && Array.isArray((body as InboxArchiveResult).archived) && (body as InboxArchiveResult).archived.length > 0);
}

function refreshKnowledgeViews() {
  invalidateCache();
  try {
    revalidatePath('/', 'layout');
  } catch {
    // Next cache revalidation is unavailable in some test runtimes.
  }
}
