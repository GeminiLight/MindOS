import fs from 'fs';
import path from 'path';
import { resolveSafe } from './security';
import { appendContentChange } from './content-changes';

export interface OrganizeResult {
  readmeUpdated: boolean;
  relatedFiles: Array<{ path: string; matchType: 'backlink' | 'keyword' }>;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'or',
  'not', 'but', 'with', 'from', 'this', 'that', 'was', 'are', 'be', 'has', 'had',
  'readme', 'instruction', 'md',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.DS_Store']);

function extractKeywords(filePath: string): string[] {
  const stem = path.basename(filePath, path.extname(filePath));
  return stem
    .split(/[-_\s]+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function collectMdFiles(dir: string, limit: number): string[] {
  const results: string[] = [];
  function walk(d: string) {
    if (results.length >= limit) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(d, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(path.relative(dir, path.join(d, entry.name)).replace(/\\/g, '/'));
      }
    }
  }
  walk(dir);
  return results;
}

export function organizeAfterImport(
  mindRoot: string,
  createdFiles: string[],
  targetSpace: string,
): OrganizeResult {
  for (const fp of createdFiles) {
    try {
      appendContentChange(mindRoot, {
        op: 'import_file',
        path: fp,
        source: 'user',
        summary: 'Imported file into knowledge base',
      });
    } catch { /* ignore */ }
  }

  let readmeUpdated = false;
  const space = targetSpace.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();

  if (space && createdFiles.length > 0) {
    const readmePath = path.posix.join(space, 'README.md');
    try {
      const resolved = resolveSafe(mindRoot, readmePath);
      if (fs.existsSync(resolved)) {
        const existing = fs.readFileSync(resolved, 'utf-8');
        const bullets = createdFiles.map(f => {
          const base = path.posix.basename(f);
          return `- [${base}](./${base})`;
        }).join('\n');
        fs.writeFileSync(resolved, `${existing.trimEnd()}\n\n${bullets}\n`, 'utf-8');
        readmeUpdated = true;
      }
    } catch { /* README missing or write failed */ }
  }

  const createdSet = new Set(createdFiles);
  const allKeywords = new Set<string>();
  for (const f of createdFiles) {
    for (const kw of extractKeywords(f)) allKeywords.add(kw);
  }

  const relatedFiles: OrganizeResult['relatedFiles'] = [];
  if (allKeywords.size > 0) {
    const candidates = collectMdFiles(mindRoot, 50);
    const kwArray = [...allKeywords];
    for (const candidate of candidates) {
      if (createdSet.has(candidate)) continue;
      if (relatedFiles.length >= 10) break;
      try {
        const resolved = resolveSafe(mindRoot, candidate);
        const content = fs.readFileSync(resolved, 'utf-8').toLowerCase();
        if (kwArray.some(kw => content.includes(kw))) {
          relatedFiles.push({ path: candidate, matchType: 'keyword' });
        }
      } catch { /* ignore */ }
    }
  }

  return { readmeUpdated, relatedFiles };
}
