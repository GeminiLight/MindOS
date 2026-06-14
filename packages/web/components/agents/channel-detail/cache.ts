import type { PlatformStatus } from '@/lib/im/platforms';
import type { IMActivity } from '@/lib/im/types';

type ChannelCache = {
  statuses: PlatformStatus[];
  activities: Record<string, IMActivity[]>;
  statusFetchedAt: number;
  activityFetchedAt: Record<string, number>;
};

const STATUS_STALE_MS = 5 * 60_000;
const ACTIVITY_STALE_MS = 15_000;

const cache: ChannelCache = {
  statuses: [],
  activities: {},
  statusFetchedAt: 0,
  activityFetchedAt: {},
};

let statusRequest: Promise<PlatformStatus[]> | null = null;

export function getCachedStatuses(): { data: PlatformStatus[]; stale: boolean } {
  const age = Date.now() - cache.statusFetchedAt;
  return {
    data: cache.statuses,
    stale: age > STATUS_STALE_MS || cache.statuses.length === 0,
  };
}

export function setCachedStatuses(statuses: PlatformStatus[]): void {
  cache.statuses = statuses;
  cache.statusFetchedAt = Date.now();
}

export async function loadChannelStatuses(): Promise<PlatformStatus[]> {
  if (statusRequest) return statusRequest;
  statusRequest = fetch('/api/im/status')
    .then(async (res) => {
      if (!res.ok) throw new Error(`Channel status load failed (${res.status})`);
      const data = await res.json() as { platforms?: PlatformStatus[] };
      const statuses = Array.isArray(data.platforms) ? data.platforms : [];
      setCachedStatuses(statuses);
      return statuses;
    })
    .finally(() => {
      statusRequest = null;
    });
  return statusRequest;
}

export function getCachedActivities(platformId: string): { data: IMActivity[]; stale: boolean } {
  const age = Date.now() - (cache.activityFetchedAt[platformId] ?? 0);
  return {
    data: cache.activities[platformId] ?? [],
    stale: age > ACTIVITY_STALE_MS || !cache.activities[platformId],
  };
}

export function clearChannelCache(): void {
  cache.statuses = [];
  cache.activities = {};
  cache.statusFetchedAt = 0;
  cache.activityFetchedAt = {};
  statusRequest = null;
}

export function setCachedActivities(platformId: string, activities: IMActivity[]): void {
  cache.activities[platformId] = activities;
  cache.activityFetchedAt[platformId] = Date.now();
}
