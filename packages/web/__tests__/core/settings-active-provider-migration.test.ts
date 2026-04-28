import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/settings');

describe('readSettings activeProvider normalization', () => {
  let tempHome: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-settings-migration-'));
    fs.mkdirSync(path.join(tempHome, '.mindos'), { recursive: true });
    configPath = path.join(tempHome, '.mindos', 'config.json');
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('maps protocol-style activeProvider to provider entry id for array-based configs', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      ai: {
        activeProvider: 'openai',
        providers: [
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
          { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
        ],
      },
      mindRoot: '/tmp/mind',
    }), 'utf-8');

    const { readSettings } = await import('@/lib/settings');
    const settings = readSettings();

    expect(settings.ai.activeProvider).toBe('p_openai01');
  });

  it('falls back to the first provider when activeProvider points to a missing entry', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      ai: {
        activeProvider: 'p_missing',
        providers: [
          { id: 'p_google01', name: 'Google Gemini', protocol: 'google', apiKey: '', model: 'gemini-2.5-flash', baseUrl: '' },
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      mindRoot: '/tmp/mind',
    }), 'utf-8');

    const { readSettings } = await import('@/lib/settings');
    const settings = readSettings();

    expect(settings.ai.activeProvider).toBe('p_google01');
  });
});
