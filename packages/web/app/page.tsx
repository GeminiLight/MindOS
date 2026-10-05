import fs from 'fs';
import { readSetupPending } from '@/lib/setup-state';
import { getRecentlyModified, getMindRoot } from '@/lib/fs';
import { resolveExistingSafe } from '@/lib/core/security';
import { getAllRenderers } from '@/lib/renderers/registry';
import { listWorkspaceSpaces } from '@/lib/space-records';
import HomeContent from '@/components/HomeContent';
import ClientRedirect from '@/components/ClientRedirect';
import { readSettings, type AiConfig } from '@/lib/settings';
import { ALL_PROVIDER_IDS, getApiKeyEnvVar, getApiKeyFromEnv } from '@/lib/agent/providers';
import { isAiConfiguredForAgentTurn } from '@/lib/settings-ai-client';
import { selectHomeRecentNotes } from '@/lib/home-recent-notes';

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

function getInitialAiConfigured(ai: AiConfig): boolean {
  const envOverrides: Record<string, boolean> = {};
  for (const provider of ALL_PROVIDER_IDS) {
    const key = getApiKeyEnvVar(provider);
    if (key) envOverrides[key] = Boolean(getApiKeyFromEnv(provider));
  }
  return isAiConfiguredForAgentTurn({
    ai,
    envOverrides,
    envValues: { AI_PROVIDER: process.env.AI_PROVIDER },
  });
}

export default function HomePage() {
  if (readSetupPending()) return <ClientRedirect href="/setup" label="Opening setup..." />;

  let recent: { path: string; mtime: number }[] = [];
  let recentNotes: { path: string; mtime: number }[] = [];
  try {
    const candidates = getRecentlyModified(80);
    recent = candidates.slice(0, 15);
    recentNotes = selectHomeRecentNotes(candidates, getMindRoot(), 3);
  } catch (err) {
    console.error('[HomePage] Failed to load recent files:', err);
    recentNotes = recent.slice(0, 3);
  }

  // Derive renderer entry paths from registry — used by plugin and app-builtin sections on home.
  const entryPaths = getAllRenderers()
    .map(r => r.entryPath)
    .filter((p): p is string => !!p);
  const existingFiles = getExistingFiles(entryPaths);

  const spaces = listWorkspaceSpaces();
  const settings = readSettings();
  const activeProvider = settings.ai.activeProvider;
  const guideAiConfigured = Boolean(activeProvider && activeProvider !== 'skip'
    && settings.ai.providers.some(provider => provider.id === activeProvider));

  return <HomeContent
    recent={recent}
    recentNotes={recentNotes}
    existingFiles={existingFiles}
    spaces={spaces}
    initialAiConfigured={getInitialAiConfigured(settings.ai)}
    initialGuide={{ guideState: settings.guideState?.active ? settings.guideState : null, aiConfigured: guideAiConfigured }}
  />;
}
