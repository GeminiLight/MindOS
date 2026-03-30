/**
 * mindos space — Mind Space management
 */

import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { bold, dim, cyan, green, red } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';

function getMindRoot() {
  loadConfig();
  const root = process.env.MIND_ROOT;
  if (!root || !existsSync(root)) {
    console.error(red('Mind root not configured. Run `mindos onboard` first.'));
    process.exit(EXIT.ERROR);
  }
  return root;
}

export const meta = {
  name: 'space',
  group: 'Knowledge',
  summary: 'Mind Space management (list, create, delete, rename, info)',
  usage: 'mindos space <subcommand>',
  examples: [
    'mindos space list',
    'mindos space list --json',
    'mindos space create "Research"',
    'mindos space delete "Old Project"',
    'mindos space rename "Old" "New"',
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
  ${cyan('delete <name>'.padEnd(20))}${dim('Delete a space and all its files')}
  ${cyan('rename <old> <new>'.padEnd(20))}${dim('Rename a space')}
  ${cyan('info <name>'.padEnd(20))}${dim('Show space details')}

${bold('Examples:')}
  ${dim('mindos space list')}
  ${dim('mindos space create "Research"')}
  ${dim('mindos space delete "Old Project"')}
  ${dim('mindos space rename "Old" "New"')}
`);
    return;
  }

  switch (sub) {
    case 'list': return spaceList(root, flags);
    case 'ls': return spaceList(root, flags);
    case 'create': return spaceCreate(root, args[1], flags);
    case 'delete': case 'rm': return spaceDelete(root, args[1], flags);
    case 'rename': case 'mv': return spaceRename(root, args[1], args[2], flags);
    case 'info': return spaceInfo(root, args[1], flags);
    default:
      console.error(red(`Unknown subcommand: ${sub}`));
      console.error(dim('Available: list, create, delete, rename, info'));
      process.exit(EXIT.ERROR);
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
    process.exit(EXIT.ERROR);
  }
  const dir = resolve(root, name);
  if (existsSync(dir)) {
    console.error(red(`Space already exists: ${name}`));
    process.exit(EXIT.ERROR);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'INSTRUCTION.md'), `# ${name}\n\nSpace instructions go here.\n`, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, name, path: name }, flags);
    return;
  }
  console.log(`${green('✔')} Created space: ${cyan(name)}`);
}

function spaceDelete(root, name, flags) {
  if (!name) {
    console.error(red('Usage: mindos space delete <name>'));
    process.exit(EXIT.ERROR);
  }
  const dir = resolve(root, name);
  if (!existsSync(dir)) {
    console.error(red(`Space not found: ${name}`));
    process.exit(EXIT.ERROR);
  }

  const fileCount = countFiles(dir);
  rmSync(dir, { recursive: true, force: true });

  if (isJsonMode(flags)) {
    output({ ok: true, name, deletedFiles: fileCount }, flags);
    return;
  }
  console.log(`${green('✔')} Deleted space: ${cyan(name)} (${fileCount} files removed)`);
}

function spaceRename(root, oldName, newName, flags) {
  if (!oldName || !newName) {
    console.error(red('Usage: mindos space rename <old-name> <new-name>'));
    process.exit(EXIT.ERROR);
  }
  const oldDir = resolve(root, oldName);
  const newDir = resolve(root, newName);
  if (!existsSync(oldDir)) {
    console.error(red(`Space not found: ${oldName}`));
    process.exit(EXIT.ERROR);
  }
  if (existsSync(newDir)) {
    console.error(red(`Target already exists: ${newName}`));
    process.exit(EXIT.ERROR);
  }

  renameSync(oldDir, newDir);

  if (isJsonMode(flags)) {
    output({ ok: true, from: oldName, to: newName }, flags);
    return;
  }
  console.log(`${green('✔')} Renamed space: ${cyan(oldName)} → ${cyan(newName)}`);
}

function spaceInfo(root, name, flags) {
  if (!name) {
    console.error(red('Usage: mindos space info <name>'));
    process.exit(EXIT.ERROR);
  }
  const dir = resolve(root, name);
  if (!existsSync(dir)) {
    console.error(red(`Space not found: ${name}`));
    process.exit(EXIT.ERROR);
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
