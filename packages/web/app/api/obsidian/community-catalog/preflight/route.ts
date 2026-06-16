export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCodes, handleRouteErrorSimple, MindOSError } from '@/lib/errors';
import {
  preflightObsidianCommunityPluginPackage,
  type ObsidianCommunityPluginPreflight,
} from '@/lib/obsidian-compat/community-catalog';

const COMMUNITY_PREFLIGHT_CACHE_TTL_MS = 5 * 60 * 1000;

interface CommunityPreflightCacheEntry {
  preflight: ObsidianCommunityPluginPreflight;
  fetchedAt: number;
}

const preflightCache = new Map<string, CommunityPreflightCacheEntry>();
const preflightRequests = new Map<string, Promise<CommunityPreflightCacheEntry>>();

function preflightCacheKeyWithVersion(repo: string, pluginId: string | undefined, targetAppVersion: string | undefined): string {
  return `${repo}\n${pluginId ?? ''}\n${targetAppVersion ?? ''}`;
}

async function getCommunityPreflight(
  repo: string,
  pluginId?: string,
  targetAppVersion?: string,
): Promise<ObsidianCommunityPluginPreflight> {
  const key = preflightCacheKeyWithVersion(repo, pluginId, targetAppVersion);
  const cached = preflightCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < COMMUNITY_PREFLIGHT_CACHE_TTL_MS) {
    return cached.preflight;
  }

  let request = preflightRequests.get(key);
  if (!request) {
    request = preflightObsidianCommunityPluginPackage({ repo, pluginId, targetAppVersion })
      .then((preflight) => {
        const entry = { preflight, fetchedAt: Date.now() };
        preflightCache.set(key, entry);
        return entry;
      })
      .finally(() => {
        preflightRequests.delete(key);
      });
    preflightRequests.set(key, request);
  }

  return (await request).preflight;
}

export async function GET(req: NextRequest) {
  try {
    const repo = req.nextUrl.searchParams.get('repo')?.trim();
    if (!repo) {
      throw new MindOSError(ErrorCodes.INVALID_REQUEST, 'Missing repo');
    }

    const pluginId = req.nextUrl.searchParams.get('pluginId')?.trim() || undefined;
    const targetAppVersion = req.nextUrl.searchParams.get('appVersion')?.trim() || undefined;
    const preflight = await getCommunityPreflight(repo, pluginId, targetAppVersion);

    return NextResponse.json(preflight);
  } catch (err) {
    return handleRouteErrorSimple(err);
  }
}
