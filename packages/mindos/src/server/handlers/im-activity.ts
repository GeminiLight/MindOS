import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';

export type ImPlatform =
  | 'telegram'
  | 'discord'
  | 'feishu'
  | 'slack'
  | 'wecom'
  | 'dingtalk'
  | 'wechat'
  | 'qq';

export type ImActivityServices = {
  activityPath?: string;
  getActivities?(platform: ImPlatform, limit: number): unknown[];
};

const VALID_PLATFORMS = new Set<ImPlatform>([
  'telegram',
  'discord',
  'feishu',
  'slack',
  'wecom',
  'dingtalk',
  'wechat',
  'qq',
]);

const DEFAULT_ACTIVITY_PATH = join(homedir(), '.mindos', 'im-activity.json');

export function handleImActivityGet(
  searchParams: URLSearchParams,
  services: ImActivityServices = {},
): MindosServerResponse<{ activities: unknown[] } | { error: string }> {
  const platform = searchParams.get('platform');
  const limitParam = searchParams.get('limit');

  if (!platform || !isImPlatform(platform)) {
    return json({ error: 'Invalid or missing platform parameter' }, { status: 400 });
  }

  const limit = limitParam ? Math.min(Math.max(Number.parseInt(limitParam, 10) || 10, 1), 100) : 10;
  const activities = services.getActivities
    ? services.getActivities(platform, limit)
    : readActivities(platform, limit, services.activityPath ?? DEFAULT_ACTIVITY_PATH);

  return json({ activities });
}

function isImPlatform(value: string): value is ImPlatform {
  return VALID_PLATFORMS.has(value as ImPlatform);
}

function readActivities(platform: ImPlatform, limit: number, activityPath: string): unknown[] {
  try {
    if (!existsSync(activityPath)) return [];
    const parsed = JSON.parse(readFileSync(activityPath, 'utf-8')) as { version?: unknown; activities?: Record<string, unknown[]> };
    if (parsed.version !== 1 || !parsed.activities || typeof parsed.activities !== 'object') return [];
    const activities = parsed.activities[platform];
    return Array.isArray(activities) ? activities.slice(0, limit) : [];
  } catch {
    return [];
  }
}
