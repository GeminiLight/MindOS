import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import archiver from 'archiver';
import { Readable, PassThrough } from 'stream';
import { getMindRoot } from '@/lib/fs';
import { readFile } from '@/lib/core/fs-ops';
import { markdownToHTML, collectExportFiles } from '@/lib/core/export';
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

  // Path traversal defense-in-depth
  if (filePath.includes('..') || filePath.startsWith('/')) {
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

      // Create archive
      const archive = archiver('zip', { zlib: { level: 6 } });
      const passThrough = new PassThrough();
      archive.pipe(passThrough);

      if (format === 'zip-html') {
        // Convert each MD file to HTML
        for (const file of files) {
          if (file.relativePath.endsWith('.md')) {
            const title = path.basename(file.relativePath, '.md');
            const html = await markdownToHTML(file.content, title, file.relativePath);
            const htmlPath = file.relativePath.replace(/\.md$/, '.html');
            archive.append(html, { name: htmlPath });
          } else {
            archive.append(file.content, { name: file.relativePath });
          }
        }
      } else {
        for (const file of files) {
          archive.append(file.content, { name: file.relativePath });
        }
      }

      // Pipe archive errors to the passthrough stream
      archive.on('error', (err) => passThrough.destroy(err));
      void archive.finalize();

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
