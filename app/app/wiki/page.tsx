import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getRecentlyModified, getFileTree, getFileContent } from '@/lib/fs';
import WikiHomeContent from '@/components/WikiHomeContent';
import type { FileNode } from '@/lib/core/types';
import type { SpaceInfo } from '@/app/page';

export const dynamic = 'force-dynamic';

function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, c) => sum + countFiles(c), 0);
}

function extractDescription(spacePath: string): string {
  try {
    const content = getFileContent(spacePath + 'README.md');
    const lines = content.split('\n');
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

export default function WikiPage() {
  const settings = readSettings();
  if (settings.setupPending) redirect('/setup');

  let recent: { path: string; mtime: number }[] = [];
  try {
    recent = getRecentlyModified(20);
  } catch (err) {
    console.error('[WikiPage] Failed to load recent files:', err);
  }

  const spaces = getTopLevelDirs();

  return <WikiHomeContent spaces={spaces} recent={recent} />;
}
