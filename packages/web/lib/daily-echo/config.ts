/**
 * Daily Echo Configuration Management
 *
 * Load, save, reset configuration from localStorage
 */

import { DEFAULT_DAILY_ECHO_CONFIG, type DailyEchoConfig } from './types';

const CONFIG_KEY = 'mindos-daily-echo-config';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeDailyEchoConfig(value: unknown): DailyEchoConfig {
  const config = { ...DEFAULT_DAILY_ECHO_CONFIG };
  if (!isRecord(value)) return config;

  if (typeof value.enabled === 'boolean') config.enabled = value.enabled;
  if (typeof value.scheduleTime === 'string' && TIME_RE.test(value.scheduleTime)) {
    config.scheduleTime = value.scheduleTime;
  }
  if (typeof value.timezone === 'string' && value.timezone.trim() && value.timezone.length <= 128) {
    config.timezone = value.timezone;
  }
  if (value.language === 'en' || value.language === 'zh') config.language = value.language;
  if (typeof value.includeChat === 'boolean') config.includeChat = value.includeChat;
  if (typeof value.includeTrendAnalysis === 'boolean') config.includeTrendAnalysis = value.includeTrendAnalysis;
  if (value.maxReportLength === 'short' || value.maxReportLength === 'medium' || value.maxReportLength === 'long') {
    config.maxReportLength = value.maxReportLength;
  }

  return config;
}

/**
 * Load config from localStorage
 * Returns default if not found or invalid
 */
export function loadDailyEchoConfig(): DailyEchoConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (!stored) {
      return { ...DEFAULT_DAILY_ECHO_CONFIG };
    }

    return normalizeDailyEchoConfig(JSON.parse(stored));
  } catch (err) {
    console.warn('[DailyEcho] Failed to load config:', err);
    return { ...DEFAULT_DAILY_ECHO_CONFIG };
  }
}

/**
 * Save config to localStorage
 */
export function saveDailyEchoConfig(config: DailyEchoConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeDailyEchoConfig(config)));
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
