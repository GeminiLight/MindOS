export const dynamic = 'force-dynamic';
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveSafe } from '@/lib/core/security';
import { sanitizeFileName, convertToMarkdown } from '@/lib/core/file-convert';
import { effectiveSopRoot } from '@/lib/settings';
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
  listMindSpaces,
  appendContentChange,
} from '@/lib/fs';
import { createSpaceFilesystem } from '@/lib/core/create-space';
import { appendAgentAuditEvent, parseAgentAuditJsonLines } from '@/lib/core/agent-audit-log';

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function safeRead(filePath: string): string {
  try {
    return getFileContent(filePath);
  } catch {
    return '';
  }
}

function sourceFromRequest(req: NextRequest, body: Record<string, unknown>) {
  const bodySource = body.source;
  if (bodySource === 'agent' || bodySource === 'user' || bodySource === 'system') return bodySource;
  const headerSource = req.headers.get('x-mindos-source');
  if (headerSource === 'agent' || headerSource === 'user' || headerSource === 'system') return headerSource;
  // If request has x-mindos-agent header, it's from an agent
  if (req.headers.get('x-mindos-agent')) return 'agent' as const;
  return 'user' as const;
}

/** Extract agent name from request (MCP client identity, e.g. "claude-code"). */
function agentNameFromRequest(req: NextRequest): string | undefined {
  const name = req.headers.get('x-mindos-agent');
  return name && name.trim() ? name.trim() : undefined;
}

// GET /api/file?path=foo.md&op=read_file|read_lines | GET ?op=list_spaces (no path)
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('path');
  const op = req.nextUrl.searchParams.get('op') ?? 'read_file';

  if (op === 'list_spaces') {
    try {
      return NextResponse.json({ spaces: listMindSpaces() });
    } catch (e) {
      return err((e as Error).message, 500);
    }
  }

  if (op === 'check_conflicts') {
    const names = req.nextUrl.searchParams.get('names');
    const space = req.nextUrl.searchParams.get('space') ?? '';
    if (!names) return err('missing names');
    try {
      const mindRoot = effectiveSopRoot().trim();
      if (!mindRoot) return err('MIND_ROOT not configured');
      const fileNames = names.split(',').map(n => n.trim()).filter(Boolean);
      const conflicts: string[] = [];
      for (const name of fileNames) {
        const sanitized = sanitizeFileName(name);
        const { targetName } = convertToMarkdown(sanitized, '');
        const rel = space ? path.posix.join(space, targetName) : targetName;
        const resolved = resolveSafe(mindRoot, rel);
        if (fs.existsSync(resolved)) conflicts.push(name);
      }
      return NextResponse.json({ conflicts });
    } catch (e) {
      return err((e as Error).message, 500);
    }
  }

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
    let changeEvent:
      | {
        op: string;
        path: string;
        summary: string;
        before?: string;
        after?: string;
        beforePath?: string;
        afterPath?: string;
      }
      | null = null;

    switch (op) {

      case 'save_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        const before = safeRead(filePath);
        saveFileContent(filePath, content);
        changeEvent = {
          op,
          path: filePath,
          summary: 'Updated file content',
          before,
          after: content,
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'append_to_file': {
        const { content } = params as { content: string };
        if (typeof content !== 'string') return err('missing content');
        if (filePath === '.agent-log.json') {
          const entries = parseAgentAuditJsonLines(content);
          for (const entry of entries) {
            appendAgentAuditEvent(getMindRoot(), entry);
          }
          resp = NextResponse.json({ ok: true, migratedEntries: entries.length });
          break;
        }
        const before = safeRead(filePath);
        appendToFile(filePath, content);
        changeEvent = {
          op,
          path: filePath,
          summary: 'Appended content to file',
          before,
          after: safeRead(filePath),
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'insert_lines': {
        const { after_index, lines } = params as { after_index: number; lines: string[] };
        if (typeof after_index !== 'number') return err('missing after_index');
        if (!Array.isArray(lines)) return err('lines must be array');
        const before = safeRead(filePath);
        insertLines(filePath, after_index, lines);
        changeEvent = {
          op,
          path: filePath,
          summary: `Inserted ${lines.length} line(s)`,
          before,
          after: safeRead(filePath),
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'update_lines': {
        const { start, end, lines } = params as { start: number; end: number; lines: string[] };
        if (typeof start !== 'number' || typeof end !== 'number') return err('missing start/end');
        if (!Array.isArray(lines)) return err('lines must be array');
        if (start < 0 || end < 0) return err('start/end must be >= 0');
        if (start > end) return err('start must be <= end');
        const before = safeRead(filePath);
        updateLines(filePath, start, end, lines);
        changeEvent = {
          op,
          path: filePath,
          summary: `Updated lines ${start}-${end}`,
          before,
          after: safeRead(filePath),
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'insert_after_heading': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        const before = safeRead(filePath);
        insertAfterHeading(filePath, heading, content);
        changeEvent = {
          op,
          path: filePath,
          summary: `Inserted content after heading "${heading}"`,
          before,
          after: safeRead(filePath),
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'update_section': {
        const { heading, content } = params as { heading: string; content: string };
        if (typeof heading !== 'string') return err('missing heading');
        if (typeof content !== 'string') return err('missing content');
        const before = safeRead(filePath);
        updateSection(filePath, heading, content);
        changeEvent = {
          op,
          path: filePath,
          summary: `Updated section "${heading}"`,
          before,
          after: safeRead(filePath),
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'delete_file': {
        const before = safeRead(filePath);
        deleteFile(filePath);
        changeEvent = {
          op,
          path: filePath,
          summary: 'Deleted file',
          before,
          after: '',
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'rename_file': {
        const { new_name } = params as { new_name: string };
        if (typeof new_name !== 'string' || !new_name) return err('missing new_name');
        const before = safeRead(filePath);
        const newPath = renameFile(filePath, new_name);
        changeEvent = {
          op,
          path: newPath,
          summary: `Renamed file to ${new_name}`,
          before,
          after: safeRead(newPath),
          beforePath: filePath,
          afterPath: newPath,
        };
        resp = NextResponse.json({ ok: true, newPath });
        break;
      }

      case 'create_file': {
        const { content } = params as { content?: string };
        const after = typeof content === 'string' ? content : '';
        createFile(filePath, after);
        changeEvent = {
          op,
          path: filePath,
          summary: 'Created file',
          before: '',
          after,
        };
        resp = NextResponse.json({ ok: true });
        break;
      }

      case 'move_file': {
        const { to_path } = params as { to_path: string };
        if (typeof to_path !== 'string' || !to_path) return err('missing to_path');
        const before = safeRead(filePath);
        const result = moveFile(filePath, to_path);
        changeEvent = {
          op,
          path: result.newPath,
          summary: `Moved file to ${result.newPath}`,
          before,
          after: safeRead(result.newPath),
          beforePath: filePath,
          afterPath: result.newPath,
        };
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
          changeEvent = {
            op,
            path: spacePath,
            summary: 'Created space',
            before: '',
            after: description,
          };
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
        changeEvent = {
          op,
          path: newPath,
          summary: `Renamed space to ${new_name.trim()}`,
          beforePath: filePath,
          afterPath: newPath,
        };
        resp = NextResponse.json({ ok: true, newPath });
        break;
      }

      case 'append_csv': {
        const { row } = params as { row: string[] };
        if (!Array.isArray(row) || row.length === 0) return err('row must be non-empty array');
        const before = safeRead(filePath);
        const result = appendCsvRow(filePath, row);
        changeEvent = {
          op,
          path: filePath,
          summary: `Appended CSV row (${row.length} cell${row.length === 1 ? '' : 's'})`,
          before,
          after: safeRead(filePath),
        };
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

    if (changeEvent) {
      try {
        appendContentChange({
          ...changeEvent,
          source: sourceFromRequest(req, body),
        });
      } catch (logError) {
        console.warn('[file.route] failed to append content change log:', (logError as Error).message);
      }
    }

    return resp;
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
