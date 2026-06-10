export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { effectiveSopRoot } from '@/lib/settings';
import { saveToInbox } from '@/lib/core/inbox';
import { clipUrl, createFallbackWebClip, isSafeHttpUrlForFetch, isValidUrl } from '@/lib/core/web-clip';
import { invalidateCache } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';

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

  const { url } = (body ?? {}) as { url?: string };
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'Request body must contain a url string' }, { status: 400 });
  }

  if (!isValidUrl(url)) {
    return NextResponse.json({ error: 'Invalid URL — only http:// and https:// are supported' }, { status: 400 });
  }
  if (!isSafeHttpUrlForFetch(url)) {
    return NextResponse.json({ error: 'Unsafe URL — local and private network addresses are not supported' }, { status: 400 });
  }

  try {
    let clip;
    try {
      clip = await clipUrl(url);
    } catch (clipError) {
      if (clipError instanceof Error && /unsafe/i.test(clipError.message)) {
        throw clipError;
      }
      clip = createFallbackWebClip(url);
    }

    const result = saveToInbox(
      mindRoot,
      [{ name: clip.fileName, content: clip.markdown }],
      'web-clipper',
    );

    if (result.saved.length > 0) {
      invalidateCache();
      try { revalidatePath('/', 'layout'); } catch { /* test env */ }
    }

    if (result.saved.length === 0) {
      const reason = result.skipped[0]?.reason ?? 'Web clip could not be saved';
      return NextResponse.json({ ok: false, error: reason, skipped: result.skipped }, { status: 422 });
    }

    return NextResponse.json({
      ok: true,
      title: clip.title,
      fileName: result.saved[0]?.path ?? clip.fileName,
      wordCount: clip.wordCount,
      siteName: clip.siteName,
      url: clip.url,
      mode: clip.mode,
    });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return handleRouteErrorSimple(err);
  }
}
