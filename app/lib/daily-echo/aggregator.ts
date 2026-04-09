/**
 * Daily Echo Data Aggregation
 *
 * Collects 24-hour user behavior data from:
 * - File change events via /api/changes
 * - Chat sessions via /api/ask-sessions
 * - User intentions from localStorage
 */

import { apiFetch } from '@/lib/api';
import type {
  DailyEchoRawData,
  ContentChangeEvent,
  ChatSession,
} from './types';

const STORAGE_DAILY = 'mindos-echo-daily-line';
const STORAGE_GROWTH = 'mindos-echo-growth-intent';

/**
 * Calculate timestamp 24 hours ago
 */
function get24HoursAgo(): Date {
  const now = new Date();
  now.setHours(now.getHours() - 24);
  return now;
}

/**
 * Aggregate all data for a daily echo report
 * @param date - Date to generate report for (defaults to today)
 * @returns Raw aggregated data ready for LLM processing
 */
export async function aggregateDailyData(
  date: Date = new Date()
): Promise<DailyEchoRawData> {
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const since24hAgo = get24HoursAgo().toISOString();

  const fileNames: string[] = [];
  let filesCreated = 0;
  let sessionCount = 0;

  try {
    // Fetch file changes
    try {
      const changesRes = await apiFetch<{
        events: ContentChangeEvent[];
      }>('/api/changes', {
        method: 'GET',
        timeout: 5000,
      });

      if (changesRes?.events) {
        const changes = changesRes.events;

        // Filter to 24-hour window
        const since24h = new Date(since24hAgo);
        for (const change of changes) {
          const changeTime = new Date(change.ts);
          if (changeTime >= since24h) {
            // Extract base filename
            const baseName = change.path.split('/').pop() || change.path;
            fileNames.push(baseName);

            if (change.op === 'create') {
              filesCreated++;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[DailyEcho] Failed to fetch file changes:', err);
      // Continue with empty file changes
    }

    // Fetch chat sessions
    try {
      const sessionsRes = await apiFetch<ChatSession[]>(
        '/api/ask-sessions',
        {
          method: 'GET',
          timeout: 5000,
        }
      );

      if (Array.isArray(sessionsRes)) {
        const since24h = new Date(since24hAgo);
        sessionCount = sessionsRes.filter(s => {
          const sessionTime = new Date(s.createdAt);
          return sessionTime >= since24h;
        }).length;
      }
    } catch (err) {
      console.warn('[DailyEcho] Failed to fetch sessions:', err);
      // Continue with 0 sessions
    }

    // Read user intents from localStorage
    let dailyLine = '';
    let growthIntent = '';

    try {
      const stored = localStorage.getItem(STORAGE_DAILY);
      if (stored) dailyLine = stored;
    } catch (err) {
      console.warn('[DailyEcho] Failed to read daily line:', err);
    }

    try {
      const stored = localStorage.getItem(STORAGE_GROWTH);
      if (stored) growthIntent = stored;
    } catch (err) {
      console.warn('[DailyEcho] Failed to read growth intent:', err);
    }

    // Calculate KB growth (simplified: estimate from file count change)
    // In production, would track actual file sizes
    const estimatedKbPerFile = 2; // rough estimate
    const kbGrowth =
      filesCreated > 0
        ? `+${filesCreated * estimatedKbPerFile} KB`
        : 'same';

    return {
      date: dateStr,
      fileNames,
      filesEdited: new Set(fileNames).size,
      filesCreated,
      sessionCount,
      kbGrowth,
      dailyLine,
      growthIntent,
    };
  } catch (err) {
    console.error('[DailyEcho] Aggregation failed:', err);
    // Return minimal valid data
    return {
      date: dateStr,
      fileNames: [],
      filesEdited: 0,
      filesCreated: 0,
      sessionCount: 0,
      kbGrowth: 'error',
      dailyLine: '',
      growthIntent: '',
    };
  }
}
