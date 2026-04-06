/**
 * mindos file — Knowledge base file operations
 *
 * Subcommands: list, read, write, create, append, edit-section, insert-heading,
 *              append-csv, delete, rename, move, search, backlinks, recent, history
 * Supports --json for agent consumption
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, renameSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, basename, dirname, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { bold, dim, cyan, green, red, yellow } from '../lib/colors.js';
import { loadConfig } from '../lib/config.js';
import { output, isJsonMode, EXIT } from '../lib/command.js';
import { isRemoteMode, apiCall } from '../lib/remote.js';
import { replaceSection, insertAfterHeading, listHeadings } from '../lib/markdown.js';
import { escapeCsvRow } from '../lib/csv.js';

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
  if (resolved !== root) {
    const rel = relative(root, resolved);
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) {
      console.error(red(`Access denied: path outside knowledge base`));
      process.exit(EXIT.ERROR);
    }
  }
  return resolved;
}

export const meta = {
  name: 'file',
  group: 'Knowledge',
  summary: 'Manage files (list, read, write, edit, search, ...)',
  usage: 'mindos file <subcommand>',
  flags: {
    '--space <name>': 'Filter by space name',
    '--json': 'Output as JSON',
    '--content <text>': 'Content for write/create/append',
    '-H, --heading <h>': 'Target heading for edit-section/insert-heading',
    '--row <csv>': 'CSV row values (comma-separated)',
    '--limit <n>': 'Limit results (recent, history)',
  },
  examples: [
    'mindos file list',
    'mindos file read "notes/meeting.md"',
    'mindos file write "notes/plan.md" --content "# Plan"',
    'mindos file append "log/journal.md" --content "New entry"',
    'mindos file edit-section "plan.md" -H "## Status" --content "Done"',
    'mindos file append-csv "tracker.csv" --row "2026-04-04,done,30min"',
    'mindos file backlinks "concepts/RAG.md"',
    'mindos file recent --limit 5',
    'mindos file history "notes/meeting.md"',
  ],
};

export async function run(args, flags) {
  const sub = args[0];
  loadConfig();

  if (!sub) {
    printHelp();
    return;
  }

  // Remote mode: delegate to HTTP API
  if (isRemoteMode()) {
    return remoteFileDispatch(sub, args, flags);
  }

  const root = getMindRoot();

  switch (sub) {
    case 'list': case 'ls': return fileList(root, args.slice(1), flags);
    case 'read': case 'cat': return fileRead(root, args[1], flags);
    case 'write': return fileWrite(root, args[1], flags);
    case 'create': return fileCreate(root, args[1], flags);
    case 'append': return fileAppend(root, args[1], flags);
    case 'edit-section': return fileEditSection(root, args[1], flags);
    case 'insert-heading': return fileInsertHeading(root, args[1], flags);
    case 'append-csv': return fileAppendCsv(root, args[1], flags);
    case 'delete': case 'rm': return fileDelete(root, args[1], flags);
    case 'rename': case 'mv': case 'move': return fileRename(root, args[1], args[2], flags);
    case 'search': return fileSearch(root, args.slice(1).join(' '), flags);
    case 'backlinks': return fileBacklinks(root, args[1], flags);
    case 'recent': return fileRecent(root, flags);
    case 'history': return fileHistory(root, args[1], flags);
    case 'mkdir':
      console.log(dim('Moved to: mindos space mkdir <path>'));
      process.exit(EXIT.ARGS);
    default:
      console.error(red(`Unknown subcommand: ${sub}`));
      printHelp();
      process.exit(EXIT.ERROR);
  }
}

export function printHelp() {
  const sub = (s, w = 24) => cyan(s.padEnd(w));
  console.log(`
${bold('mindos file')} — Knowledge base file operations

${bold('SUBCOMMANDS')}
  ${sub('list')}${dim('List files in knowledge base')}
  ${sub('read <path>')}${dim('Read file content')}
  ${sub('write <path>')}${dim('Write/overwrite file (--content or stdin)')}
  ${sub('create <path>')}${dim('Create a new file (--content "...")')}
  ${sub('append <path>')}${dim('Append content to file end')}
  ${sub('edit-section <path>')}${dim('Replace a markdown section (-H "## Heading")')}
  ${sub('insert-heading <path>')}${dim('Insert after a heading (-H "## Heading")')}
  ${sub('append-csv <path>')}${dim('Append row to CSV (--row "a,b,c")')}
  ${sub('delete <path>')}${dim('Delete a file')}
  ${sub('rename <old> <new>')}${dim('Rename or move a file')}
  ${sub('search <query>')}${dim('Search files by content')}
  ${sub('backlinks <path>')}${dim('Find files that reference this file')}
  ${sub('recent')}${dim('Show recently modified files')}
  ${sub('history <path>')}${dim('Show git commit history')}

${bold('ALIASES')}  ls=list  cat=read  rm=delete  mv=rename

${bold('EXAMPLES')}
  ${dim('mindos file list --json')}
  ${dim('mindos file read "notes/meeting.md"')}
  ${dim('mindos file write "plan.md" --content "# Plan"')}
  ${dim('mindos file edit-section "plan.md" -H "## Status" --content "Done"')}
  ${dim('mindos file append-csv "habits.csv" --row "2026-04-04,run,30min"')}
  ${dim('mindos file backlinks "concepts/RAG.md"')}
  ${dim('mindos file recent --limit 5')}
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
    recursive: flags.recursive ?? flags.r ?? true,
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

// ── New subcommands (CLI-first agent mode) ────────────────────────────────

function fileWrite(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file write <path> --content "..."'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  const content = flags.content ?? '';
  if (!content && process.stdin.isTTY) {
    console.error(red('No content provided. Use --content "..." or pipe via stdin.'));
    process.exit(EXIT.ERROR);
  }

  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, size: content.length }, flags);
    return;
  }
  console.log(`${green('✔')} Wrote ${content.length} characters to ${cyan(filePath)}`);
}

function fileAppend(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file append <path> --content "..."'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (!existsSync(full)) {
    console.error(red(`File not found: ${filePath}`));
    process.exit(EXIT.ERROR);
  }
  const content = flags.content ?? '';
  if (!content) {
    console.error(red('No content provided. Use --content "..."'));
    process.exit(EXIT.ERROR);
  }

  const stat = statSync(full);
  let separator = '';
  if (stat.size > 0) {
    const readLen = Math.min(8, stat.size);
    const fd = openSync(full, 'r');
    try {
      const buf = Buffer.alloc(readLen);
      readSync(fd, buf, 0, readLen, Math.max(0, stat.size - readLen));
      const tail = buf.toString('utf-8');
      separator = tail.endsWith('\n') ? '' : '\n';
    } finally {
      closeSync(fd);
    }
  }
  appendFileSync(full, separator + content, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, appended: content.length }, flags);
    return;
  }
  console.log(`${green('✔')} Appended ${content.length} characters to ${cyan(filePath)}`);
}

function fileEditSection(root, filePath, flags) {
  const heading = flags.heading || flags.H;
  if (!filePath || !heading) {
    console.error(red('Usage: mindos file edit-section <path> -H "## Heading" --content "..."'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (!existsSync(full)) {
    console.error(red(`File not found: ${filePath}`));
    process.exit(EXIT.ERROR);
  }
  const content = flags.content ?? '';
  const original = readFileSync(full, 'utf-8');
  const result = replaceSection(original, heading, content);

  if (result === null) {
    const headings = listHeadings(original);
    console.error(red(`Heading "${heading}" not found in ${filePath}`));
    if (headings.length > 0) {
      console.error(dim('Available headings:'));
      for (const h of headings) console.error(dim(`  ${h}`));
    }
    process.exit(EXIT.ERROR);
  }

  writeFileSync(full, result, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, heading }, flags);
    return;
  }
  console.log(`${green('✔')} Updated section "${heading}" in ${cyan(filePath)}`);
}

function fileInsertHeading(root, filePath, flags) {
  const heading = flags.heading || flags.H;
  if (!filePath || !heading) {
    console.error(red('Usage: mindos file insert-heading <path> -H "## Heading" --content "..."'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  if (!existsSync(full)) {
    console.error(red(`File not found: ${filePath}`));
    process.exit(EXIT.ERROR);
  }
  const content = flags.content ?? '';
  const original = readFileSync(full, 'utf-8');
  const result = insertAfterHeading(original, heading, content);

  if (result === null) {
    const headings = listHeadings(original);
    console.error(red(`Heading "${heading}" not found in ${filePath}`));
    if (headings.length > 0) {
      console.error(dim('Available headings:'));
      for (const h of headings) console.error(dim(`  ${h}`));
    }
    process.exit(EXIT.ERROR);
  }

  writeFileSync(full, result, 'utf-8');

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, heading }, flags);
    return;
  }
  console.log(`${green('✔')} Inserted content after "${heading}" in ${cyan(filePath)}`);
}

function fileAppendCsv(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file append-csv <path> --row "val1,val2,val3"'));
    process.exit(EXIT.ERROR);
  }
  if (!filePath.endsWith('.csv')) {
    console.error(red('Only .csv files support row append'));
    process.exit(EXIT.ERROR);
  }
  const rowStr = flags.row;
  if (!rowStr) {
    console.error(red('No row provided. Use --row "val1,val2,val3"'));
    process.exit(EXIT.ERROR);
  }
  const full = resolvePath(root, filePath);
  let values;
  if (typeof rowStr === 'string' && rowStr.startsWith('[')) {
    try { values = JSON.parse(rowStr); } catch { values = rowStr.split(',').map(v => v.trim()); }
  } else {
    values = typeof rowStr === 'string' ? rowStr.split(',').map(v => v.trim()) : [String(rowStr)];
  }
  const line = escapeCsvRow(values) + '\n';

  mkdirSync(dirname(full), { recursive: true });

  let separator = '';
  if (existsSync(full)) {
    const stat = statSync(full);
    if (stat.size > 0) {
      const fd = openSync(full, 'r');
      try {
        const buf = Buffer.alloc(1);
        readSync(fd, buf, 0, 1, stat.size - 1);
        if (buf[0] !== 0x0a) separator = '\n';
      } finally {
        closeSync(fd);
      }
    }
  }
  appendFileSync(full, separator + line, 'utf-8');

  const content = readFileSync(full, 'utf-8');
  const newRowCount = content.trim().split('\n').length;

  if (isJsonMode(flags)) {
    output({ ok: true, path: filePath, newRowCount }, flags);
    return;
  }
  console.log(`${green('✔')} Appended row to ${cyan(filePath)} (${newRowCount} rows total)`);
}

function fileBacklinks(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file backlinks <path>'));
    process.exit(EXIT.ERROR);
  }
  resolvePath(root, filePath);

  const bname = basename(filePath, '.md');
  const escapedTarget = filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedBname = bname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\[\\[${escapedBname}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[\\[${escapedTarget}(?:[|#][^\\]]*)?\\]\\]`, 'i'),
    new RegExp(`\\[[^\\]]+\\]\\(${escapedTarget}(?:#[^)]*)?\\)`, 'i'),
  ];

  const results = [];
  const allFiles = walkFiles(root, root);
  for (const f of allFiles) {
    if (f.path === filePath) continue;
    if (!f.name.endsWith('.md')) continue;
    try {
      const content = readFileSync(resolve(root, f.path), 'utf-8');
      if (patterns.some(p => p.test(content))) {
        const lines = content.split('\n');
        let matchLine = 0;
        for (let i = 0; i < lines.length; i++) {
          if (patterns.some(p => p.test(lines[i]))) { matchLine = i + 1; break; }
        }
        results.push({ source: f.path, line: matchLine });
      }
    } catch { /* skip unreadable */ }
  }

  if (isJsonMode(flags)) {
    output({ path: filePath, count: results.length, backlinks: results }, flags);
    return;
  }

  if (results.length === 0) {
    console.log(dim(`No files reference "${filePath}"`));
    return;
  }
  console.log(`\n${bold(`Backlinks to "${filePath}" (${results.length}):`)}\n`);
  for (const r of results) {
    console.log(`  ${cyan(r.source)}  ${dim(`L${r.line}`)}`);
  }
  console.log();
}

function fileRecent(root, flags) {
  const limit = parseInt(flags.limit, 10) || 10;
  const allFiles = walkFiles(root, root);
  const withMtime = allFiles.map(f => {
    const stat = statSync(resolve(root, f.path));
    return { ...f, mtime: stat.mtimeMs, mtimeIso: stat.mtime.toISOString() };
  });
  withMtime.sort((a, b) => b.mtime - a.mtime);
  const recent = withMtime.slice(0, limit);

  if (isJsonMode(flags)) {
    output({ count: recent.length, files: recent.map(f => ({ path: f.path, mtime: f.mtimeIso })) }, flags);
    return;
  }

  if (recent.length === 0) {
    console.log(dim('No files found.'));
    return;
  }
  console.log(`\n${bold(`Recently modified (${recent.length}):`)}\n`);
  for (const f of recent) {
    const ago = formatTimeAgo(f.mtime);
    console.log(`  ${f.path}  ${dim(ago)}`);
  }
  console.log();
}

function fileHistory(root, filePath, flags) {
  if (!filePath) {
    console.error(red('Usage: mindos file history <path>'));
    process.exit(EXIT.ERROR);
  }
  resolvePath(root, filePath);
  const limit = parseInt(flags.limit, 10) || 10;
  const full = resolve(root, filePath);

  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'pipe' });
  } catch {
    console.error(red('Knowledge base is not a git repository.'));
    process.exit(EXIT.ERROR);
  }

  let gitOutput = '';
  try {
    gitOutput = execFileSync(
      'git',
      ['log', '--follow', '--format=%H%x00%aI%x00%s%x00%an', '-n', String(limit), '--', full],
      { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch { /* no commits or git error */ }

  const entries = gitOutput
    ? gitOutput.split('\n').map(line => {
        const [hash, date, message, author] = line.split('\0');
        return { hash, date, message, author };
      })
    : [];

  if (isJsonMode(flags)) {
    output({ path: filePath, count: entries.length, entries }, flags);
    return;
  }

  if (entries.length === 0) {
    console.log(dim(`No git history for "${filePath}"`));
    return;
  }
  console.log(`\n${bold(`Git history: ${filePath} (${entries.length}):`)}\n`);
  for (const e of entries) {
    console.log(`  ${dim(e.hash.slice(0, 8))}  ${e.date.slice(0, 10)}  ${e.message}  ${dim(e.author)}`);
  }
  console.log();
}

function formatTimeAgo(mtimeMs) {
  const diff = Date.now() - mtimeMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

// ── Remote mode: all operations via HTTP API ──────────────────────────────

async function remoteFileDispatch(sub, args, flags) {
  try {
    switch (sub) {
      case 'list':
      case 'ls': {
        const res = await apiCall('/api/files');
        const data = await res.json();
        if (isJsonMode(flags)) {
          output(data, flags);
          return;
        }
        // data is a tree; flatten for display
        const files = [];
        function walk(nodes, prefix = '') {
          for (const n of nodes || []) {
            const p = prefix ? `${prefix}/${n.name}` : n.name;
            if (n.type === 'file') files.push(p);
            if (n.children) walk(n.children, p);
          }
        }
        walk(data.tree || data);
        console.log(`\n${bold(`Files (${files.length}):`)}\n`);
        for (const f of files) console.log(`  ${f}`);
        console.log();
        return;
      }

      case 'read':
      case 'cat': {
        const filePath = args[1];
        if (!filePath) { console.error(red('Usage: mindos file read <path>')); process.exit(EXIT.ERROR); }
        const res = await apiCall(`/api/file?path=${encodeURIComponent(filePath)}&op=read_file`);
        const data = await res.json();
        if (isJsonMode(flags)) { output(data, flags); return; }
        console.log(data.content ?? '');
        return;
      }

      case 'create': {
        const filePath = args[1];
        if (!filePath) { console.error(red('Usage: mindos file create <path> --content "..."')); process.exit(EXIT.ERROR); }
        const content = flags.content || `# ${basename(filePath, '.md')}\n`;
        // --force → save_file (overwrite); default → create_file (fail if exists)
        const action = flags.force ? 'save_file' : 'create_file';
        const res = await apiCall('/api/file', {
          method: 'POST',
          body: JSON.stringify({ action, path: filePath, content }),
        });
        const data = await res.json();
        if (isJsonMode(flags)) { output(data, flags); return; }
        console.log(`${green('✔')} ${flags.force ? 'Saved' : 'Created'}: ${cyan(filePath)}`);
        return;
      }

      case 'delete':
      case 'rm': {
        const filePath = args[1];
        if (!filePath) { console.error(red('Usage: mindos file delete <path>')); process.exit(EXIT.ERROR); }
        const res = await apiCall('/api/file', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_file', path: filePath }),
        });
        await res.json();
        if (isJsonMode(flags)) { output({ ok: true, deleted: filePath }, flags); return; }
        console.log(`${green('✔')} Deleted: ${filePath}`);
        return;
      }

      case 'rename':
      case 'mv':
      case 'move': {
        const oldPath = args[1], newPath = args[2];
        if (!oldPath || !newPath) { console.error(red('Usage: mindos file rename <old> <new>')); process.exit(EXIT.ERROR); }
        const action = sub === 'move' ? 'move_file' : 'rename_file';
        const body = action === 'move_file'
          ? { action, path: oldPath, destination: newPath }
          : { action, path: oldPath, newName: newPath };
        const res = await apiCall('/api/file', { method: 'POST', body: JSON.stringify(body) });
        await res.json();
        if (isJsonMode(flags)) { output({ ok: true, from: oldPath, to: newPath }, flags); return; }
        console.log(`${green('✔')} ${sub === 'move' ? 'Moved' : 'Renamed'}: ${oldPath} → ${cyan(newPath)}`);
        return;
      }

      case 'search': {
        const query = args.slice(1).join(' ');
        if (!query) { console.error(red('Usage: mindos file search <query>')); process.exit(EXIT.ERROR); }
        const limit = flags.limit || 20;
        const res = await apiCall(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        const data = await res.json();
        if (isJsonMode(flags)) { output(data, flags); return; }
        const results = data.results || [];
        if (results.length === 0) { console.log(dim(`No results for "${query}"`)); return; }
        console.log(`\n${bold(`Search: "${query}"  (${results.length} files)`)}\n`);
        for (const r of results) {
          console.log(`  ${cyan(r.path || r.file)}`);
          for (const m of (r.matches || []).slice(0, 3)) {
            console.log(`    ${dim(`L${m.line}:`)} ${m.text || m.snippet || ''}`);
          }
        }
        console.log();
        return;
      }

      case 'write': case 'append': case 'edit-section': case 'insert-heading':
      case 'append-csv': case 'backlinks': case 'recent': case 'history': {
        const opMap = {
          'write': 'save_file', 'append': 'append_to_file',
          'edit-section': 'update_section', 'insert-heading': 'insert_after_heading',
          'append-csv': 'append_csv',
        };
        const op = opMap[sub];
        if (op) {
          const filePath = args[1];
          if (!filePath) { console.error(red(`Usage: mindos file ${sub} <path> ...`)); process.exit(EXIT.ERROR); }
          const body = { action: op, path: filePath };
          if (flags.content !== undefined) body.content = flags.content;
          if (flags.heading || flags.H) body.heading = flags.heading || flags.H;
          if (flags.row) body.row = typeof flags.row === 'string' ? flags.row.split(',').map(v => v.trim()) : [String(flags.row)];
          const res = await apiCall('/api/file', { method: 'POST', body: JSON.stringify(body) });
          const data = await res.json();
          if (isJsonMode(flags)) { output(data, flags); return; }
          console.log(`${green('✔')} ${sub} completed: ${cyan(filePath)}`);
          return;
        }
        // backlinks/recent/history — read-only, can delegate to specific API
        if (sub === 'backlinks') {
          const filePath = args[1];
          if (!filePath) { console.error(red('Usage: mindos file backlinks <path>')); process.exit(EXIT.ERROR); }
          const res = await apiCall(`/api/file?op=get_backlinks&path=${encodeURIComponent(filePath)}`);
          const data = await res.json();
          if (isJsonMode(flags)) { output(data, flags); return; }
          const links = data.backlinks || [];
          if (links.length === 0) { console.log(dim(`No files reference "${filePath}"`)); return; }
          console.log(`\n${bold(`Backlinks to "${filePath}" (${links.length}):`)}\n`);
          for (const r of links) console.log(`  ${cyan(r.source)}  ${dim(`L${r.line}`)}`);
          console.log();
          return;
        }
        if (sub === 'recent') {
          const limit = parseInt(flags.limit, 10) || 10;
          const res = await apiCall(`/api/recent-files?limit=${limit}`);
          const data = await res.json();
          if (isJsonMode(flags)) { output(data, flags); return; }
          const files = data.files || data || [];
          if (files.length === 0) { console.log(dim('No files found.')); return; }
          console.log(`\n${bold(`Recently modified (${files.length}):`)}\n`);
          for (const f of files) console.log(`  ${f.path}  ${dim(f.modifiedAt || '')}`);
          console.log();
          return;
        }
        if (sub === 'history') {
          const filePath = args[1];
          if (!filePath) { console.error(red('Usage: mindos file history <path>')); process.exit(EXIT.ERROR); }
          const limit = parseInt(flags.limit, 10) || 10;
          const res = await apiCall(`/api/git?action=log&path=${encodeURIComponent(filePath)}&limit=${limit}`);
          const data = await res.json();
          if (isJsonMode(flags)) { output(data, flags); return; }
          const entries = data.entries || data || [];
          if (entries.length === 0) { console.log(dim(`No git history for "${filePath}"`)); return; }
          console.log(`\n${bold(`Git history: ${filePath} (${entries.length}):`)}\n`);
          for (const e of entries) console.log(`  ${dim(e.hash?.slice(0, 8) || '')}  ${(e.date || '').slice(0, 10)}  ${e.message || ''}  ${dim(e.author || '')}`);
          console.log();
          return;
        }
        break;
      }

      default:
        console.error(red(`Unknown subcommand: ${sub}`));
        process.exit(EXIT.ERROR);
    }
  } catch (e) {
    console.error(red(`Remote error: ${e.message}`));
    process.exit(EXIT.ERROR);
  }
}
