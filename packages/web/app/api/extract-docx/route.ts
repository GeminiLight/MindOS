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

interface ExtractedContent {
  text: string;
  markdown: string;
  extracted: boolean;
  pages: number;
  chars: number;
  truncated: boolean;
  charsTruncated: number;
  imageCount: number;
  hasCharts: boolean;
  warning?: string;
  error?: string;
  message?: string;
}

function truncateContent(
  content: ExtractedContent
): { result: ExtractedContent; truncated: boolean } {
  if (content.chars <= MAX_TEXT_CHARS) {
    return { result: content, truncated: false };
  }

  return {
    result: {
      ...content,
      text: content.text.substring(0, MAX_TEXT_CHARS),
      markdown: content.markdown.substring(0, MAX_TEXT_CHARS),
      truncated: true,
      charsTruncated: MAX_TEXT_CHARS,
      warning:
        content.warning &&
        content.warning.length > 0
          ? `${content.warning}；内容过长，已截断到 ${Math.round(MAX_TEXT_CHARS / 1000)}K 字`
          : `内容过长，已截断到 ${Math.round(MAX_TEXT_CHARS / 1000)}K 字`,
    },
    truncated: true,
  };
}

/**
 * Extract Word (.doc/.docx/.docm) text by spawning a Node child process.
 * The temp file extension must match the original so the script picks the right parser.
 */
function extractWord(buf: Buffer, originalName: string): ExtractedContent {
  const scriptPath = resolveScript('extract-docx.cjs');
  if (!scriptPath) {
    throw new Error(
      'extract-docx.cjs not found. Searched: $MINDOS_PROJECT_ROOT/packages/web/scripts/, cwd/scripts/, and standalone fallbacks.'
    );
  }

  // Preserve original extension so the child script picks the right parser (.doc vs .docx)
  const ext = path.extname(originalName).toLowerCase() || '.docx';
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `word-extract-${Date.now()}${ext}`);

  fs.writeFileSync(tmpFile, buf);
  try {
    const stdout = execFileSync('node', [scriptPath, tmpFile], {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

export async function POST(req: NextRequest) {
  let body: { name?: string; dataBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = body.name ?? 'uploaded.docx';
  const dataBase64 = body.dataBase64;
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return NextResponse.json(
      { error: 'dataBase64 is required' },
      { status: 400 }
    );
  }

  try {
    const raw = Buffer.from(dataBase64, 'base64');
    if (raw.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Word file is too large (max 12MB)' },
        { status: 400 }
      );
    }

    const content = extractWord(raw, name);

    // If extraction failed
    if (!content.extracted) {
      return NextResponse.json({
        name,
        text: '',
        markdown: '',
        extracted: false,
        extractionError: content.error,
        errorMessage: content.message,
        truncated: false,
        chars: 0,
        charsTruncated: 0,
        pages: 0,
        imageCount: 0,
        hasCharts: false,
      });
    }

    const { result: finalContent } = truncateContent(content);

    return NextResponse.json({
      name,
      text: finalContent.text,
      markdown: finalContent.markdown,
      extracted: true,
      truncated: finalContent.truncated,
      chars: finalContent.chars,
      charsTruncated: finalContent.charsTruncated,
      pages: finalContent.pages,
      imageCount: finalContent.imageCount,
      hasCharts: finalContent.hasCharts,
      warning: finalContent.warning,
    });
  } catch (err) {
    console.error('[extract-docx] Error:', err);
    return handleRouteErrorSimple(err);
  }
}
