/**
 * mindos file — Knowledge base file operations
 *
 * Subcommands: list, read, create, delete, rename, move, search
 * Supports --json for agent consumption
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, dirname, relative } from 'node:path';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
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

function resolvePath(root, filePath) {
  const resolved = resolve(root, filePath);
  if (!resolved.startsWith(root)) {
    console.error(red(`Access denied: path outside knowledge base`));
    process.exit(EXIT.ERROR);
  }
  return resolved;
}

export const meta = {
  name: 'file',
  group: 'Knowledge',
  summary: 'File content operations (list, read, create, delete, rename, search)',
  usage: 'mindos file <subcommand>',
  flags: {
    '--space <name>': 'Filter by space name',
    '--json': 'Output as JSON',
    '--recursive, -r': 'Recursive listing',
  },
  examples: [
    'mindos file list',
    'mindos file list --space "Work"',
    'mindos file read "notes/meeting.md"',
    'mindos file create "notes/idea.md" --content "# My Idea"',
    'mindos file search "RAG implementation"',
    'mindos file delete "notes/old.md"',
  ],
};

export async function run(args, flags) {
  const sub = args[0];
  const root = getMindRoot();

  if (!sub || flags.help || flags.h) {
    printFileHelp();
    return;
  }

  switch (sub) {
    case 'list': return fileList(root, args.slice(1), flags);
    case 'ls': return fileList(root, args.slice(1), flags);
    case 'read': return fileRead(root, args[1], flags);
    case 'cat': return fileRead(root, args[1], flags);
    case 'create': return fileCreate(root, args[1], flags);
    case 'delete': return fileDelete(root, args[1], flags);
    case 'rm': return fileDelete(root, args[1], flags);
    case 'rename': return fileRename(root, args[1], args[2], flags);
    case 'mv': return fileRename(root, args[1], args[2], flags);
    case 'move': return fileRename(root, args[1], args[2], flags);
    case 'search': return fileSearch(root, args.slice(1).join(' '), flags);
    case 'mkdir':
      console.log(dim('Moved to: mindos space mkdir <path>'));
      process.exit(EXIT.ARGS);
    default:
      console.error(red(`Unknown subcommand: ${sub}`));
      console.error(dim('Available: list, read, create, delete, rename, move, mkdir, search'));
      process.exit(EXIT.ERROR);
  }
}

function printFileHelp() {
  console.log(`
${bold('mindos file')} — Knowledge base file operations

${bold('Subcommands:')}
  ${cyan('list'.padEnd(20))}${dim('List files in knowledge base')}
  ${cyan('read <path>'.padEnd(20))}${dim('Read file content')}
  ${cyan('create <path>'.padEnd(20))}${dim('Create a new file (--content "...")')}
  ${cyan('delete <path>'.padEnd(20))}${dim('Delete a file')}
  ${cyan('rename <old> <new>'.padEnd(20))}${dim('Rename or move a file')}
  ${cyan('search <query>'.padEnd(20))}${dim('Search files by content')}

${bold('Aliases:')} ls=list, cat=read, rm=delete, mv=rename

${bold('Examples:')}
  ${dim('mindos file list')}
  ${dim('mindos file list --json')}
  ${dim('mindos file read "notes/meeting.md"')}
  ${dim('mindos file create "ideas/new.md" --content "# New Idea"')}
  ${dim('mindos file search "machine learning"')}
`);
}

function walkFiles(dir, root, opts = {}) {
  const { recursive = true, space = null } = opts;
  const results = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = resolve(dir, entry.name);
    const rel = relative(root, full);

    if (entry.isDirectory()) {
      if (space && dirname(rel) === '.' && entry.name !== space) continue;
      if (recursive) results.push(...walkFiles(full, root, { ...opts, space: null }));
    } else if (entry.isFile()) {
      results.push({
        path: rel,
        name: entry.name,
        size: statSync(full).size,
      });
    }
  }
  return results;
}

function fileList(root, _args, flags) {
  const files = walkFiles(root, root, {
    recursive: flags.recursive || flags.r || true,
    space: flags.space || null,
  });

  if (isJsonMode(flags)) {
    output({ count: files.length, files }, flags);
    return;
  }

  if (files.length === 0) {
    console.log(dim('No files found.'));
    return;
  }

  console.log(`\n${bold(`Files (${files.length}):`)}\n`);
  for (const f of files) {
    const sizeStr = f.size < 1024 ? `${f.size}B` : `${(f.size / 1024).toFixed(1)}K`;
    console.log(`  ${f.path}  ${dim(sizeStr)}`);
  }
  console.log();
}

function fileRead(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file read <path>'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (!existsSync(full)) {
    console.error(red(`File not found: ${filePath}`));
    process.exit(EXIT.ERROR);
  }
  const content = readFileSync(full, 'utf-8');

  if (isJsonMode(flags)) {
    output({ path: filePath, size: content.length, content }, flags);
    return;
  }
  console.log(content);
}

function fileCreate(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file create <path> --content "..."'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (existsSync(full) && !flags.force) {
    console.error(red(`File already exists: ${filePath}`));
    console.error(dim('Use --force to overwrite.'));
    process.exit(EXIT.ERROR);
  }

  const content = flags.content || `# ${basename(filePath, '.md')}\n`;
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, size: content.length }, flags);
    return;
  }
  console.log(`${green('✔')} Created: ${cyan(filePath)}`);
}

function fileDelete(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file delete <path>'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (!existsSync(full)) {
    console.error(red(`File not found: ${filePath}`));
    process.exit(EXIT.ERROR);
  }

  unlinkSync(full);

  if (isJsonMode(flags)) {
    output({ ok: true, deleted: filePath }, flags);
    return;
  }
  console.log(`${green('✔')} Deleted: ${filePath}`);
}

function fileRename(root, oldPath, newPath, flags) {
  if (!oldPath || !newPath) {
    console.error(red('Usage: mindos file rename <old-path> <new-path>'));
    process.exit(EXIT.ERROR);
  }
  const fullOld = resolvePath(root, oldPath);
  const fullNew = resolvePath(root, newPath);

  if (!existsSync(fullOld)) {
    console.error(red(`File not found: ${oldPath}`));
    process.exit(EXIT.ERROR);
  }
  if (existsSync(fullNew) && !flags.force) {
    console.error(red(`Target already exists: ${newPath}`));
    process.exit(EXIT.ERROR);
  }

  mkdirSync(dirname(fullNew), { recursive: true });
  renameSync(fullOld, fullNew);

  if (isJsonMode(flags)) {
    output({ ok: true, from: oldPath, to: newPath }, flags);
    return;
  }
  console.log(`${green('✔')} Renamed: ${oldPath} → ${cyan(newPath)}`);
}

function fileSearch(root, query, flags) {
  if (!query) {
    console.error(red('Usage: mindos file search <query>'));
    process.exit(EXIT.ERROR);
  }

  const files = walkFiles(root, root);
  const results = [];
  const queryLower = query.toLowerCase();

  for (const f of files) {
    try {
      const content = readFileSync(resolve(root, f.path), 'utf-8');
      const lines = content.split('\n');
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
        }
      }
      if (matches.length > 0 || f.name.toLowerCase().includes(queryLower)) {
        results.push({ path: f.path, matches });
      }
    } catch { /* skip unreadable files */ }
  }

  if (isJsonMode(flags)) {
    output({ query, count: results.length, results }, flags);
    return;
  }

  if (results.length === 0) {
    console.log(dim(`No results for "${query}"`));
    return;
  }

  console.log(`\n${bold(`Search: "${query}"  (${results.length} files)`)}\n`);
  for (const r of results) {
    console.log(`  ${cyan(r.path)}`);
    for (const m of r.matches.slice(0, 3)) {
      console.log(`    ${dim(`L${m.line}:`)} ${m.text}`);
    }
    if (r.matches.length > 3) {
      console.log(`    ${dim(`...and ${r.matches.length - 3} more`)}`);
    }
  }
  console.log();
}

function fileMkdir(root, dirPath, flags) {
  if (!dirPath) {
    console.error(red('Usage: mindos file mkdir <path>'));
    process.exit(EXIT.ERROR);
  }
  const full = resolve(root, dirPath);
  if (existsSync(full)) {
    if (isJsonMode(flags)) {
      output({ ok: true, path: dirPath, created: false, message: 'already exists' }, flags);
      return;
    }
    console.log(dim(`Directory already exists: ${dirPath}`));
    return;
  }

  mkdirSync(full, { recursive: true });

  if (isJsonMode(flags)) {
    output({ ok: true, path: dirPath, created: true }, flags);
    return;
  }
  console.log(`${green('✔')} Created directory: ${cyan(dirPath)}`);
}
