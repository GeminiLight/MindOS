/**
 * Daily Echo Configuration Management
 *
 * Load, save, reset configuration from localStorage
 */

import type { DailyEchoConfig } from './types';

const CONFIG_KEY = 'mindos-daily-echo-config';

const DEFAULT_CONFIG: DailyEchoConfig = {
  enabled: false,
  scheduleTime: '20:00',
  timezone: 'Asia/Shanghai',
  language: 'zh',
  includeChat: true,
  includeTrendAnalysis: true,
  maxReportLength: 'medium',
};

/**
 * Load config from localStorage
 * Returns default if not found or invalid
 */
export function loadDailyEchoConfig(): DailyEchoConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_CONFIG };
    }

    const parsed = JSON.parse(stored);
    // Validate basic structure
    if (
      typeof parsed === 'object' &&
      'enabled' in parsed &&
      'scheduleTime' in parsed
    ) {
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
      };
    }

    return { ...DEFAULT_CONFIG };
  } catch (err) {
    console.warn('[DailyEcho] Failed to load config:', err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save config to localStorage
 */
export function saveDailyEchoConfig(config: DailyEchoConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('[DailyEcho] Failed to save config:', err);
  }
}

/**
 * Reset config to defaults
 */
export function resetDailyEchoConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch (err) {
    console.error('[DailyEcho] Failed to reset config:', err);
  }
}
