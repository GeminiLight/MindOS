import {
  compatibilityPosture,
  type ObsidianCompatibilityPosture,
  type ObsidianCompatibilityPostureStatus,
} from './ObsidianCompatibilityPostureModel';
import type { ObsidianPluginStatus } from './ObsidianPluginHostModel';

export type ObsidianPostureFilter = 'all' | ObsidianCompatibilityPostureStatus;

export interface ObsidianPluginInventoryItem {
  plugin: ObsidianPluginStatus;
  posture: ObsidianCompatibilityPosture;
}

export interface ObsidianPostureFilterOption {
  value: ObsidianPostureFilter;
  label: string;
  count: number;
}

export interface ObsidianPluginInventory {
  items: ObsidianPluginInventoryItem[];
  allItems: ObsidianPluginInventoryItem[];
  filterOptions: ObsidianPostureFilterOption[];
  activeFilter: ObsidianPostureFilter;
  visibleCount: number;
}

const POSTURE_FILTERS: ObsidianPostureFilter[] = [
  'all',
  'blocked',
  'review',
  'limited',
  'native',
  'ready',
  'observed',
];

const POSTURE_SORT_RANK: Record<ObsidianCompatibilityPostureStatus, number> = {
  blocked: 0,
  review: 1,
  limited: 2,
  native: 3,
  ready: 4,
  observed: 5,
};

export function buildObsidianPluginInventory(
  plugins: ObsidianPluginStatus[],
  activeFilter: ObsidianPostureFilter = 'all',
): ObsidianPluginInventory {
  const allItems = plugins
    .map((plugin) => ({ plugin, posture: compatibilityPosture(plugin) }))
    .sort(compareInventoryItems);
  const filterOptions = buildPostureFilterOptions(allItems);
  const normalizedFilter = filterOptions.some((option) => option.value === activeFilter)
    ? activeFilter
    : 'all';
  const items = normalizedFilter === 'all'
    ? allItems
    : allItems.filter((item) => item.posture.status === normalizedFilter);

  return {
    items,
    allItems,
    filterOptions,
    activeFilter: normalizedFilter,
    visibleCount: items.length,
  };
}

function buildPostureFilterOptions(items: ObsidianPluginInventoryItem[]): ObsidianPostureFilterOption[] {
  const counts = new Map<ObsidianPostureFilter, number>(POSTURE_FILTERS.map((filter) => [filter, 0]));
  counts.set('all', items.length);
  for (const item of items) {
    counts.set(item.posture.status, (counts.get(item.posture.status) ?? 0) + 1);
  }

  return POSTURE_FILTERS.map((filter) => ({
    value: filter,
    label: postureFilterLabel(filter),
    count: counts.get(filter) ?? 0,
  }));
}

function compareInventoryItems(a: ObsidianPluginInventoryItem, b: ObsidianPluginInventoryItem): number {
  const postureDelta = POSTURE_SORT_RANK[a.posture.status] - POSTURE_SORT_RANK[b.posture.status];
  if (postureDelta !== 0) return postureDelta;
  return a.plugin.name.localeCompare(b.plugin.name, undefined, { sensitivity: 'base' });
}

function postureFilterLabel(filter: ObsidianPostureFilter): string {
  if (filter === 'all') return 'All';
  if (filter === 'observed') return 'Observed';
  if (filter === 'ready') return 'Ready';
  if (filter === 'limited') return 'Limited';
  if (filter === 'review') return 'Review';
  if (filter === 'native') return 'Native';
  return 'Blocked';
}
