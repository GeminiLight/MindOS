export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { effectiveSopRoot } from '@/lib/settings';
import { listInboxFiles, saveToInbox } from '@/lib/core/inbox';
import { invalidateCache } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET() {
  const mindRoot = effectiveSopRoot().trim();
  if (!mindRoot) {
    return NextResponse.json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }

  try {
    const files = listInboxFiles(mindRoot);
    return NextResponse.json({ files });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function POST(req: NextRequest) {
  const mindRoot = effectiveSopRoot().trim();
  if (!mindRoot) {
    return NextResponse.json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !Array.isArray((body as { files?: unknown }).files)) {
    return NextResponse.json({ error: 'Request body must contain a files array' }, { status: 400 });
  }

  const { files, source } = body as { files: Array<{ name: string; content: string; encoding?: 'text' | 'base64' }>, source?: string };

  try {
    const result = saveToInbox(mindRoot, files, source);

    if (result.saved.length > 0) {
      invalidateCache();
      try { revalidatePath('/', 'layout'); } catch { /* test env */ }
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

export async function DELETE(req: NextRequest) {
  const mindRoot = effectiveSopRoot().trim();
  if (!mindRoot) {
    return NextResponse.json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { names } = (body ?? {}) as { names?: string[] };
  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json({ error: 'Request body must contain a non-empty names array' }, { status: 400 });
  }

  try {
    const { archiveFromInbox } = await import('@/lib/core/inbox');
    const result = archiveFromInbox(mindRoot, names);

    if (result.archived.length > 0) {
      invalidateCache();
      try { revalidatePath('/', 'layout'); } catch { /* test env */ }
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
