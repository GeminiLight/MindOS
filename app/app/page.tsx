import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getRecentlyModified, getFileContent, getFileTree } from '@/lib/fs';
import { getAllRenderers } from '@/lib/renderers/registry';
import HomeContent from '@/components/HomeContent';
import type { FileNode } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export interface SpaceInfo {
  name: string;
  path: string;
  fileCount: number;
  description: string;  // first paragraph from README.md (after title)
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}

/** Extract the first non-empty paragraph after the title from a README.md */
function extractDescription(spacePath: string): string {
  try {
    const content = getFileContent(spacePath + 'README.md');
    const lines = content.split('\n');
    // Skip title line (# ...) and blank lines, return first non-empty non-heading line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      return trimmed;
    }
  } catch { /* README.md doesn't exist */ }
  return '';
}


function getTopLevelDirs(): SpaceInfo[] {
  try {
    const tree = getFileTree();
    return tree
      .filter(n => n.type === 'directory' && !n.name.startsWith('.'))
      .map(n => ({
        name: n.name,
        path: n.path + '/',
        fileCount: countFiles(n),
        description: extractDescription(n.path + '/'),
      }));
  } catch {
    return [];
  }
}

function getExistingFiles(paths: string[]): string[] {
  return paths.filter(p => {
    try { getFileContent(p); return true; } catch { return false; }
  });
}

export default function HomePage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  let recent: { path: string; mtime: number }[] = [];
  try {
    recent = getRecentlyModified(15);
  } catch (err) {
    console.error('[HomePage] Failed to load recent files:', err);
  }

  // Derive renderer entry paths from registry — used by plugin and app-builtin sections on home.
  const entryPaths = getAllRenderers()
    .map(r => r.entryPath)
    .filter((p): p is string => !!p);
  const existingFiles = getExistingFiles(entryPaths);

  const spaces = getTopLevelDirs();

  return <HomeContent recent={recent} existingFiles={existingFiles} spaces={spaces} />;
}
