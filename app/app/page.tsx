import { redirect } from 'next/navigation';
import { readSettings } from '@/lib/settings';
import { getRecentlyModified, getFileContent } from '@/lib/fs';
import { getAllRenderers } from '@/lib/renderers/registry';
import '@/lib/renderers/index'; // registers all renderers
import HomeContent from '@/components/HomeContent';

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

  return <HomeContent recent={recent} existingFiles={existingFiles} />;
}
