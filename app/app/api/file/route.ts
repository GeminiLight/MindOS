import { NextRequest, NextResponse } from 'next/server';
import {
  getFileContent,
  saveFileContent,
  appendToFile,
  readLines,
  insertLines,
  updateLines,
  deleteLines,
  insertAfterHeading,
  updateSection,
  deleteFile,
  renameFile,
} from '@/lib/fs';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// GET /api/file?path=foo.md&op=read_file|read_lines
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('path');
  const op = req.nextUrl.searchParams.get('op') ?? 'read_file';
  if (!filePath) return err('missing path');

  try {
    if (op === 'read_lines') {
      return NextResponse.json({ lines: readLines(filePath) });
    }
    // default: read_file
    return NextResponse.json({ content: getFileContent(filePath) });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

// POST /api/file  body: { op, path, ...params }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('invalid JSON'); }

  const { op, path: filePath, ...params } = body as Record<string, unknown>;
  if (!op || typeof op !== 'string') return err('missing op');
  if (!filePath || typeof filePath !== 'string') return err('missing path');

  try {
    switch (op) {

      case 'save_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        saveFileContent(filePath, content);
        return NextResponse.json({ ok: true });
      }

      case 'append_to_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        appendToFile(filePath, content);
        return NextResponse.json({ ok: true });
      }

      case 'insert_lines': {
        const { after_index, lines } = params as { after_index: number; lines: string[] };
        if (typeof after_index !== 'number') return err('missing after_index');
        if (!Array.isArray(lines)) return err('lines must be array');
        insertLines(filePath, after_index, lines);
        return NextResponse.json({ ok: true });
      }

      case 'update_lines': {
        const { start, end, lines } = params as { start: number; end: number; lines: string[] };
        if (typeof start !== 'number' || typeof end !== 'number') return err('missing start/end');
        if (!Array.isArray(lines)) return err('lines must be array');
        if (start < 0 || end < 0) return err('start/end must be >= 0');
        if (start > end) return err('start must be <= end');
        updateLines(filePath, start, end, lines);
        return NextResponse.json({ ok: true });
      }

      case 'delete_lines': {
        const { start, end } = params as { start: number; end: number };
        if (typeof start !== 'number' || typeof end !== 'number') return err('missing start/end');
        if (start < 0 || end < 0) return err('start/end must be >= 0');
        if (start > end) return err('start must be <= end');
        deleteLines(filePath, start, end);
        return NextResponse.json({ ok: true });
      }

      case 'insert_after_heading': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        insertAfterHeading(filePath, heading, content);
        return NextResponse.json({ ok: true });
      }

      case 'update_section': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        updateSection(filePath, heading, content);
        return NextResponse.json({ ok: true });
      }

      case 'delete_file': {
        deleteFile(filePath);
        return NextResponse.json({ ok: true });
      }

      case 'rename_file': {
        const { new_name } = params as { new_name: string };
        if (typeof new_name !== 'string' || !new_name) return err('missing new_name');
        const newPath = renameFile(filePath, new_name);
        return NextResponse.json({ ok: true, newPath });
      }

      default:
        return err(`unknown op: ${op}`);
    }
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
