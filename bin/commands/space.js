/**
 * mindos space — Mind Space management
 */

import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { bold, dim, cyan, green, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode } from '../lib/command.js';

function getMindRoot() {
  loadConfig();
  const root = process.env.MIND_ROOT;
  if (!root || !existsSync(root)) {
    console.error(red('Mind root not configured. Run `mindos onboard` first.'));
    process.exit(1);
  }
  return root;
}

export const meta = {
  name: 'space',
  group: 'Knowledge',
  summary: 'Mind Space management (list, create, info)',
  usage: 'mindos space <subcommand>',
  examples: [
    'mindos space list',
    'mindos space list --json',
    'mindos space create "Research"',
    'mindos space info "Work"',
  ],
};

export async function run(args, flags) {
  const sub = args[0];
  const root = getMindRoot();

  if (!sub || flags.help || flags.h) {
    console.log(`
${bold('mindos space')} — Mind Space management

${bold('Subcommands:')}
  ${cyan('list'.padEnd(20))}${dim('List all spaces')}
  ${cyan('create <name>'.padEnd(20))}${dim('Create a new space')}
  ${cyan('info <name>'.padEnd(20))}${dim('Show space details')}

${bold('Examples:')}
  ${dim('mindos space list')}
  ${dim('mindos space create "Research"')}
`);
    return;
  }

  switch (sub) {
    case 'list': return spaceList(root, flags);
    case 'ls': return spaceList(root, flags);
    case 'create': return spaceCreate(root, args[1], flags);
    case 'info': return spaceInfo(root, args[1], flags);
    default:
      console.error(red(`Unknown subcommand: ${sub}`));
      console.error(dim('Available: list, create, info'));
      process.exit(1);
  }
}

function isSpace(dir) {
  // A space is a top-level directory that contains an INSTRUCTION.md
  return existsSync(resolve(dir, 'INSTRUCTION.md'));
}

function countFiles(dir) {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isFile()) count++;
      else if (e.isDirectory()) count += countFiles(resolve(dir, e.name));
    }
  } catch { /* skip */ }
  return count;
}

function spaceList(root, flags) {
  const entries = readdirSync(root, { withFileTypes: true });
  const spaces = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const full = resolve(root, e.name);
    if (isSpace(full)) {
      const fileCount = countFiles(full);
      spaces.push({ name: e.name, path: e.name, fileCount });
    }
  }

  if (isJsonMode(flags)) {
    output({ count: spaces.length, spaces }, flags);
    return;
  }

  if (spaces.length === 0) {
    console.log(dim('No spaces found. Create one with: mindos space create "Name"'));
    return;
  }

  console.log(`\n${bold(`Spaces (${spaces.length}):`)}\n`);
  for (const s of spaces) {
    console.log(`  ${cyan(s.name.padEnd(30))}${dim(`${s.fileCount} files`)}`);
  }
  console.log();
}

function spaceCreate(root, name, flags) {
  if (!name) {
    console.error(red('Usage: mindos space create <name>'));
    process.exit(1);
  }
  const dir = resolve(root, name);
  if (existsSync(dir)) {
    console.error(red(`Space already exists: ${name}`));
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'INSTRUCTION.md'), `# ${name}\n\nSpace instructions go here.\n`, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, name, path: name }, flags);
    return;
  }
  console.log(`${green('✔')} Created space: ${cyan(name)}`);
}

function spaceInfo(root, name, flags) {
  if (!name) {
    console.error(red('Usage: mindos space info <name>'));
    process.exit(1);
  }
  const dir = resolve(root, name);
  if (!existsSync(dir)) {
    console.error(red(`Space not found: ${name}`));
    process.exit(1);
  }

  const fileCount = countFiles(dir);
  const stat = statSync(dir);

  const info = {
    name,
    path: name,
    fileCount,
    isSpace: isSpace(dir),
    modified: stat.mtime.toISOString(),
  };

  if (isJsonMode(flags)) {
    output(info, flags);
    return;
  }

  console.log(`\n${bold(`Space: ${name}`)}\n`);
  console.log(`  ${dim('Files:'.padEnd(15))}${fileCount}`);
  console.log(`  ${dim('Is Space:'.padEnd(15))}${info.isSpace ? green('yes') : 'no (folder)'}`);
  console.log(`  ${dim('Modified:'.padEnd(15))}${info.modified}`);
  console.log();
}
