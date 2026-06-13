import fs from 'fs';
import { readSetupPending } from '@/lib/setup-state';
import { getRecentlyModified, getMindRoot } from '@/lib/fs';
import { resolveExistingSafe } from '@/lib/core/security';
import { getAllRenderers } from '@/lib/renderers/registry';
import { listWorkspaceSpaces } from '@/lib/space-records';
import HomeContent from '@/components/HomeContent';
import ClientRedirect from '@/components/ClientRedirect';

export const dynamic = 'force-dynamic';

function getExistingFiles(paths: string[]): string[] {
  try {
    const root = getMindRoot();
    return paths.filter(p => {
      try {
        return fs.existsSync(resolveExistingSafe(root, p));
      } catch { return false; }
    });
  } catch {
    return [];
  }
}

export default function HomePage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

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

  const spaces = listWorkspaceSpaces();

  return <HomeContent recent={recent} existingFiles={existingFiles} spaces={spaces} />;
}
