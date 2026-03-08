import fs from 'fs';
import path from 'path';

const SETTINGS_PATH = path.join(process.cwd(), '.mindos-settings.json');

export interface ServerSettings {
  ai: {
    provider: 'anthropic' | 'openai';
    anthropicModel: string;
    anthropicApiKey: string; // empty = use env var
    openaiModel: string;
    openaiApiKey: string;    // empty = use env var
    openaiBaseUrl: string;
  };
  sopRoot: string; // empty = use env var / default
}

const DEFAULTS: ServerSettings = {
  ai: {
    provider: 'anthropic',
    anthropicModel: 'claude-sonnet-4-6',
    anthropicApiKey: '',
    openaiModel: 'gpt-4o-mini',
    openaiApiKey: '',
    openaiBaseUrl: '',
  },
  sopRoot: '',
};

export function readSettings(): ServerSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ai: { ...DEFAULTS.ai, ...parsed.ai },
      sopRoot: parsed.sopRoot ?? DEFAULTS.sopRoot,
    };
  } catch {
    return { ...DEFAULTS, ai: { ...DEFAULTS.ai } };
  }
}

export function writeSettings(settings: ServerSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

/** Effective values — settings file overrides defaults, env vars override settings file */
export function effectiveAiConfig() {
  const s = readSettings();
  return {
    provider: (process.env.AI_PROVIDER || s.ai.provider) as 'anthropic' | 'openai',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || s.ai.anthropicApiKey,
    anthropicModel: process.env.ANTHROPIC_MODEL || s.ai.anthropicModel,
    openaiApiKey: process.env.OPENAI_API_KEY || s.ai.openaiApiKey,
    openaiModel: process.env.OPENAI_MODEL || s.ai.openaiModel,
    openaiBaseUrl: process.env.OPENAI_BASE_URL || s.ai.openaiBaseUrl,
  };
}

export function effectiveSopRoot(): string {
  const s = readSettings();
  // Settings file takes priority over env var — allows user to override MIND_ROOT
  return s.sopRoot || process.env.MIND_ROOT || '/data/home/geminitwang/code/sop_note';
}
