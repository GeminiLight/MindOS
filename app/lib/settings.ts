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
  mindRoot: string; // empty = use env var / default
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
  mindRoot: '',
};

export function readSettings(): ServerSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ai: { ...DEFAULTS.ai, ...parsed.ai },
      // Support both old "sopRoot" and new "mindRoot" keys
      mindRoot: parsed.mindRoot ?? parsed.sopRoot ?? DEFAULTS.mindRoot,
    };
  } catch {
    return { ...DEFAULTS, ai: { ...DEFAULTS.ai } };
  }
}

export function writeSettings(settings: ServerSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

/** Effective values — settings file overrides env vars when non-empty */
export function effectiveAiConfig() {
  const s = readSettings();
  return {
    provider: (s.ai.provider || process.env.AI_PROVIDER || 'anthropic') as 'anthropic' | 'openai',
    anthropicApiKey: s.ai.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: s.ai.anthropicModel || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    openaiApiKey: s.ai.openaiApiKey || process.env.OPENAI_API_KEY || '',
    openaiModel: s.ai.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    openaiBaseUrl: s.ai.openaiBaseUrl || process.env.OPENAI_BASE_URL || '',
  };
}

/** Effective MIND_ROOT — settings file can override, env var is fallback */
export function effectiveSopRoot(): string {
  const s = readSettings();
  return s.mindRoot || process.env.MIND_ROOT || '/data/home/geminitwang/code/sop_note/my-mind';
}
