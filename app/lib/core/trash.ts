import fs from 'fs';
import path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrashMeta {
  id: string;
  originalPath: string;
  deletedAt: string;
  expiresAt: string;
  fileName: string;
  isDirectory: boolean;
}

const TRASH_DIR = '.trash';
const META_DIR = '.trash-meta';
const EXPIRY_DAYS = 30;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function siblingDir(mindRoot: string, name: string): string {
  return path.join(path.dirname(mindRoot), name);
}

function trashRoot(mindRoot: string): string {
  return siblingDir(mindRoot, TRASH_DIR);
}

function metaRoot(mindRoot: string): string {
  return siblingDir(mindRoot, META_DIR);
}

function ensureDirs(mindRoot: string): void {
  fs.mkdirSync(trashRoot(mindRoot), { recursive: true });
  fs.mkdirSync(metaRoot(mindRoot), { recursive: true });
}

/** Sanitize filename for use as trash ID — strip all unsafe characters */
function generateId(fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
  return `${Date.now()}_${safe}`;
}

function writeMeta(mindRoot: string, meta: TrashMeta): void {
  const metaPath = path.join(metaRoot(mindRoot), `${meta.id}.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

function readMeta(mindRoot: string, id: string): TrashMeta | null {
  const metaPath = path.join(metaRoot(mindRoot), `${id}.json`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

function deleteMeta(mindRoot: string, id: string): void {
  const metaPath = path.join(metaRoot(mindRoot), `${id}.json`);
  try { fs.unlinkSync(metaPath); } catch { /* already gone */ }
}

/**
 * Move a file or directory safely, handling cross-filesystem (EXDEV) errors.
 * Tries atomic rename first, falls back to copy+delete.
 */
function safeMove(src: string, dest: string, isDir: boolean): void {
  if (isDir) {
    // Directories always use copy+delete (rename doesn't work for dirs across fs)
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  } else {
    try {
      fs.renameSync(src, dest);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EXDEV') {
        // Cross-device: fallback to copy+delete
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
      } else {
        throw err;
      }
    }
  }
}

// ─── Core Operations ─────────────────────────────────────────────────────────

export function moveToTrash(mindRoot: string, filePath: string): TrashMeta {
  ensureDirs(mindRoot);
  const src = path.join(mindRoot, filePath);
  if (!fs.existsSync(src)) throw new Error(`File not found: ${filePath}`);

  const isDir = fs.statSync(src).isDirectory();
  const fileName = path.basename(filePath);
  const id = generateId(fileName);
  const dest = path.join(trashRoot(mindRoot), id);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  safeMove(src, dest, isDir);

  const now = new Date();
  const meta: TrashMeta = {
    id,
    originalPath: filePath,
    deletedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EXPIRY_DAYS * 86400000).toISOString(),
    fileName,
    isDirectory: isDir,
  };
  writeMeta(mindRoot, meta);
  return meta;
}

export function restoreFromTrash(mindRoot: string, trashId: string, overwrite = false): { restoredPath: string } {
  const meta = readMeta(mindRoot, trashId);
  if (!meta) throw new Error('Item not found in trash');

  const trashPath = path.join(trashRoot(mindRoot), trashId);
  if (!fs.existsSync(trashPath)) throw new Error('Trash file missing from disk');

  const dest = path.join(mindRoot, meta.originalPath);

  // Check for conflicts
  if (fs.existsSync(dest) && !overwrite) {
    throw Object.assign(new Error('Restore conflict: file exists at original location'), { code: 'RESTORE_CONFLICT' });
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (meta.isDirectory) {
    if (overwrite && fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  } else {
    if (overwrite && fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }

  safeMove(trashPath, dest, meta.isDirectory);
  deleteMeta(mindRoot, trashId);
  return { restoredPath: meta.originalPath };
}

export function restoreAsCopy(mindRoot: string, trashId: string): { restoredPath: string } {
  const meta = readMeta(mindRoot, trashId);
  if (!meta) throw new Error('Item not found in trash');

  const trashPath = path.join(trashRoot(mindRoot), trashId);
  if (!fs.existsSync(trashPath)) throw new Error('Trash file missing from disk');

  // Generate a unique copy name
  const dir = path.dirname(meta.originalPath);
  const ext = path.extname(meta.fileName);
  const base = path.basename(meta.fileName, ext);
  let copyPath = path.join(dir, `${base} (copy)${ext}`);
  let counter = 2;
  while (fs.existsSync(path.join(mindRoot, copyPath))) {
    copyPath = path.join(dir, `${base} (copy ${counter})${ext}`);
    counter++;
  }

  const dest = path.join(mindRoot, copyPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  safeMove(trashPath, dest, meta.isDirectory);

  deleteMeta(mindRoot, trashId);
  return { restoredPath: copyPath };
}

export function permanentlyDelete(mindRoot: string, trashId: string): void {
  const trashPath = path.join(trashRoot(mindRoot), trashId);
  try {
    if (fs.existsSync(trashPath)) {
      const stat = fs.statSync(trashPath);
      if (stat.isDirectory()) {
        fs.rmSync(trashPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(trashPath);
      }
    }
  } catch { /* file already gone */ }
  deleteMeta(mindRoot, trashId);
}

export function listTrash(mindRoot: string): TrashMeta[] {
  ensureDirs(mindRoot);
  const metaDir = metaRoot(mindRoot);
  let files: string[];
  try {
    files = fs.readdirSync(metaDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const items: TrashMeta[] = [];

  for (const file of files) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(metaDir, file), 'utf-8')) as TrashMeta;
      // Verify the trash file still exists on disk
      const trashPath = path.join(trashRoot(mindRoot), meta.id);
      if (fs.existsSync(trashPath)) {
        items.push(meta);
      } else {
        // Clean up orphaned metadata
        try { fs.unlinkSync(path.join(metaDir, file)); } catch { /* race ok */ }
      }
    } catch {
      // Skip corrupt metadata files
    }
  }

  // Sort by deletion time, newest first
  items.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
  return items;
}

export function emptyTrash(mindRoot: string): number {
  const items = listTrash(mindRoot);
  for (const item of items) {
    permanentlyDelete(mindRoot, item.id);
  }
  return items.length;
}

export function purgeExpired(mindRoot: string): number {
  const items = listTrash(mindRoot);
  const now = Date.now();
  let count = 0;
  for (const item of items) {
    if (new Date(item.expiresAt).getTime() <= now) {
      permanentlyDelete(mindRoot, item.id);
      count++;
    }
  }
  return count;
}
