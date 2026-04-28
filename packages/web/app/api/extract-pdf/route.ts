export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { resolveScript } from '@/lib/core/resolve-script';
import { handleRouteErrorSimple } from '@/lib/errors';

export const runtime = 'nodejs';

const MAX_TEXT_CHARS = 100_000;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB

function truncateText(text: string): { result: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { result: text, truncated: false };
  return {
    result: `${text.slice(0, MAX_TEXT_CHARS)}\n\n[...content truncated — only first ~${Math.round(MAX_TEXT_CHARS / 1000)}K characters included]`,
    truncated: true,
  };
}

/**
 * Extract PDF text by spawning a Node child process.
 *
 * pdfjs-dist requires a web-worker file. Turbopack rewrites the ESM
 * `import.meta.url` references inside the bundle, breaking the worker
 * resolution at runtime. Running the extraction in a plain Node process
 * avoids the bundler entirely.
 */
function extractPdf(buf: Buffer): { text: string; pages: number; error?: string } {
  const scriptPath = resolveScript('extract-pdf.cjs');
  if (!scriptPath) {
    throw new Error(
      'extract-pdf.cjs not found. Searched: $MINDOS_PROJECT_ROOT/packages/web/scripts/, cwd/scripts/, and standalone fallbacks.'
    );
  }

  // Write PDF to a temp file so the child script can read it.
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `pdf-extract-${Date.now()}.pdf`);

  fs.writeFileSync(tmpPdf, buf);
  try {
    const stdout = execFileSync('node', [scriptPath, tmpPdf], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch { /* ignore */ }
  }
}

export async function POST(req: NextRequest) {
  let body: { name?: string; dataBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = body.name ?? 'uploaded.pdf';
  const dataBase64 = body.dataBase64;
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return NextResponse.json({ error: 'dataBase64 is required' }, { status: 400 });
  }

  try {
    const raw = Buffer.from(dataBase64, 'base64');
    if (raw.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'PDF is too large (max 12MB)' }, { status: 400 });
    }

    const { text: rawText, pages, error: extractError } = extractPdf(raw);
    
    // If extraction failed, return error state
    if (extractError) {
      return NextResponse.json({
        name,
        text: '',
        extracted: 'error' as const,
        extractionError: extractError,
        truncated: false,
        totalChars: 0,
        pagesParsed: pages ?? 0,
      });
    }
    
    const text = rawText.replace(/\u0000/g, '').trim();
    const totalChars = text.length;
    const { result: finalText, truncated } = truncateText(text);

    return NextResponse.json({
      name,
      text: finalText,
      extracted: text.length > 0 ? 'success' : 'empty',
      truncated,
      totalChars,
      pagesParsed: pages,
    });
  } catch (err) {
    console.error('[extract-pdf] Error:', err);
    return handleRouteErrorSimple(err);
  }
}
