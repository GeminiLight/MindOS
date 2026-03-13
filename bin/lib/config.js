import { existsSync, readFileSync } from 'node:fs';
import { CONFIG_PATH } from './constants.js';

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return;
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error(`Warning: failed to parse ${CONFIG_PATH}`);
    return;
  }

  const set = (key, val) => {
    if (val && !process.env[key]) process.env[key] = String(val);
  };

  set('MIND_ROOT',          config.mindRoot);
  set('MINDOS_WEB_PORT',    config.port);
  set('MINDOS_MCP_PORT',    config.mcpPort);
  set('AUTH_TOKEN',         config.authToken);
  set('WEB_PASSWORD',       config.webPassword);
  set('AI_PROVIDER',        config.ai?.provider);

  const providers = config.ai?.providers;
  if (providers) {
    set('ANTHROPIC_API_KEY', providers.anthropic?.apiKey);
    set('ANTHROPIC_MODEL',   providers.anthropic?.model);
    set('OPENAI_API_KEY',    providers.openai?.apiKey);
    set('OPENAI_MODEL',      providers.openai?.model);
    set('OPENAI_BASE_URL',   providers.openai?.baseUrl);
  } else {
    set('ANTHROPIC_API_KEY', config.ai?.anthropicApiKey);
    set('ANTHROPIC_MODEL',   config.ai?.anthropicModel);
    set('OPENAI_API_KEY',    config.ai?.openaiApiKey);
    set('OPENAI_MODEL',      config.ai?.openaiModel);
    set('OPENAI_BASE_URL',   config.ai?.openaiBaseUrl);
  }
}

export function getStartMode() {
  try {
    const mode = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).startMode || 'start';
    // 'daemon' is stored in config when user chose background service;
    // CLI maps it to the 'start' command with --daemon flag
    return mode === 'daemon' ? 'start' : mode;
  } catch {
    return 'start';
  }
}

export function isDaemonMode() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')).startMode === 'daemon';
  } catch {
    return false;
  }
}
