import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getRecentlyModified, getFileContent, getFileTree } from '@/lib/fs';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers
import HomeContent from '@/components/HomeContent';
import type { FileNode } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export interface SpaceInfo {
  name: string;
  path: string;
  fileCount: number;
}

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
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

  // Derive plugin entry paths from registry — no hardcoded list needed
  const entryPaths = getAllRenderers()
    .map(r => r.entryPath)
    .filter((p): p is string => !!p);
  const existingFiles = getExistingFiles(entryPaths);

  const spaces = getTopLevelDirs();

  return <HomeContent recent={recent} existingFiles={existingFiles} spaces={spaces} />;
}
