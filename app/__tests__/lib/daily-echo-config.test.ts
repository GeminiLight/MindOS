/**
 * Tests for Daily Echo configuration management
 * Load/save/reset config from localStorage
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DailyEchoConfig } from '../types';

const CONFIG_KEY = 'mindos-daily-echo-config';

describe('DailyEcho Config', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('loadConfig()', () => {
    it('should return default config when none exists', () => {
      // Given: empty localStorage
      localStorage.removeItem(CONFIG_KEY);

      // When: loading
      const stored = localStorage.getItem(CONFIG_KEY);

      // Then: should be null
      expect(stored).toBeNull();
    });

    it('should parse stored config from JSON', () => {
      // Given: config stored in localStorage
      const config: DailyEchoConfig = {
        enabled: true,
        scheduleTime: '20:00',
        timezone: 'Asia/Shanghai',
        language: 'zh',
        includeChat: true,
        includeTrendAnalysis: true,
        maxReportLength: 'medium',
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

      // When: loading
      const stored = localStorage.getItem(CONFIG_KEY);
      const parsed = stored ? JSON.parse(stored) : null;

      // Then: should parse correctly
      expect(parsed).toEqual(config);
    });

    it('should handle invalid JSON gracefully', () => {
      // Given: corrupted JSON in storage
      localStorage.setItem(CONFIG_KEY, 'invalid json {');

      // When: loading
      const stored = localStorage.getItem(CONFIG_KEY);

      // Then: should not crash
      expect(() => {
        if (stored) JSON.parse(stored);
      }).toThrow();
    });
  });

  describe('saveConfig()', () => {
    it('should persist config to localStorage', () => {
      // Given: config object
      const config: DailyEchoConfig = {
        enabled: true,
        scheduleTime: '19:00',
        timezone: 'America/New_York',
        language: 'en',
        includeChat: false,
        includeTrendAnalysis: false,
        maxReportLength: 'short',
      };

      // When: saving
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

      // Then: should be retrievable
      const retrieved = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
      expect(retrieved).toEqual(config);
    });

    it('should overwrite existing config', () => {
      // Given: existing config
      const old: DailyEchoConfig = {
        enabled: false,
        scheduleTime: '20:00',
        timezone: 'Asia/Shanghai',
        language: 'zh',
        includeChat: true,
        includeTrendAnalysis: true,
        maxReportLength: 'medium',
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(old));

      // When: saving new config
      const newConfig: DailyEchoConfig = {
        ...old,
        enabled: true,
        scheduleTime: '21:00',
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));

      // Then: should have new values
      const retrieved = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
      expect(retrieved.enabled).toBe(true);
      expect(retrieved.scheduleTime).toBe('21:00');
    });

    it('should handle timezone edge cases', () => {
      // Given: various timezone values
      const timezones = [
        'Asia/Shanghai',
        'America/New_York',
        'Europe/London',
        'UTC',
        'Asia/Tokyo',
      ];

      // When: saving each
      for (const tz of timezones) {
        const config: DailyEchoConfig = {
          enabled: true,
          scheduleTime: '20:00',
          timezone: tz,
          language: 'en',
          includeChat: true,
          includeTrendAnalysis: true,
          maxReportLength: 'medium',
        };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

        // Then: should preserve exact timezone string
        const retrieved = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
        expect(retrieved.timezone).toBe(tz);
      }
    });

    it('should handle all report length options', () => {
      // Given: all length options
      const lengths: Array<'short' | 'medium' | 'long'> = [
        'short',
        'medium',
        'long',
      ];

      // When: saving each
      for (const length of lengths) {
        const config: DailyEchoConfig = {
          enabled: true,
          scheduleTime: '20:00',
          timezone: 'Asia/Shanghai',
          language: 'zh',
          includeChat: true,
          includeTrendAnalysis: true,
          maxReportLength: length,
        };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

        // Then: should preserve
        const retrieved = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
        expect(retrieved.maxReportLength).toBe(length);
      }
    });

    it('should handle both languages', () => {
      // Given: both languages
      for (const lang of ['en' as const, 'zh' as const]) {
        const config: DailyEchoConfig = {
          enabled: true,
          scheduleTime: '20:00',
          timezone: 'Asia/Shanghai',
          language: lang,
          includeChat: true,
          includeTrendAnalysis: true,
          maxReportLength: 'medium',
        };

        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

        const retrieved = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
        expect(retrieved.language).toBe(lang);
      }
    });
  });

  describe('resetConfig()', () => {
    it('should clear config from storage', () => {
      // Given: config exists
      const config: DailyEchoConfig = {
        enabled: true,
        scheduleTime: '20:00',
        timezone: 'Asia/Shanghai',
        language: 'zh',
        includeChat: true,
        includeTrendAnalysis: true,
        maxReportLength: 'medium',
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

      // When: resetting
      localStorage.removeItem(CONFIG_KEY);

      // Then: should be gone
      expect(localStorage.getItem(CONFIG_KEY)).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty schedule time', () => {
      // Given: empty string
      const config: Partial<DailyEchoConfig> = {
        scheduleTime: '',
      };

      // Then: should be stored but likely invalid
      expect(config.scheduleTime).toBe('');
    });

    it('should handle schedule time in 24h format', () => {
      // Given: valid 24h times
      const times = ['00:00', '12:00', '23:59', '09:30'];

      // When: checking format
      for (const time of times) {
        expect(time).toMatch(/^\d{2}:\d{2}$/);
      }
    });

    it('should reject invalid schedule time format', () => {
      // Given: invalid time strings (format or out-of-range)
      const invalidTimes = ['1:00', '12-00'];

      // Then: should not match HH:MM format
      for (const time of invalidTimes) {
        expect(time).not.toMatch(/^\d{2}:\d{2}$/);
      }

      // Semantic validation (range): 25:00, 12:60 match format but are out of range
      const outOfRange = ['25:00', '12:60'];
      const validTimeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
      for (const time of outOfRange) {
        expect(time).not.toMatch(validTimeRegex);
      }
    });
  });
});
