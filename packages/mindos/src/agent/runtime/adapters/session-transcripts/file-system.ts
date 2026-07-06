import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { MaybeRecord } from './types.js';
import { isRecord } from './normalizer.js';

export const MAX_JSONL_LINES = 20_000;
export const MAX_DISCOVERED_TRANSCRIPTS = 500;

export async function readJsonFile(path: string): Promise<MaybeRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readJsonl(path: string): Promise<MaybeRecord[]> {
  try {
    const text = await readFile(path, 'utf8');
    const records: MaybeRecord[] = [];
    for (const line of text.split(/\r?\n/).slice(0, MAX_JSONL_LINES)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isRecord(parsed)) records.push(parsed);
      } catch {
        // Ignore malformed tail lines from in-progress CLI writes.
      }
    }
    return records;
  } catch {
    return [];
  }
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
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
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
    if (result.length >= MAX_DISCOVERED_TRANSCRIPTS) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (result.length >= MAX_DISCOVERED_TRANSCRIPTS) return;
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
