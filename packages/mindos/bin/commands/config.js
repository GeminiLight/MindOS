/**
 * mindos config — View and update MindOS configuration
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG_PATH, PRODUCT_PACKAGE_JSON } from '../lib/constants.js';
import { bold, dim, cyan, green, red } from '../lib/colors.js';
import { EXIT } from '../lib/command.js';

export const meta = {
  name: 'config',
  group: 'Config',
  summary: 'View or update configuration',
  usage: 'mindos config <subcommand>',
  flags: {
    '--json': 'Output as JSON',
  },
  examples: [
    'mindos config show',
    'mindos config set startMode dev',
    'mindos config unset sync.remote',
    'mindos config validate',
  ],
};

const maskKey = (val) => {
  if (!val) return val;
  if (val.length <= 8) return '****';
  return val.slice(0, 6) + '****';
};

const readConfig = () => {
  if (!existsSync(CONFIG_PATH)) {
    console.error(red('No config found. Run `mindos onboard` first.'));
    process.exit(EXIT.ERROR);
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.error(red('Failed to parse config file.'));
    process.exit(EXIT.ERROR);
  }
};

const coerceValue = (v) => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (v === '""' || v === "''") return '';
  if (v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return v;
};

export const run = (args, flags) => {
  const sub = args[0];

  if (sub === 'show') {
    const config = readConfig();
    const display = JSON.parse(JSON.stringify(config));
    if (display.ai?.providers?.anthropic?.apiKey)
      display.ai.providers.anthropic.apiKey = maskKey(display.ai.providers.anthropic.apiKey);
    if (display.ai?.providers?.openai?.apiKey)
      display.ai.providers.openai.apiKey = maskKey(display.ai.providers.openai.apiKey);
    if (display.ai?.anthropicApiKey)
      display.ai.anthropicApiKey = maskKey(display.ai.anthropicApiKey);
    if (display.ai?.openaiApiKey)
      display.ai.openaiApiKey = maskKey(display.ai.openaiApiKey);
    if (display.authToken)
      display.authToken = maskKey(display.authToken);
    if (display.webPassword)
      display.webPassword = maskKey(display.webPassword);

    if (flags.json) {
      console.log(JSON.stringify(display, null, 2));
      return;
    }
    const pkgVersion = (() => { try { return JSON.parse(readFileSync(PRODUCT_PACKAGE_JSON, 'utf-8')).version; } catch { return '?'; } })();
    console.log(`\n${bold('MindOS Config')}  ${dim(`v${pkgVersion}`)}  ${dim(CONFIG_PATH)}\n`);
    console.log(JSON.stringify(display, null, 2));
    console.log();
    return;
  }

  if (sub === 'validate') {
    const config = readConfig();
    const issues = [];
    if (!config.mindRoot) issues.push('missing required field: mindRoot');
    if (!config.ai?.provider) issues.push('missing field: ai.provider');
    if (config.ai?.provider === 'anthropic') {
      const key = config.ai?.providers?.anthropic?.apiKey || config.ai?.anthropicApiKey;
      if (!key) issues.push('ai.provider is "anthropic" but no API key found');
    }
    if (config.ai?.provider === 'openai') {
      const key = config.ai?.providers?.openai?.apiKey || config.ai?.openaiApiKey;
      if (!key) issues.push('ai.provider is "openai" but no API key found');
    }
    if (issues.length) {
      console.error(`\n${red('✘ Config has issues:')}`);
      issues.forEach(i => console.error(`  ${red('•')} ${i}`));
      console.error(`\n  ${dim('Run `mindos onboard` to fix.\n')}`);
      process.exit(EXIT.ERROR);
    }
    console.log(`\n${green('✔ Config is valid')}\n`);
    return;
  }

  if (sub === 'set') {
    const key = args[1];
    const val = args[2];
    if (!key || val === undefined) {
      console.error(red('Usage: mindos config set <key> <value>'));
      console.error(dim('  Examples:'));
      console.error(dim('    mindos config set port 3002'));
      console.error(dim('    mindos config set mcpPort 8788'));
      console.error(dim('    mindos config set ai.provider openai'));
      process.exit(EXIT.ARGS);
    }
    const config = readConfig();
    const parts = key.split('.');
    let obj = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof obj[parts[i]] !== 'object' || !obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    const coerced = coerceValue(val);
    obj[parts[parts.length - 1]] = coerced;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`${green('✔')} Set ${cyan(key)} = ${bold(String(coerced))}`);
    return;
  }

  if (sub === 'unset') {
    const key = args[1];
    if (!key) {
      console.error(red('Usage: mindos config unset <key>'));
      process.exit(EXIT.ARGS);
    }
    const config = readConfig();
    const parts = key.split('.');
    let obj = config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) { console.log(dim(`Key "${key}" not found`)); return; }
      obj = obj[parts[i]];
    }
    if (!(parts[parts.length - 1] in obj)) { console.log(dim(`Key "${key}" not found`)); return; }
    delete obj[parts[parts.length - 1]];
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`${green('✔')} Removed ${cyan(key)}`);
    return;
  }

  // No subcommand → show help
  const row = (c, d) => `  ${cyan(c.padEnd(32))}${dim(d)}`;
  console.log(`
${bold('mindos config')} — view and update MindOS configuration

${bold('Subcommands:')}
${row('mindos config show',          'Print current config (API keys masked)')}
${row('mindos config validate',      'Validate config file')}
${row('mindos config set <key> <v>', 'Update a single field (dot-notation supported)')}
${row('mindos config unset <key>',   'Remove a config field')}

${bold('Examples:')}
  ${dim('mindos config set port 3002')}
  ${dim('mindos config set ai.provider openai')}
  ${dim('mindos config set setupPending false')}
  ${dim('mindos config unset webPassword')}
`);
};
