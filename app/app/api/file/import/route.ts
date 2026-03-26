export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { sanitizeFileName, convertToMarkdown } from '@/lib/core/file-convert';
import { resolveSafe } from '@/lib/core/security';
import { scaffoldIfNewSpace } from '@/lib/core/space-scaffold';
import { organizeAfterImport } from '@/lib/core/organize';
import { invalidateSearchIndex } from '@/lib/core/search';
import { effectiveSopRoot } from '@/lib/settings';
import { invalidateCache } from '@/lib/fs';

const MAX_FILES = 20;
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024;

type ConflictMode = 'skip' | 'rename' | 'overwrite';

interface ImportRequest {
  files: Array<{
    name: string;
    content: string;
    encoding?: 'text' | 'base64';
  }>;
  targetSpace?: string;
  organize?: boolean;
  conflict?: ConflictMode;
}

function normalizeTargetSpace(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return '';
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
}

function decodeFileContent(
  encoding: 'text' | 'base64' | undefined,
  content: string,
  sanitizedName: string,
): string {
  if (encoding === 'base64') {
    const buf = Buffer.from(content, 'base64');
    if (sanitizedName.toLowerCase().endsWith('.pdf')) {
      return buf.toString('latin1');
    }
    return buf.toString('utf-8');
  }
  return content;
}

function resolveUniquePath(
  mindRoot: string,
  relPath: string,
  conflict: ConflictMode,
): { relPath: string; resolved: string; skipped?: string } {
  let rel = relPath.replace(/\\/g, '/');
  let resolved = resolveSafe(mindRoot, rel);
  if (!fs.existsSync(resolved)) {
    return { relPath: rel, resolved };
  }
  if (conflict === 'skip') {
    return { relPath: rel, resolved, skipped: 'file exists' };
  }
  if (conflict === 'overwrite') {
    return { relPath: rel, resolved };
  }
  let n = 0;
  while (fs.existsSync(resolved)) {
    n += 1;
    const dir = path.posix.dirname(rel);
    const base = path.posix.basename(rel);
    const ext = path.posix.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const newBase = `${stem}-${n}${ext}`;
    rel = dir && dir !== '.' ? path.posix.join(dir, newBase) : newBase;
    resolved = resolveSafe(mindRoot, rel);
  }
  return { relPath: rel, resolved };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const mindRoot = effectiveSopRoot().trim();
  if (!mindRoot) {
    return NextResponse.json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const reqBody = body as ImportRequest;
  if (!Array.isArray(reqBody.files)) {
    return NextResponse.json({ error: 'files must be an array' }, { status: 400 });
  }

  if (reqBody.files.length > MAX_FILES) {
    return NextResponse.json({ error: `At most ${MAX_FILES} files per request` }, { status: 400 });
  }

  const targetSpaceNorm = normalizeTargetSpace(reqBody.targetSpace);
  const organize = reqBody.organize !== false;
  const conflict: ConflictMode =
    reqBody.conflict === 'skip' || reqBody.conflict === 'overwrite' || reqBody.conflict === 'rename'
      ? reqBody.conflict
      : 'rename';

  const created: Array<{ original: string; path: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const errors: Array<{ name: string; error: string }> = [];
  const createdPaths: string[] = [];
  const updatedFiles: string[] = [];

  for (const entry of reqBody.files) {
    const originalName = typeof entry?.name === 'string' ? entry.name : '';
    try {
      if (typeof entry?.name !== 'string' || typeof entry?.content !== 'string') {
        errors.push({ name: originalName || '(unknown)', error: 'name and content must be strings' });
        continue;
      }
      if (!entry.name.trim()) {
        errors.push({ name: '(empty)', error: 'name must not be empty' });
        continue;
      }
      if (entry.content.length > MAX_CONTENT_LENGTH) {
        errors.push({ name: entry.name, error: `content exceeds ${MAX_CONTENT_LENGTH} characters` });
        continue;
      }

      const sanitized = sanitizeFileName(entry.name);
      const encoding = entry.encoding === 'base64' ? 'base64' : 'text';
      const raw = decodeFileContent(encoding, entry.content, sanitized);
      const convertResult = convertToMarkdown(sanitized, raw);

      let relPath = targetSpaceNorm
        ? path.posix.join(targetSpaceNorm, convertResult.targetName)
        : convertResult.targetName;

      const { relPath: finalRel, resolved, skipped: skipReason } = resolveUniquePath(
        mindRoot,
        relPath,
        conflict,
      );

      if (skipReason) {
        skipped.push({ name: entry.name, reason: skipReason });
        continue;
      }

      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, convertResult.content, 'utf-8');
      scaffoldIfNewSpace(mindRoot, finalRel);

      created.push({ original: entry.name, path: finalRel });
      createdPaths.push(finalRel);
    } catch (e) {
      errors.push({ name: originalName || '(unknown)', error: (e as Error).message });
    }
  }

  if (organize && createdPaths.length > 0) {
    try {
      const { readmeUpdated } = organizeAfterImport(mindRoot, createdPaths, targetSpaceNorm);
      if (readmeUpdated && targetSpaceNorm) {
        updatedFiles.push(path.posix.join(targetSpaceNorm, 'README.md'));
      }
    } catch {
      /* organize is best-effort */
    }
  }

  if (created.length > 0 || updatedFiles.length > 0) {
    invalidateSearchIndex();
    invalidateCache();
  }

  try {
    revalidatePath('/');
  } catch {
    /* noop in test env */
  }

  return NextResponse.json({
    created,
    skipped,
    errors,
    updatedFiles,
  });
}
