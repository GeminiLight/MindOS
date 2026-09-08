export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import path from 'path';
import { handleInboxPost, type InboxSaveInput, type InboxSaveResult } from '@geminilight/mindos/server';
import { effectiveSopRoot } from '@/lib/settings';
import {
  captureUrl,
  createFallbackWebClip,
  isSafeHttpUrlForFetch,
  isValidUrl,
  type UrlCaptureResult,
  type WebFileCaptureResult,
} from '@/lib/core/web-clip';
import { expandInboxDocumentCaptures } from '@/lib/core/inbox-document-capture';
import { invalidateCache } from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { detectSourcePlatform } from '@/lib/link-preview/source-platforms';
import { serializeMarkdownFrontmatter } from '@/lib/parsing/frontmatter';

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

  const { url, expectedRootId } = (body ?? {}) as { url?: string; expectedRootId?: unknown };
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
    let clip: UrlCaptureResult;
    try {
      clip = await captureUrl(url);
    } catch (clipError) {
      if (clipError instanceof Error && /unsafe/i.test(clipError.message)) {
        throw clipError;
      }
      clip = createFallbackWebClip(url);
    }

    const files = await buildInboxClipFiles(clip);

    const response = handleInboxPost({ files, source: 'web-clipper', ...(expectedRootId !== undefined ? { expectedRootId } : {}) }, { mindRoot });
    if (response.status >= 400 || !isInboxSaveResult(response.body)) {
      const error = response.body && typeof response.body === 'object' && 'error' in response.body
        ? String((response.body as { error?: unknown }).error ?? 'Web clip could not be saved')
        : 'Web clip could not be saved';
      return NextResponse.json({ ok: false, error }, { status: response.status >= 400 ? response.status : 422 });
    }

    const result = response.body;
    const savedFile = result.saved.find(item => item.original === clip.fileName) ?? result.saved[0];
    const companionName = clip.mode === 'file' ? companionMarkdownName(clip.fileName) : null;
    const savedCompanion = companionName
      ? result.saved.find(item => item.original === companionName)
      : undefined;

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
      fileName: savedFile?.path ?? clip.fileName,
      ...(savedCompanion ? { companionFileName: savedCompanion.path } : {}),
      wordCount: clip.wordCount,
      siteName: clip.siteName,
      url: clip.url,
      mode: clip.mode,
      ...(clip.mode === 'file' ? { contentType: clip.contentType, byteLength: clip.byteLength } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return handleRouteErrorSimple(err);
  }
}

async function buildInboxClipFiles(clip: UrlCaptureResult): Promise<InboxSaveInput[]> {
  if (clip.mode !== 'file') {
    return [{ name: clip.fileName, content: clip.markdown }];
  }

  const original: InboxSaveInput = {
    name: clip.fileName,
    content: clip.contentBase64,
    encoding: 'base64',
  };
  const expanded = await expandInboxDocumentCaptures([original]);
  const companionName = companionMarkdownName(clip.fileName);
  const companionIndex = expanded.files.findIndex(file => file.name === companionName && file.encoding === 'text');

  if (companionIndex >= 0) {
    const extracted = expanded.files[companionIndex];
    expanded.files[companionIndex] = {
      ...extracted,
      content: buildWebFileCompanionMarkdown(clip, extracted.content),
      encoding: 'text',
    };
    return expanded.files.map(toInboxSaveInput);
  }

  return [
    ...expanded.files,
    {
      name: companionName,
      content: buildWebFileCompanionMarkdown(clip),
      encoding: 'text',
    },
  ].map(toInboxSaveInput);
}

function toInboxSaveInput(file: { name: string; content: string; encoding?: string }): InboxSaveInput {
  return {
    name: file.name,
    content: file.content,
    ...(file.encoding === 'base64' || file.encoding === 'text' ? { encoding: file.encoding } : {}),
  };
}

function buildWebFileCompanionMarkdown(clip: WebFileCaptureResult, extractedMarkdown?: string): string {
  const platform = detectSourcePlatform(clip.url);
  const capturedAt = new Date();
  const frontmatter = serializeMarkdownFrontmatter({
    title: clip.title,
    type: 'material',
    status: 'active',
    created: formatLocalDate(capturedAt),
    source_type: 'web',
    source_url: clip.url,
    source_platform: platform?.id,
    site: clip.siteName ?? undefined,
    captured_at: capturedAt.toISOString(),
    captured_file: clip.fileName,
    content_type: clip.contentType,
  });
  const body = extractedMarkdown?.trim() || [
    `# ${clip.title}`,
    '',
    `> Source: ${clip.url}`,
    `> Captured file: ${clip.fileName}`,
    `> Content type: ${clip.contentType}`,
    `> Size: ${formatBytes(clip.byteLength)}`,
    '',
    '_The original file is preserved in Inbox._',
  ].join('\n');

  return `${frontmatter}${body}\n`;
}

function companionMarkdownName(fileName: string): string {
  const ext = path.extname(fileName);
  const stem = (ext ? fileName.slice(0, -ext.length) : fileName).trim() || 'web-clip';
  return `${stem}.md`;
}

function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`;
}

function isInboxSaveResult(body: unknown): body is InboxSaveResult {
  return Boolean(body && typeof body === 'object' && Array.isArray((body as InboxSaveResult).saved) && Array.isArray((body as InboxSaveResult).skipped));
}
