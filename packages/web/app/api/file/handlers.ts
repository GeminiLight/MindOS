/**
 * File operation handlers for POST /api/file.
 *
 * Each handler owns its own parameter validation and returns
 * a response + optional change event for audit logging.
 */
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  getFileContent,
  saveFileContent,
  createFile,
  appendToFile,
  insertLines,
  updateLines,
  insertAfterHeading,
  updateSection,
  moveToTrashFile,
  renameFile,
  renameSpace,
  moveFile,
  appendCsvRow,
  getMindRoot,
  invalidateCache,
} from '@/lib/fs';
import { UNDELETABLE_FILES } from '@/lib/types';
import { createSpaceFilesystem } from '@/lib/core/create-space';
import { appendAgentAuditEvent, parseAgentAuditJsonLines } from '@/lib/core/agent-audit-log';
import { resolveSafe } from '@/lib/core/security';
import { effectiveSopRoot } from '@/lib/settings';
import { handleRouteErrorSimple } from '@/lib/errors';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ChangeEvent {
  op: string;
  path: string;
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

export interface FileOpResult {
  resp: NextResponse;
  changeEvent: ChangeEvent | null;
}

export type FileOpHandler = (
  filePath: string,
  params: Record<string, unknown>,
) => FileOpResult | Promise<FileOpResult>;

// ---------------------------------------------------------------------------
// Helpers (private to this module)
// ---------------------------------------------------------------------------

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function safeRead(filePath: string): string {
  try { return getFileContent(filePath); } catch { return ''; }
}

function isUndeletable(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  return !filePath.includes('/') && UNDELETABLE_FILES.has(basename);
}

// ---------------------------------------------------------------------------
// Handlers — one per operation
// ---------------------------------------------------------------------------

function handleSaveFile(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { content, expectedMtime } = params as { content: string; expectedMtime?: number };
  if (typeof content !== 'string') return { resp: err('missing content'), changeEvent: null };

  // Optimistic concurrency: if caller provides expectedMtime, verify the file
  // hasn't been modified since they last read it.
  if (typeof expectedMtime === 'number') {
    try {
      const mindRoot = effectiveSopRoot().trim();
      const fullPath = resolveSafe(mindRoot, filePath);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > expectedMtime) {
        return {
          resp: NextResponse.json(
            { error: 'conflict', serverMtime: stat.mtimeMs },
            { status: 409 },
          ),
          changeEvent: null,
        };
      }
    } catch {
      // File doesn't exist yet — no conflict possible
    }
  }

  const before = safeRead(filePath);
  saveFileContent(filePath, content);

  // Return new mtime so caller can track for future saves
  let newMtime: number | undefined;
  try {
    const mindRoot = effectiveSopRoot().trim();
    const fullPath = resolveSafe(mindRoot, filePath);
    newMtime = fs.statSync(fullPath).mtimeMs;
  } catch { /* ignore */ }

  return {
    resp: NextResponse.json({ ok: true, mtime: newMtime }),
    changeEvent: { op: 'save_file', path: filePath, summary: 'Updated file content', before, after: content },
  };
}

function handleAppendToFile(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { content } = params as { content: string };
  if (typeof content !== 'string') return { resp: err('missing content'), changeEvent: null };

  // Legacy: .agent-log.json migration path
  if (filePath === '.agent-log.json') {
    const entries = parseAgentAuditJsonLines(content);
    for (const entry of entries) appendAgentAuditEvent(getMindRoot(), entry);
    return { resp: NextResponse.json({ ok: true, migratedEntries: entries.length }), changeEvent: null };
  }

  const before = safeRead(filePath);
  appendToFile(filePath, content);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'append_to_file', path: filePath, summary: 'Appended content to file', before, after: safeRead(filePath) },
  };
}

function handleInsertLines(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { after_index, lines } = params as { after_index: number; lines: string[] };
  if (typeof after_index !== 'number') return { resp: err('missing after_index'), changeEvent: null };
  if (!Array.isArray(lines)) return { resp: err('lines must be array'), changeEvent: null };
  const before = safeRead(filePath);
  insertLines(filePath, after_index, lines);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'insert_lines', path: filePath, summary: `Inserted ${lines.length} line(s)`, before, after: safeRead(filePath) },
  };
}

function handleUpdateLines(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { start, end, lines } = params as { start: number; end: number; lines: string[] };
  if (typeof start !== 'number' || typeof end !== 'number') return { resp: err('missing start/end'), changeEvent: null };
  if (!Array.isArray(lines)) return { resp: err('lines must be array'), changeEvent: null };
  if (start < 0 || end < 0) return { resp: err('start/end must be >= 0'), changeEvent: null };
  if (start > end) return { resp: err('start must be <= end'), changeEvent: null };
  const before = safeRead(filePath);
  updateLines(filePath, start, end, lines);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'update_lines', path: filePath, summary: `Updated lines ${start}-${end}`, before, after: safeRead(filePath) },
  };
}

function handleInsertAfterHeading(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { heading, content } = params as { heading: string; content: string };
  if (typeof heading !== 'string') return { resp: err('missing heading'), changeEvent: null };
  if (typeof content !== 'string') return { resp: err('missing content'), changeEvent: null };
  const before = safeRead(filePath);
  insertAfterHeading(filePath, heading, content);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'insert_after_heading', path: filePath, summary: `Inserted content after heading "${heading}"`, before, after: safeRead(filePath) },
  };
}

function handleUpdateSection(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { heading, content } = params as { heading: string; content: string };
  if (typeof heading !== 'string') return { resp: err('missing heading'), changeEvent: null };
  if (typeof content !== 'string') return { resp: err('missing content'), changeEvent: null };
  const before = safeRead(filePath);
  updateSection(filePath, heading, content);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'update_section', path: filePath, summary: `Updated section "${heading}"`, before, after: safeRead(filePath) },
  };
}

function handleDeleteFile(filePath: string, _params: Record<string, unknown>): FileOpResult {
  if (isUndeletable(filePath)) {
    return { resp: err(`"${filePath}" is a protected file and cannot be deleted`, 403), changeEvent: null };
  }
  const before = safeRead(filePath);
  const trashMeta = moveToTrashFile(filePath);
  return {
    resp: NextResponse.json({ ok: true, trashId: trashMeta.id }),
    changeEvent: { op: 'delete_file', path: filePath, summary: 'Moved to trash', before, after: '' },
  };
}

function handleRenameFile(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { new_name } = params as { new_name: string };
  if (typeof new_name !== 'string' || !new_name) return { resp: err('missing new_name'), changeEvent: null };
  const before = safeRead(filePath);
  const newPath = renameFile(filePath, new_name);
  return {
    resp: NextResponse.json({ ok: true, newPath }),
    changeEvent: { op: 'rename_file', path: newPath, summary: `Renamed file to ${new_name}`, before, after: safeRead(newPath), beforePath: filePath, afterPath: newPath },
  };
}

function handleCreateFile(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { content } = params as { content?: string };
  const after = typeof content === 'string' ? content : '';
  createFile(filePath, after);
  return {
    resp: NextResponse.json({ ok: true }),
    changeEvent: { op: 'create_file', path: filePath, summary: 'Created file', before: '', after },
  };
}

function handleMoveFile(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { to_path } = params as { to_path: string };
  if (typeof to_path !== 'string' || !to_path) return { resp: err('missing to_path'), changeEvent: null };
  const before = safeRead(filePath);
  const result = moveFile(filePath, to_path);
  return {
    resp: NextResponse.json({ ok: true, ...result }),
    changeEvent: { op: 'move_file', path: result.newPath, summary: `Moved file to ${result.newPath}`, before, after: safeRead(result.newPath), beforePath: filePath, afterPath: result.newPath },
  };
}

function handleCreateSpace(filePath: string, params: Record<string, unknown>): FileOpResult {
  const name = params.name;
  const description = typeof params.description === 'string' ? params.description : '';
  const parent_path = typeof params.parent_path === 'string' ? params.parent_path : '';
  if (typeof name !== 'string' || !name.trim()) {
    return { resp: err('missing or empty name'), changeEvent: null };
  }
  try {
    const { path: spacePath } = createSpaceFilesystem(getMindRoot(), name, description, parent_path);
    invalidateCache();
    return {
      resp: NextResponse.json({ ok: true, path: spacePath }),
      changeEvent: { op: 'create_space', path: spacePath, summary: 'Created space', before: '', after: description },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isClientError =
      msg.includes('required') ||
      msg.includes('must not contain') ||
      msg.includes('Invalid parent') ||
      msg.includes('already exists');
    return { resp: handleRouteErrorSimple(e, isClientError ? 400 : 500), changeEvent: null };
  }
}

function handleRenameSpace(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { new_name } = params as { new_name: string };
  if (typeof new_name !== 'string' || !new_name.trim()) return { resp: err('missing new_name'), changeEvent: null };
  const newPath = renameSpace(filePath, new_name.trim());
  return {
    resp: NextResponse.json({ ok: true, newPath }),
    changeEvent: { op: 'rename_space', path: newPath, summary: `Renamed space to ${new_name.trim()}`, beforePath: filePath, afterPath: newPath },
  };
}

function handleAppendCsv(filePath: string, params: Record<string, unknown>): FileOpResult {
  const { row } = params as { row: string[] };
  if (!Array.isArray(row) || row.length === 0) return { resp: err('row must be non-empty array'), changeEvent: null };
  const before = safeRead(filePath);
  const result = appendCsvRow(filePath, row);
  return {
    resp: NextResponse.json({ ok: true, ...result }),
    changeEvent: { op: 'append_csv', path: filePath, summary: `Appended CSV row (${row.length} cell${row.length === 1 ? '' : 's'})`, before, after: safeRead(filePath) },
  };
}

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

export const fileOperations: Record<string, FileOpHandler> = {
  save_file: handleSaveFile,
  append_to_file: handleAppendToFile,
  insert_lines: handleInsertLines,
  update_lines: handleUpdateLines,
  insert_after_heading: handleInsertAfterHeading,
  update_section: handleUpdateSection,
  delete_file: handleDeleteFile,
  rename_file: handleRenameFile,
  create_file: handleCreateFile,
  move_file: handleMoveFile,
  create_space: handleCreateSpace,
  rename_space: handleRenameSpace,
  append_csv: handleAppendCsv,
};
