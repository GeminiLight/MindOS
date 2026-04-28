import type { PlatformStatus } from '@/lib/im/platforms';
import type { IMActivity } from '@/lib/im/types';

type ChannelCache = {
  statuses: PlatformStatus[];
  activities: Record<string, IMActivity[]>;
  statusFetchedAt: number;
  activityFetchedAt: Record<string, number>;
};

const STALE_MS = 15_000; // 15 seconds before re-fetch

const cache: ChannelCache = {
  statuses: [],
  activities: {},
  statusFetchedAt: 0,
  activityFetchedAt: {},
};

export function getCachedStatuses(): { data: PlatformStatus[]; stale: boolean } {
  const age = Date.now() - cache.statusFetchedAt;
  return {
    data: cache.statuses,
    stale: age > STALE_MS || cache.statuses.length === 0,
  };
}

export function setCachedStatuses(statuses: PlatformStatus[]): void {
  cache.statuses = statuses;
  cache.statusFetchedAt = Date.now();
}

export function getCachedActivities(platformId: string): { data: IMActivity[]; stale: boolean } {
  const age = Date.now() - (cache.activityFetchedAt[platformId] ?? 0);
  return {
    data: cache.activities[platformId] ?? [],
    stale: age > STALE_MS || !cache.activities[platformId],
  };
}

export function clearChannelCache(): void {
  cache.statuses = [];
  cache.activities = {};
  cache.statusFetchedAt = 0;
  cache.activityFetchedAt = {};
}

export function setCachedActivities(platformId: string, activities: IMActivity[]): void {
  cache.activities[platformId] = activities;
  cache.activityFetchedAt[platformId] = Date.now();
}
