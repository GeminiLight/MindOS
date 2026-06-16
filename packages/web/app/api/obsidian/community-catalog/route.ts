export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import { readSettings } from '@/lib/settings';
import {
  OBSIDIAN_COMMUNITY_PLUGINS_URL,
  buildObsidianCommunityCatalog,
  parseObsidianCommunityCatalog,
  type ParseObsidianCommunityCatalogResult,
  type InstalledObsidianPluginState,
} from '@/lib/obsidian-compat/community-catalog';
import { withObsidianPluginRuntime } from '@/lib/obsidian-compat/runtime-service';
import type { ManagedPlugin } from '@/lib/obsidian-compat/plugin-manager';

const COMMUNITY_INDEX_TIMEOUT_MS = 8000;
const COMMUNITY_INDEX_CACHE_TTL_MS = 30 * 60 * 1000;

type CommunityIndexCacheState = 'fresh' | 'refreshed' | 'stale';

interface CommunityIndexCacheEntry {
  parsed: ParseObsidianCommunityCatalogResult;
  fetchedAt: number;
}

let communityIndexCache: CommunityIndexCacheEntry | null = null;
let communityIndexRequest: Promise<CommunityIndexCacheEntry> | null = null;

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

async function fetchCommunityIndex(forceRefresh: boolean): Promise<CommunityIndexCacheEntry> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COMMUNITY_INDEX_TIMEOUT_MS);
  const fetchOptions: RequestInit & { next?: { revalidate: number } } = forceRefresh
    ? {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    : {
        cache: 'force-cache',
        headers: { Accept: 'application/json' },
        next: { revalidate: COMMUNITY_INDEX_CACHE_TTL_MS / 1000 },
        signal: controller.signal,
      };

  try {
    const response = await fetch(OBSIDIAN_COMMUNITY_PLUGINS_URL, fetchOptions);

    if (!response.ok) {
      throw new MindOSError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to fetch Obsidian community plugin index: ${response.status}`,
      );
    }

    const raw = await response.json();
    return {
      parsed: parseObsidianCommunityCatalog(raw),
      fetchedAt: Date.now(),
    };
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

async function getCommunityIndex(forceRefresh: boolean): Promise<CommunityIndexCacheEntry & { cacheState: CommunityIndexCacheState }> {
  const now = Date.now();
  if (!forceRefresh && communityIndexCache && now - communityIndexCache.fetchedAt < COMMUNITY_INDEX_CACHE_TTL_MS) {
    return { ...communityIndexCache, cacheState: 'fresh' };
  }

  if (!communityIndexRequest) {
    communityIndexRequest = fetchCommunityIndex(forceRefresh)
      .then((entry) => {
        communityIndexCache = entry;
        return entry;
      })
      .finally(() => {
        communityIndexRequest = null;
      });
  }

  try {
    const entry = await communityIndexRequest;
    return { ...entry, cacheState: 'refreshed' };
  } catch (err) {
    if (communityIndexCache) {
      return { ...communityIndexCache, cacheState: 'stale' };
    }
    throw err;
  }
}

export async function GET(req: NextRequest) {
  try {
    const settings = readSettings();
    const query = req.nextUrl.searchParams.get('q') ?? req.nextUrl.searchParams.get('query') ?? '';
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    const index = await getCommunityIndex(forceRefresh);

    return await withObsidianPluginRuntime(settings.mindRoot, async (manager) => {
      const installed = manager.list().map(installedStateFor);
      const catalog = buildObsidianCommunityCatalog(index.parsed.items, {
        query,
        limit,
        installed,
      });

      return NextResponse.json({
        ok: true,
        catalog,
        skipped: index.parsed.skipped,
        cache: {
          state: index.cacheState,
          fetchedAt: new Date(index.fetchedAt).toISOString(),
          ttlMs: COMMUNITY_INDEX_CACHE_TTL_MS,
        },
      });
    });
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
