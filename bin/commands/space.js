/**
 * mindos space — Knowledge base structure management
 *
 * Manages the directory tree of the knowledge base.
 * "Space" = directory + INSTRUCTION.md (AI context).
 * All directory operations go here; file content ops go to `mindos file`.
 */

import { existsSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';
import { isRemoteMode, apiCall } from '../lib/remote.js';

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
  summary: 'Knowledge base structure (ls, mkdir, rmdir, init, info, tree)',
  usage: 'mindos space <subcommand>',
  examples: [
    'mindos space ls',
    'mindos space ls "📝 笔记"',
    'mindos space tree',
    'mindos space mkdir "📝 笔记/新分类"',
    'mindos space rmdir "📝 笔记/旧分类"',
    'mindos space init "exploration"',
    'mindos space info "📝 笔记"',
    'mindos space create "Research"',
    'mindos space rename "Old" "New"',
  ],
};

export async function run(args, flags) {
  const sub = args[0];
  loadConfig();

  if (!sub || flags.help || flags.h) {
    console.log(`
${bold('mindos space')} — Knowledge base structure management

${bold('Browse:')}
  ${cyan('ls [path]'.padEnd(24))}${dim('List contents of a directory (default: root)')}
  ${cyan('tree [path]'.padEnd(24))}${dim('Show directory tree recursively')}
  ${cyan('info <path>'.padEnd(24))}${dim('Show directory details (type, files, modified)')}

${bold('Structure:')}
  ${cyan('create <name>'.padEnd(24))}${dim('Create a new Space (directory + INSTRUCTION.md)')}
  ${cyan('mkdir <path>'.padEnd(24))}${dim('Create a directory (no INSTRUCTION.md)')}
  ${cyan('rmdir <path>'.padEnd(24))}${dim('Delete a directory and all its contents')}
  ${cyan('rename <old> <new>'.padEnd(24))}${dim('Rename or move a directory')}
  ${cyan('init <path>'.padEnd(24))}${dim('Upgrade a directory to a Space (add INSTRUCTION.md)')}

${bold('Examples:')}
  ${dim('mindos space ls')}
  ${dim('mindos space ls "📝 笔记" --json')}
  ${dim('mindos space tree "⚙️ 配置"')}
  ${dim('mindos space mkdir "📝 笔记/新分类/子分类"')}
  ${dim('mindos space init "exploration"')}
`);
    return;
  }

  // Remote mode: delegate to HTTP API
  if (isRemoteMode()) {
    return remoteSpaceDispatch(sub, args, flags);
  }

  const root = getMindRoot();

  switch (sub) {
    case 'ls': case 'list': return spaceLs(root, args[1], flags);
    case 'tree': return spaceTree(root, args[1], flags);
    case 'info': return spaceInfo(root, args[1], flags);
    case 'create': return spaceCreate(root, args[1], flags);
    case 'mkdir': return spaceMkdir(root, args[1], flags);
    case 'rmdir': case 'rm': case 'delete': return spaceRmdir(root, args[1], flags);
    case 'rename': case 'mv': return spaceRename(root, args[1], args[2], flags);
    case 'init': case 'convert': return spaceInit(root, args[1], flags);
    default:
      console.error(red(`Unknown subcommand: ${sub}`));
      console.error(dim('Available: ls, tree, info, create, mkdir, rmdir, rename, init'));
      process.exit(EXIT.ARGS);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isSpace(dir) {
  return existsSync(resolve(dir, 'INSTRUCTION.md'));
}

function countFiles(dir) {
  let count = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isFile()) count++;
      else if (e.isDirectory()) count += countFiles(resolve(dir, e.name));
    }
  } catch { /* skip */ }
  return count;
}

function resolvePath(root, relPath) {
  const full = relPath ? resolve(root, relPath) : root;
  if (full !== root && !full.startsWith(root + '/')) {
    console.error(red(`Access denied: path outside knowledge base`));
    process.exit(EXIT.ERROR);
  }
  if (!existsSync(full)) {
    console.error(red(`Not found: ${relPath || '(root)'}`));
    process.exit(EXIT.NOT_FOUND);
  }
  return full;
}

// ── ls: list contents of a directory ──────────────────────────────────────────

function spaceLs(root, relPath, flags) {
  const dir = resolvePath(root, relPath);
  const entries = readdirSync(dir, { withFileTypes: true });
  const spaces = [];
  const dirs = [];
  const files = [];

  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      const entry = { name: e.name, type: isSpace(full) ? 'space' : 'dir', fileCount: countFiles(full) };
      (entry.type === 'space' ? spaces : dirs).push(entry);
    } else if (e.isFile()) {
      files.push({ name: e.name, type: 'file' });
    }
  }

  if (isJsonMode(flags)) {
    output({ path: relPath || '.', entries: [...spaces, ...dirs, ...files] }, flags);
    return;
  }

  const label = relPath ? `${relPath}/` : 'Knowledge Base';
  const total = spaces.length + dirs.length + files.length;
  if (total === 0) {
    console.log(dim(`\n${label} is empty.\n`));
    return;
  }

  console.log(`\n${bold(label)}\n`);
  for (const s of spaces) {
    console.log(`  ${cyan(s.name + '/')}  ${dim(`[Space] ${s.fileCount} files`)}`);
  }
  for (const d of dirs) {
    console.log(`  ${d.name}/  ${dim(`${d.fileCount} files`)}`);
  }
  for (const f of files) {
    console.log(`  ${dim(f.name)}`);
  }
  if (dirs.length > 0 && !relPath) {
    console.log(dim(`\n  Tip: \`mindos space init <name>\` to upgrade a directory to a Space`));
  }
  console.log();
}

// ── tree: recursive directory tree ────────────────────────────────────────────

function spaceTree(root, relPath, flags) {
  const dir = resolvePath(root, relPath);

  if (isJsonMode(flags)) {
    output({ path: relPath || '.', tree: buildTree(dir) }, flags);
    return;
  }

  const label = relPath || 'Knowledge Base';
  console.log(`\n${bold(label)}`);
  printTree(dir, '');
  console.log();
}

function buildTree(dir) {
  const result = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = resolve(dir, e.name);
      if (e.isDirectory()) {
        result.push({ name: e.name, type: isSpace(full) ? 'space' : 'dir', children: buildTree(full) });
      } else {
        result.push({ name: e.name, type: 'file' });
      }
    }
  } catch { /* skip */ }
  return result;
}

function printTree(dir, prefix) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.startsWith('.')); }
  catch { return; }

  entries.forEach((e, i) => {
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      const tag = isSpace(full) ? cyan(' [Space]') : '';
      console.log(`${prefix}${connector}${e.name}/${tag}`);
      printTree(full, prefix + (isLast ? '    ' : '│   '));
    } else {
      console.log(`${prefix}${connector}${dim(e.name)}`);
    }
  });
}

// ── info ──────────────────────────────────────────────────────────────────────

function spaceInfo(root, relPath, flags) {
  if (!relPath) {
    console.error(red('Usage: mindos space info <path>'));
    process.exit(EXIT.ARGS);
  }
  const dir = resolvePath(root, relPath);
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    console.error(red(`Not a directory: ${relPath}. Use \`mindos file read\` for files.`));
    process.exit(EXIT.ARGS);
  }

  const fileCount = countFiles(dir);
  const subdirs = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).length;
  const space = isSpace(dir);

  const info = { name: basename(relPath), path: relPath, type: space ? 'space' : 'dir', fileCount, subdirs, modified: stat.mtime.toISOString() };

  if (isJsonMode(flags)) {
    output(info, flags);
    return;
  }

  console.log(`\n${bold(relPath)}\n`);
  console.log(`  ${dim('Type:'.padEnd(15))}${space ? cyan('Space') : 'Directory'}`);
  console.log(`  ${dim('Files:'.padEnd(15))}${fileCount}`);
  console.log(`  ${dim('Subdirs:'.padEnd(15))}${subdirs}`);
  console.log(`  ${dim('Modified:'.padEnd(15))}${info.modified}`);
  if (!space) {
    console.log(`\n  ${dim('Tip: `mindos space init "' + relPath + '"` to upgrade to a Space')}`);
  }
  console.log();
}

// ── create: new Space (dir + INSTRUCTION.md) ──────────────────────────────────

function spaceCreate(root, name, flags) {
  if (!name) {
    console.error(red('Usage: mindos space create <name>'));
    process.exit(EXIT.ARGS);
  }
  const dir = resolve(root, name);
  if (existsSync(dir)) {
    console.error(red(`Already exists: ${name}`));
    process.exit(EXIT.ERROR);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'INSTRUCTION.md'), `# ${basename(name)}\n\nSpace instructions go here.\n`, 'utf-8');
  writeFileSync(resolve(dir, 'README.md'), `# ${basename(name)}\n`, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, name, type: 'space' }, flags);
    return;
  }
  console.log(`${green('✔')} Created Space: ${cyan(name)}`);
}

// ── mkdir: plain directory ────────────────────────────────────────────────────

function spaceMkdir(root, relPath, flags) {
  if (!relPath) {
    console.error(red('Usage: mindos space mkdir <path>'));
    process.exit(EXIT.ARGS);
  }
  const full = resolve(root, relPath);
  if (existsSync(full)) {
    if (isJsonMode(flags)) {
      output({ ok: true, path: relPath, created: false }, flags);
      return;
    }
    console.log(dim(`Already exists: ${relPath}`));
    return;
  }

  mkdirSync(full, { recursive: true });

  if (isJsonMode(flags)) {
    output({ ok: true, path: relPath, created: true }, flags);
    return;
  }
  console.log(`${green('✔')} Created directory: ${cyan(relPath)}`);
}

// ── rmdir: delete directory ───────────────────────────────────────────────────

function spaceRmdir(root, relPath, flags) {
  if (!relPath) {
    console.error(red('Usage: mindos space rmdir <path>'));
    process.exit(EXIT.ARGS);
  }
  const dir = resolvePath(root, relPath);
  const fileCount = countFiles(dir);
  rmSync(dir, { recursive: true, force: true });

  if (isJsonMode(flags)) {
    output({ ok: true, path: relPath, deletedFiles: fileCount }, flags);
    return;
  }
  console.log(`${green('✔')} Deleted: ${cyan(relPath)} (${fileCount} files removed)`);
}

// ── rename ────────────────────────────────────────────────────────────────────

function spaceRename(root, oldPath, newPath, flags) {
  if (!oldPath || !newPath) {
    console.error(red('Usage: mindos space rename <old-path> <new-path>'));
    process.exit(EXIT.ARGS);
  }
  const oldDir = resolvePath(root, oldPath);
  const newDir = resolve(root, newPath);
  if (existsSync(newDir)) {
    console.error(red(`Target already exists: ${newPath}`));
    process.exit(EXIT.ERROR);
  }

  // Ensure parent of target exists
  const parentDir = resolve(newDir, '..');
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  renameSync(oldDir, newDir);

  if (isJsonMode(flags)) {
    output({ ok: true, from: oldPath, to: newPath }, flags);
    return;
  }
  console.log(`${green('✔')} Renamed: ${cyan(oldPath)} → ${cyan(newPath)}`);
}

// ── init: upgrade directory to Space ──────────────────────────────────────────

function spaceInit(root, relPath, flags) {
  if (!relPath) {
    console.error(red('Usage: mindos space init <path>'));
    process.exit(EXIT.ARGS);
  }
  const dir = resolve(root, relPath);

  // If doesn't exist, create it + init as Space
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (isSpace(dir)) {
    if (isJsonMode(flags)) {
      output({ ok: true, path: relPath, initialized: false, message: 'already a Space' }, flags);
      return;
    }
    console.log(dim(`Already a Space: ${relPath}`));
    return;
  }

  writeFileSync(resolve(dir, 'INSTRUCTION.md'), `# ${basename(relPath)}\n\nSpace instructions go here.\n`, 'utf-8');
  if (!existsSync(resolve(dir, 'README.md'))) {
    writeFileSync(resolve(dir, 'README.md'), `# ${basename(relPath)}\n`, 'utf-8');
  }

  if (isJsonMode(flags)) {
    output({ ok: true, path: relPath, initialized: true }, flags);
    return;
  }
  console.log(`${green('✔')} Initialized Space: ${cyan(relPath)}`);
}

// ── Remote mode: space operations via HTTP API ─────────────────────────────

async function remoteSpaceDispatch(sub, args, flags) {
  try {
    switch (sub) {
      case 'ls':
      case 'list': {
        const res = await apiCall('/api/file?op=list_spaces');
        const data = await res.json();
        const spaces = data.spaces || [];
        if (isJsonMode(flags)) { output({ count: spaces.length, spaces }, flags); return; }
        if (spaces.length === 0) { console.log(dim('No spaces found.')); return; }
        console.log(`\n${bold(`Spaces (${spaces.length}):`)}\n`);
        for (const s of spaces) {
          const name = s.name || s.path || s;
          const files = s.fileCount != null ? dim(` (${s.fileCount} files)`) : '';
          console.log(`  ${cyan(name)}${files}`);
        }
        console.log();
        return;
      }

      case 'create': {
        const name = args[1];
        if (!name) { console.error(red('Usage: mindos space create <name>')); process.exit(EXIT.ERROR); }
        const res = await apiCall('/api/file', {
          method: 'POST',
          body: JSON.stringify({ action: 'create_space', name }),
        });
        await res.json();
        if (isJsonMode(flags)) { output({ ok: true, name }, flags); return; }
        console.log(`${green('✔')} Created Space: ${cyan(name)}`);
        return;
      }

      case 'rename':
      case 'mv': {
        const oldName = args[1], newName = args[2];
        if (!oldName || !newName) { console.error(red('Usage: mindos space rename <old> <new>')); process.exit(EXIT.ERROR); }
        const res = await apiCall('/api/file', {
          method: 'POST',
          body: JSON.stringify({ action: 'rename_space', oldName, newName }),
        });
        await res.json();
        if (isJsonMode(flags)) { output({ ok: true, from: oldName, to: newName }, flags); return; }
        console.log(`${green('✔')} Renamed: ${oldName} → ${cyan(newName)}`);
        return;
      }

      default:
        console.error(red(`Remote mode does not support 'space ${sub}'. Use: list, create, rename`));
        process.exit(EXIT.ERROR);
    }
  } catch (e) {
    console.error(red(`Remote error: ${e.message}`));
    process.exit(EXIT.ERROR);
  }
}
