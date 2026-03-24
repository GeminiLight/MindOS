export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  getFileContent,
  saveFileContent,
  createFile,
  appendToFile,
  readLines,
  insertLines,
  updateLines,
  insertAfterHeading,
  updateSection,
  deleteFile,
  renameFile,
  renameSpace,
  moveFile,
  appendCsvRow,
  getMindRoot,
  invalidateCache,
} from '@/lib/fs';
import { createSpaceFilesystem } from '@/lib/core/create-space';

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

// Ops that change file tree structure (sidebar needs refresh)
const TREE_CHANGING_OPS = new Set([
  'create_file',
  'delete_file',
  'rename_file',
  'move_file',
  'create_space',
  'rename_space',
]);

// POST /api/file  body: { op, path, ...params }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('invalid JSON'); }

  const { op, path: filePath, ...params } = body as Record<string, unknown>;
  if (!op || typeof op !== 'string') return err('missing op');
  if (!filePath || typeof filePath !== 'string') return err('missing path');

  try {
    let resp: NextResponse;

    switch (op) {

      case 'save_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        saveFileContent(filePath, content);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'append_to_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        appendToFile(filePath, content);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'insert_lines': {
        const { after_index, lines } = params as { after_index: number; lines: string[] };
        if (typeof after_index !== 'number') return err('missing after_index');
        if (!Array.isArray(lines)) return err('lines must be array');
        insertLines(filePath, after_index, lines);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'update_lines': {
        const { start, end, lines } = params as { start: number; end: number; lines: string[] };
        if (typeof start !== 'number' || typeof end !== 'number') return err('missing start/end');
        if (!Array.isArray(lines)) return err('lines must be array');
        if (start < 0 || end < 0) return err('start/end must be >= 0');
        if (start > end) return err('start must be <= end');
        updateLines(filePath, start, end, lines);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'insert_after_heading': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        insertAfterHeading(filePath, heading, content);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'update_section': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        updateSection(filePath, heading, content);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'delete_file': {
        deleteFile(filePath);
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'rename_file': {
        const { new_name } = params as { new_name: string };
        if (typeof new_name !== 'string' || !new_name) return err('missing new_name');
        const newPath = renameFile(filePath, new_name);
        resp = NextResponse.json({ ok: true, newPath });
        break;
      }

      case 'create_file': {
        const { content } = params as { content?: string };
        createFile(filePath, typeof content === 'string' ? content : '');
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'move_file': {
        const { to_path } = params as { to_path: string };
        if (typeof to_path !== 'string' || !to_path) return err('missing to_path');
        const result = moveFile(filePath, to_path);
        resp = NextResponse.json({ ok: true, ...result });
        break;
      }

      case 'create_space': {
        const name = params.name;
        const description = typeof params.description === 'string' ? params.description : '';
        const parent_path = typeof params.parent_path === 'string' ? params.parent_path : '';
        if (typeof name !== 'string' || !name.trim()) {
          return err('missing or empty name');
        }
        try {
          const { path: spacePath } = createSpaceFilesystem(getMindRoot(), name, description, parent_path);
          invalidateCache();
          resp = NextResponse.json({ ok: true, path: spacePath });
        } catch (e) {
          const msg = (e as Error).message;
          const code400 =
            msg.includes('required') ||
            msg.includes('must not contain') ||
            msg.includes('Invalid parent') ||
            msg.includes('already exists');
          return err(msg, code400 ? 400 : 500);
        }
        break;
      }

      case 'rename_space': {
        const { new_name } = params as { new_name: string };
        if (typeof new_name !== 'string' || !new_name.trim()) return err('missing new_name');
        const newPath = renameSpace(filePath, new_name.trim());
        resp = NextResponse.json({ ok: true, newPath });
        break;
      }

      case 'append_csv': {
        const { row } = params as { row: string[] };
        if (!Array.isArray(row) || row.length === 0) return err('row must be non-empty array');
        const result = appendCsvRow(filePath, row);
        resp = NextResponse.json({ ok: true, ...result });
        break;
      }

      default:
        return err(`unknown op: ${op}`);
    }

    // Invalidate Next.js router cache so sidebar file tree updates
    if (TREE_CHANGING_OPS.has(op)) {
      try { revalidatePath('/', 'layout'); } catch { /* noop in test env */ }
    }

    return resp;
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
