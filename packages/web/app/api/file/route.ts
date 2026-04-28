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
  readLines,
  getFileTree,
  listMindSpaces,
  appendContentChange,
} from '@/lib/fs';
import { handleRouteErrorSimple } from '@/lib/errors';
import { executeKnowledgeOperation } from './operation-kernel';

/** Return 400 for client validation errors. */
function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

/** Catch unexpected errors and return { error } with proper status. */
const handleError = handleRouteErrorSimple;

/** Recursively collect all directory paths from the file tree. */
function collectDirectories(nodes: import('@/lib/types').FileNode[]): string[] {
  const dirs: string[] = [];
  for (const n of nodes) {
    if (n.type === 'directory') {
      dirs.push(n.path);
      if (n.children) dirs.push(...collectDirectories(n.children));
    }
  }
  return dirs;
}

// GET /api/file?path=foo.md&op=read_file|read_lines | GET ?op=list_spaces (no path)
export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get('path');
  const op = req.nextUrl.searchParams.get('op') ?? 'read_file';

  if (op === 'list_spaces') {
    try {
      return NextResponse.json({ spaces: listMindSpaces() });
    } catch (e) {
      return handleError(e);
    }
  }

  if (op === 'list_dirs') {
    try {
      return NextResponse.json({ dirs: collectDirectories(getFileTree()) });
    } catch (e) {
      return handleError(e);
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
      return handleError(e);
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
    return handleError(e);
  }
}

// POST /api/file  body: { op, path, ...params }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err('invalid JSON'); }

  try {
    const { resp, changeEvent, source, treeChanged } = await executeKnowledgeOperation(req, body);

    // Invalidate Next.js router cache so sidebar file tree updates
    if (treeChanged) {
      try { revalidatePath('/', 'layout'); } catch { /* noop in test env */ }
    }

    if (changeEvent) {
      try {
        appendContentChange({ ...changeEvent, source });
      } catch (logError) {
        console.warn('[file.route] failed to append content change log:', (logError as Error).message);
      }
    }

    return resp;
  } catch (e) {
    return handleError(e);
  }
}
