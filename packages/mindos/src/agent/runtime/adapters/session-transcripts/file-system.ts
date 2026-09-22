import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { MaybeRecord } from './types.js';
import { isRecord } from './normalizer.js';

export const MAX_JSONL_LINES = 20_000;


const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;

export async function readJsonFile(path: string): Promise<MaybeRecord | null> {
  try {
    if ((await stat(path)).size > MAX_HISTORY_BYTES) throw new Error('This history exceeds the reading limit. Open it in the Agent.');
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (!isRecord(parsed)) throw new Error('Invalid history object.');
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Summaries use the first messages; full histories never silently truncate. */
export async function readJsonl(path: string, metadataOnly = false): Promise<MaybeRecord[]> {
  const records: MaybeRecord[] = [];
  const stream = createReadStream(path, { encoding: 'utf8' });
  let buffer = '', count = 0, total = 0;
  const accept = (line: string) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error('This history record exceeds the reading limit. Open it in the Agent.');
    count++;
    if (count > MAX_JSONL_LINES) throw new Error('This history exceeds the reading limit. Open it in the Agent for the full context.');
    try { const parsed = JSON.parse(line); if (isRecord(parsed)) records.push(parsed); } catch { /* A partial CLI write may be retried later. */ }
  };
  try {
    for await (const chunk of stream) {
      total += Buffer.byteLength(chunk);
      if (total > MAX_HISTORY_BYTES) throw new Error('This history exceeds the reading limit. Open it in the Agent.');
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        accept(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (metadataOnly && count >= 64) break;
      }
      if (metadataOnly && count >= 64) break;
      if (Buffer.byteLength(buffer) > MAX_RECORD_BYTES) throw new Error('This history record exceeds the reading limit. Open it in the Agent.');
    }
    if (!metadataOnly || count < 64) accept(buffer);
    if (count && !records.length) throw new Error('Invalid or corrupt session history. Retry after the Agent finishes writing.');
    return records;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  } finally { stream.destroy(); }
}

export function projectBaseFromCwd(cwd?: string): string | null {
  if (!cwd?.trim()) return null;
  const base = basename(resolve(cwd.trim()));
  return base || null;
}

export function claudeProjectDirNameFromCwd(cwd: string): string {
  return resolve(cwd.trim()).replace(/[^A-Za-z0-9_-]/g, '-');
}

export function jsonlFileNameFromSessionId(sessionId?: string): string | null {
  const trimmed = sessionId?.trim();
  if (!trimmed) return null;
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) return null;
  return `${trimmed}.jsonl`;
}

export function sanitizedProjectDirNameFromCwd(cwd: string): string {
  return resolve(cwd.trim()).replace(/[^A-Za-z0-9_-]/g, '-');
}

export function sameResolvedPath(a: string, b: string): boolean {
  try {
    return resolve(a.trim()) === resolve(b.trim());
  } catch {
    return a.trim() === b.trim();
  }
}

export function shouldSkipForRequestedCwd(input: {
  requestedCwd?: string;
  transcriptCwd?: string;
  sessionId?: string;
}): boolean {
  const requested = input.requestedCwd?.trim();
  if (!requested) return false;
  const transcriptCwd = input.transcriptCwd?.trim();
  if (!transcriptCwd) return !input.sessionId?.trim();
  return !sameResolvedPath(transcriptCwd, requested);
}

export function pathInside(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

export async function directJsonlFiles(dir: string, sessionId?: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  if (sessionId?.trim()) {
    const fileName = jsonlFileNameFromSessionId(sessionId);
    if (!fileName) return [];
    const filePath = join(dir, fileName);
    return existsSync(filePath) ? [filePath] : [];
  }
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(dir, entry.name));
}

export async function discoverJsonlFiles(input: {
  root: string;
  sessionId?: string;
  maxDepth: number;
  skipDir?: (name: string) => boolean;
}): Promise<string[]> {
  if (!existsSync(input.root)) return [];
  const result: string[] = [];
  const wantedName = input.sessionId?.trim() ? jsonlFileNameFromSessionId(input.sessionId) : null;
  if (input.sessionId?.trim() && !wantedName) return [];

  async function visit(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= input.maxDepth || input.skipDir?.(entry.name)) continue;
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      if (wantedName && entry.name !== wantedName) continue;
      result.push(path);
    }
  }

  await visit(input.root, 0);
  return result;
}
