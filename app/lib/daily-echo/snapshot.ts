/**
 * Daily Echo Snapshot Generator
 *
 * Converts raw aggregated data into formatted statistics
 */

import type { DailyEchoRawData, DailySnapshot } from './types';

/**
 * Generate snapshot statistics from raw data
 */
export function generateSnapshot(raw: DailyEchoRawData): DailySnapshot {
  return {
    filesEdited: raw.filesEdited,
    filesCreated: raw.filesCreated,
    sessionCount: raw.sessionCount,
    kbGrowth: raw.kbGrowth,
  };
}
