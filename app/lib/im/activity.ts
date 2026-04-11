// ─── IM Activity Storage ────────────────────────────────────────────────────────
// Records and retrieves IM message send activity.
// Stored in ~/.mindos/im-activity.json with automatic cleanup.

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { IMPlatform, IMActivity, IMActivityStore, IMActivityType, IMActivityStatus } from './types';

const ACTIVITY_DIR = path.join(os.homedir(), '.mindos');
const ACTIVITY_PATH = path.join(ACTIVITY_DIR, 'im-activity.json');
const MAX_ACTIVITIES_PER_PLATFORM = 100;
const MAX_MESSAGE_SUMMARY_LENGTH = 500;

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_SUMMARY_LENGTH) return message;
  return message.slice(0, MAX_MESSAGE_SUMMARY_LENGTH - 1) + '…';
}

function readStore(): IMActivityStore {
  try {
    if (!fs.existsSync(ACTIVITY_PATH)) {
      return { version: 1, activities: {} };
    }
    const raw = fs.readFileSync(ACTIVITY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && typeof parsed.activities === 'object') {
      return parsed as IMActivityStore;
    }
    // Invalid format, reset
    return { version: 1, activities: {} };
  } catch {
    // Corrupt file, reset
    return { version: 1, activities: {} };
  }
}

function writeStore(store: IMActivityStore): void {
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  const tmpPath = ACTIVITY_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, ACTIVITY_PATH);
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a new activity entry.
 */
export function recordActivity(params: {
  platform: IMPlatform;
  type: IMActivityType;
  status: IMActivityStatus;
  recipient: string;
  message: string;
  error?: string;
}): IMActivity {
  const activity: IMActivity = {
    id: generateId(),
    platform: params.platform,
    type: params.type,
    status: params.status,
    recipient: params.recipient,
    messageSummary: truncateMessage(params.message),
    error: params.error,
    timestamp: new Date().toISOString(),
  };

  const store = readStore();
  const platformActivities = store.activities[params.platform] ?? [];

  // Prepend new activity (newest first)
  platformActivities.unshift(activity);

  // Enforce max limit (FIFO cleanup)
  if (platformActivities.length > MAX_ACTIVITIES_PER_PLATFORM) {
    platformActivities.length = MAX_ACTIVITIES_PER_PLATFORM;
  }

  store.activities[params.platform] = platformActivities;
  writeStore(store);

  return activity;
}

/**
 * Get activities for a platform.
 */
export function getActivities(platform: IMPlatform, limit = 10): IMActivity[] {
  const store = readStore();
  const activities = store.activities[platform] ?? [];
  return activities.slice(0, limit);
}

/**
 * Get the most recent activity for a platform (for status summary).
 */
export function getLastActivity(platform: IMPlatform): IMActivity | null {
  const activities = getActivities(platform, 1);
  return activities[0] ?? null;
}

/**
 * Clear all activities for a platform.
 */
export function clearActivities(platform: IMPlatform): void {
  const store = readStore();
  delete store.activities[platform];
  writeStore(store);
}

/**
 * For testing: reset the entire activity store.
 */
export function _resetActivityStore(): void {
  if (fs.existsSync(ACTIVITY_PATH)) {
    fs.unlinkSync(ACTIVITY_PATH);
  }
}
