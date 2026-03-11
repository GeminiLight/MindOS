import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const runtime = 'nodejs';

const MAX_TEXT_CHARS = 30_000;
const MAX_BYTES = 12 * 1024 * 1024; // 12MB

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}\n\n[...truncated from PDF]`;
}

/**
 * Extract PDF text by spawning a Node child process.
 *
 * pdfjs-dist requires a web-worker file. Turbopack rewrites the ESM
 * `import.meta.url` references inside the bundle, breaking the worker
 * resolution at runtime. Running the extraction in a plain Node process
 * avoids the bundler entirely.
 */
function extractPdf(buf: Buffer): { text: string; pages: number } {
  // Write PDF to a temp file so the child script can read it.
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `pdf-extract-${Date.now()}.pdf`);
  // Dynamic path construction to prevent Turbopack static analysis
  const scriptPath = [process.cwd(), 'scripts', 'extract-pdf.cjs'].join(path.sep);

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

    const { text: rawText, pages } = extractPdf(raw);
    const text = rawText.replace(/\u0000/g, '').trim();

    return NextResponse.json({
      name,
      text: truncateText(text),
      extracted: text.length > 0,
      pagesParsed: pages,
    });
  } catch (err) {
    console.error('[extract-pdf] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to extract PDF text' },
      { status: 500 },
    );
  }
}
