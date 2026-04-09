import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs for config tests
vi.mock('fs');
const mockFs = vi.mocked(fs);

// We need to import after mocking
const CONFIG_DIR = path.join(os.homedir(), '.mindos');
const CONFIG_PATH = path.join(CONFIG_DIR, 'im.json');

describe('IM Config Manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset module cache to clear config cache
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readIMConfig', () => {
    it('returns empty config when file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const { readIMConfig, _resetConfigCache } = await import('@/lib/im/config');
      _resetConfigCache();
      const config = readIMConfig();
      expect(config).toEqual({ providers: {} });
    });

    it('parses valid config correctly', async () => {
      const validConfig = { providers: { telegram: { bot_token: '123:ABC' } } };
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 1000 } as fs.Stats);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(validConfig));
      const { readIMConfig, _resetConfigCache } = await import('@/lib/im/config');
      _resetConfigCache();
      const config = readIMConfig();
      expect(config.providers.telegram?.bot_token).toBe('123:ABC');
    });

    it('returns empty config for invalid JSON', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 2000 } as fs.Stats);
      mockFs.readFileSync.mockReturnValue('{not valid json}');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { readIMConfig, _resetConfigCache } = await import('@/lib/im/config');
      _resetConfigCache();
      const config = readIMConfig();
      expect(config).toEqual({ providers: {} });
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns empty config when providers is not an object', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ mtimeMs: 3000 } as fs.Stats);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ providers: 'invalid' }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { readIMConfig, _resetConfigCache } = await import('@/lib/im/config');
      _resetConfigCache();
      const config = readIMConfig();
      expect(config).toEqual({ providers: {} });
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('validatePlatformConfig', () => {
    it('validates telegram config (requires bot_token with colon)', async () => {
      const { validatePlatformConfig } = await import('@/lib/im/config');
      expect(validatePlatformConfig('telegram', { bot_token: '123:ABC' })).toEqual({ valid: true });
      expect(validatePlatformConfig('telegram', { bot_token: 'no-colon' }).valid).toBe(false);
      expect(validatePlatformConfig('telegram', {}).valid).toBe(false);
      expect(validatePlatformConfig('telegram', null).valid).toBe(false);
    });

    it('validates slack config (requires xoxb- prefix)', async () => {
      const { validatePlatformConfig } = await import('@/lib/im/config');
      expect(validatePlatformConfig('slack', { bot_token: 'xoxb-123' })).toEqual({ valid: true });
      expect(validatePlatformConfig('slack', { bot_token: 'invalid' }).valid).toBe(false);
    });

    it('validates wecom config (webhook_key OR corp_id+secret)', async () => {
      const { validatePlatformConfig } = await import('@/lib/im/config');
      expect(validatePlatformConfig('wecom', { webhook_key: 'abc' })).toEqual({ valid: true });
      expect(validatePlatformConfig('wecom', { corp_id: 'x', corp_secret: 'y' })).toEqual({ valid: true });
      expect(validatePlatformConfig('wecom', {}).valid).toBe(false);
    });

    it('validates dingtalk config (client_id+secret OR webhook_url)', async () => {
      const { validatePlatformConfig } = await import('@/lib/im/config');
      expect(validatePlatformConfig('dingtalk', { webhook_url: 'https://...' })).toEqual({ valid: true });
      expect(validatePlatformConfig('dingtalk', { client_id: 'x', client_secret: 'y' })).toEqual({ valid: true });
      expect(validatePlatformConfig('dingtalk', {}).valid).toBe(false);
    });
  });
});
