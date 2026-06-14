export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import {
  OBSIDIAN_COMMUNITY_PLUGINS_URL,
  buildObsidianCommunityCatalog,
  parseObsidianCommunityCatalog,
  type InstalledObsidianPluginState,
} from '@/lib/obsidian-compat/community-catalog';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import type { ManagedPlugin } from '@/lib/obsidian-compat/plugin-manager';

const COMMUNITY_INDEX_TIMEOUT_MS = 8000;

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function installedStateFor(plugin: ManagedPlugin): InstalledObsidianPluginState {
  const status: InstalledObsidianPluginState['status'] =
    plugin.compatibilityLevel === 'blocked'
      ? 'blocked'
      : plugin.lastError
        ? 'error'
        : plugin.loaded
          ? 'loaded'
          : plugin.enabled
            ? 'enabled'
            : 'disabled';

  return {
    id: plugin.id,
    enabled: plugin.enabled,
    loaded: plugin.loaded,
    status,
    version: plugin.version,
    ...(plugin.lastError || plugin.compatibility.blockers[0]
      ? { lastError: plugin.lastError ?? plugin.compatibility.blockers[0] }
      : {}),
  };
}

async function fetchCommunityIndex(): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMUNITY_INDEX_TIMEOUT_MS);

  try {
    const response = await fetch(OBSIDIAN_COMMUNITY_PLUGINS_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MindOSError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to fetch Obsidian community plugin index: ${response.status}`,
      );
    }

    return await response.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MindOSError(
        ErrorCodes.INTERNAL_ERROR,
        'Timed out fetching Obsidian community plugin index.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const query = req.nextUrl.searchParams.get('q') ?? req.nextUrl.searchParams.get('query') ?? '';
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
    const raw = await fetchCommunityIndex();
    const parsed = parseObsidianCommunityCatalog(raw);

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const installed = manager.list().map(installedStateFor);
      const catalog = buildObsidianCommunityCatalog(parsed.items, {
        query,
        limit,
        installed,
      });

      return NextResponse.json({
        ok: true,
        catalog,
        skipped: parsed.skipped,
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
