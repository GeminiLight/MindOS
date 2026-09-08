export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { Readable, PassThrough } from 'stream';
import { getMindRoot } from '@/lib/fs';
import { readFile } from '@/lib/core/fs-ops';
import { markdownToHTML, collectExportFiles, type ExportFileEntry } from '@/lib/core/export';
import { handleRouteErrorSimple } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filePath = searchParams.get('path');
  const format = searchParams.get('format') ?? 'md';
  const VALID_FORMATS = new Set(['md', 'html', 'zip', 'zip-html']);

  if (!filePath) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  if (!VALID_FORMATS.has(format)) {
    return NextResponse.json({ error: `Invalid format: ${format}. Use: ${[...VALID_FORMATS].join(', ')}` }, { status: 400 });
  }

  // Absolute paths are never valid API inputs; traversal is handled by resolveSafe().
  if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const mindRoot = getMindRoot();

  try {
    // ── Single file export ──
    if (format === 'md') {
      const content = readFile(mindRoot, filePath);
      const fileName = path.basename(filePath);
      return new NextResponse(content, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        },
      });
    }

    if (format === 'html') {
      const content = readFile(mindRoot, filePath);
      const title = path.basename(filePath, '.md');
      const html = await markdownToHTML(content, title, filePath);
      const fileName = path.basename(filePath, '.md') + '.html';
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        },
      });
    }

    // ── Directory/Space ZIP export ──
    if (format === 'zip' || format === 'zip-html') {
      const files = collectExportFiles(mindRoot, filePath);
      if (files.length === 0) {
        return NextResponse.json({ error: 'No exportable files found' }, { status: 404 });
      }

      const spaceName = path.basename(filePath);
      const date = new Date().toISOString().slice(0, 10);
      const zipName = `${spaceName}-${date}.zip`;

      const passThrough = await streamZipArchive(files, format, req.signal);

      // Convert Node stream to Web ReadableStream
      const readable = Readable.toWeb(passThrough) as ReadableStream;

      return new NextResponse(readable, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName)}"`,
        },
      });
    }

    return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}

/**
 * Build the zip as a stream. Plain entries are handed to archiver by path so it
 * reads each file lazily instead of the route buffering the whole space first;
 * zip-html still converts one markdown file at a time. A client disconnect
 * (req.signal) aborts the archive so no more disk reads or compression happen
 * for a response nobody will receive.
 */
async function streamZipArchive(
  files: ExportFileEntry[],
  format: 'zip' | 'zip-html',
  signal: AbortSignal,
): Promise<PassThrough> {
  const archive = archiver('zip', { zlib: { level: 6 } });
  const passThrough = new PassThrough();
  // Pipe archive errors to the passthrough stream
  archive.on('error', (err) => passThrough.destroy(err));
  archive.pipe(passThrough);

  const abortArchive = () => { archive.abort(); };
  if (signal.aborted) {
    abortArchive();
    return passThrough;
  }
  signal.addEventListener('abort', abortArchive, { once: true });
  passThrough.once('close', () => signal.removeEventListener('abort', abortArchive));

  for (const file of files) {
    if (signal.aborted) break;
    if (format === 'zip-html' && file.relativePath.endsWith('.md')) {
      // Convert each MD file to HTML, one file at a time
      const content = await fsp.readFile(file.absPath, 'utf-8');
      if (signal.aborted) break;
      const title = path.basename(file.relativePath, '.md');
      const html = await markdownToHTML(content, title, file.relativePath);
      if (signal.aborted) break;
      archive.append(html, { name: file.relativePath.replace(/\.md$/, '.html') });
    } else {
      archive.file(file.absPath, { name: file.relativePath });
    }
  }

  if (!signal.aborted) {
    // Rejections are already surfaced through the 'error' listener above.
    archive.finalize().catch(() => { /* handled via 'error' */ });
  }
  return passThrough;
}
