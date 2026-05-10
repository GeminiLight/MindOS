/**
 * mindos init-skills — Initialize skill rules
 */

import { existsSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROOT, CONFIG_PATH } from '../lib/constants.js';
import { bold, dim, cyan, green, red } from '../lib/colors.js';
import { EXIT } from '../lib/command.js';
import { resolveInsideRoot } from '../lib/safe-path.js';

export const meta = {
  name: 'init-skills',
  group: 'Config',
  summary: 'Initialize skill rules',
  usage: 'mindos init-skills',
  hidden: true,
};

export function initializeUserPreferences(config, options = {}) {
  const mindRoot = config.mindRoot;
  const templateRoot = options.templateRoot ?? resolve(ROOT, 'templates', 'skill-rules');

  let dest;
  try {
    dest = resolveInsideRoot(mindRoot, '.mindos/user-preferences.md');
  } catch {
    return { status: 'unsafe-path' };
  }

  if (existsSync(dest)) return { status: 'exists' };
  mkdirSync(dirname(dest), { recursive: true });

  const isZh = config.disabledSkills?.includes('mindos');
  const lang = isZh ? 'zh' : 'en';
  const src = resolve(templateRoot, lang, 'user-rules.md');
  if (!existsSync(src)) return { status: 'template-missing' };

  cpSync(src, dest);
  return { status: 'created', dir: dirname(dest) };
}

export const run = () => {
  console.log(`\n${bold('📦 Initialize Skill Rules')}\n`);

  if (!existsSync(CONFIG_PATH)) {
    console.log(`  ${red('✘')} Config not found. Run ${cyan('mindos onboard')} first.\n`);
    process.exit(EXIT.ERROR);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    console.log(`  ${red('✘')} Failed to parse config at ${dim(CONFIG_PATH)}\n`);
    process.exit(EXIT.ERROR);
  }
  const mindRoot = config.mindRoot;
  if (!mindRoot || !existsSync(mindRoot)) {
    console.log(`  ${red('✘')} Knowledge base not found: ${dim(mindRoot || '(not set)')}\n`);
    process.exit(EXIT.ERROR);
  }

  const result = initializeUserPreferences(config);
  if (result.status === 'exists') {
    console.log(`  ${dim('skip')}  .mindos/user-preferences.md (already exists)\n`);
  } else if (result.status === 'created') {
    console.log(`  ${green('✓')}  .mindos/user-preferences.md created at ${dim(result.dir)}\n`);
  } else if (result.status === 'unsafe-path') {
    console.log(`  ${red('✘')} Unsafe .mindos path. Refusing to write outside the knowledge base.\n`);
    process.exit(EXIT.ERROR);
  } else {
    console.log(`  ${dim('skip')}  Template not found, create .mindos/user-preferences.md manually if needed.\n`);
  }
  console.log(`  ${dim('Note: Operating rules are now built into the app. No install needed.')}\n`);
};
