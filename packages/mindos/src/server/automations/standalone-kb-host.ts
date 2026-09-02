import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, posix, relative } from 'node:path';
import {
  resolveExistingSafe,
  resolveSafe,
} from '../../foundation/security/index.js';
import {
  collectAllFilesFromMindRoot,
  getRecentlyModifiedFromMindRoot,
  getSkillRootsFromRuntime,
  searchMindRoot,
  type MindosRuntimeSettings,
} from '../runtime.js';
import {
  createMindosKbToolkit,
  type MindosKbFileTreeNode,
  type MindosKbToolsHost,
} from '../../agent/tool/kb-tools.js';

export function createStandaloneAutomationKbHost(input: {
  mindRoot: string;
  settings: MindosRuntimeSettings;
  runtimeRoot?: string;
  homeDir?: string;
}): MindosKbToolsHost {
  const { mindRoot } = input;
  const normalize = (absolute: string) => relative(mindRoot, absolute).split('\\').join('/');
  return {
    files: {
      getMindRoot: () => mindRoot,
      getFileTree: () => buildFileTree(collectAllFilesFromMindRoot(mindRoot)),
      getFileContent: (filePath) => readFileSync(resolveExistingSafe(mindRoot, filePath), 'utf-8'),
      getRecentlyModified: (limit) => getRecentlyModifiedFromMindRoot(mindRoot, limit),
      saveFileContent: (filePath, content) => writeText(mindRoot, filePath, content),
      createFile: (filePath, content) => {
        const absolute = resolveExistingSafe(mindRoot, filePath);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, { encoding: 'utf-8', flag: 'wx' });
      },
      appendToFile: (filePath, content) => {
        const absolute = resolveExistingSafe(mindRoot, filePath);
        mkdirSync(dirname(absolute), { recursive: true });
        appendFileSync(absolute, `${appendSeparator(absolute)}${content}`, 'utf-8');
      },
      insertAfterHeading: (filePath, heading, content) => {
        const lines = readLines(mindRoot, filePath);
        const index = findHeading(lines, heading);
        if (index < 0) throw new Error(`Heading not found: ${heading}`);
        lines.splice(index + 1, 0, '', content);
        writeText(mindRoot, filePath, lines.join('\n'));
      },
      updateSection: (filePath, heading, content) => {
        const lines = readLines(mindRoot, filePath);
        const index = findHeading(lines, heading);
        if (index < 0) throw new Error(`Heading not found: ${heading}`);
        const level = (lines[index]?.match(/^#+/)?.[0].length ?? 0);
        let end = lines.length;
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
          const nextLevel = lines[cursor]?.match(/^(#+)\s/)?.[1]?.length;
          if (nextLevel && nextLevel <= level) { end = cursor; break; }
        }
        lines.splice(index + 1, end - index - 1, '', content, '');
        writeText(mindRoot, filePath, lines.join('\n'));
      },
      updateLines: (_root, filePath, startIndex, endIndex, lines) => {
        const current = readLines(mindRoot, filePath);
        if (startIndex < 0 || endIndex < startIndex || startIndex >= current.length) throw new Error('Invalid line range.');
        current.splice(startIndex, endIndex - startIndex + 1, ...lines);
        writeText(mindRoot, filePath, current.join('\n'));
      },
      moveToTrashFile: (filePath) => {
        const source = resolveExistingSafe(mindRoot, filePath);
        const id = `trash-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
        const target = resolveExistingSafe(mindRoot, `.mindos/trash/${id}-${basename(filePath)}`);
        mkdirSync(dirname(target), { recursive: true });
        renameSync(source, target);
        return { id };
      },
      renameFile: (filePath, newName) => {
        assertLeafName(newName);
        const source = resolveExistingSafe(mindRoot, filePath);
        const targetRelative = posix.join(posix.dirname(filePath.split('\\').join('/')), newName);
        const target = resolveExistingSafe(mindRoot, targetRelative);
        if (existsSync(target)) throw new Error(`Destination already exists: ${targetRelative}`);
        renameSync(source, target);
        return normalize(target);
      },
      moveFile: (fromPath, toPath) => {
        const source = resolveExistingSafe(mindRoot, fromPath);
        const target = resolveExistingSafe(mindRoot, toPath);
        if (existsSync(target)) throw new Error(`Destination already exists: ${toPath}`);
        mkdirSync(dirname(target), { recursive: true });
        renameSync(source, target);
        return { newPath: normalize(target), affectedFiles: [] };
      },
      findBacklinks: (filePath) => findBacklinks(mindRoot, filePath),
      gitLog: (filePath, limit) => gitLog(mindRoot, filePath, limit),
      gitShowFile: (filePath, commit) => execFileSync('git', ['show', `${commit}:${filePath}`], { cwd: mindRoot, encoding: 'utf-8' }),
      appendCsvRow: (filePath, row) => appendCsvRow(mindRoot, filePath, row),
    },
    hybridSearch: async (_root, query) => searchMindRoot(mindRoot, query, { limit: 30 }),
    readSkillContent: (name) => readSkillContent(name, input),
  };
}

export function createStandaloneAutomationKbToolkit(input: {
  mindRoot: string;
  settings: MindosRuntimeSettings;
  runtimeRoot?: string;
  homeDir?: string;
}) {
  return createMindosKbToolkit(createStandaloneAutomationKbHost(input));
}

function buildFileTree(files: string[]): MindosKbFileTreeNode[] {
  const root: MindosKbFileTreeNode[] = [];
  for (const filePath of files) {
    const parts = filePath.split('/').filter(Boolean);
    let level = root;
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index]!;
      const isFile = index === parts.length - 1;
      let node = level.find((entry) => entry.name === name);
      if (!node) {
        node = { name, type: isFile ? 'file' : 'directory', ...(isFile ? {} : { children: [] }) };
        level.push(node);
      }
      if (!isFile) level = node.children ?? (node.children = []);
    }
  }
  return root;
}

function writeText(mindRoot: string, filePath: string, content: string): void {
  const absolute = resolveExistingSafe(mindRoot, filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = resolveSafe(mindRoot, `${filePath}.automation-${process.pid}.tmp`);
  writeFileSync(temporary, content, { encoding: 'utf-8', mode: 0o600 });
  renameSync(temporary, absolute);
}

function readLines(mindRoot: string, filePath: string): string[] {
  return readFileSync(resolveExistingSafe(mindRoot, filePath), 'utf-8').split(/\r?\n/);
}

function findHeading(lines: string[], heading: string): number {
  const target = heading.replace(/^#+\s*/, '').trim();
  return lines.findIndex((line) => line.replace(/^#+\s*/, '').trim() === target);
}

function appendSeparator(absolute: string): string {
  if (!existsSync(absolute) || statSync(absolute).size === 0) return '';
  return readFileSync(absolute, 'utf-8').endsWith('\n') ? '' : '\n';
}

function assertLeafName(value: string): void {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error('Invalid file name.');
  }
}

function findBacklinks(mindRoot: string, filePath: string): Array<{ source: string; line: number; context: string }> {
  const stem = basename(filePath).replace(/\.[^.]+$/, '');
  const patterns = [`[[${filePath}`, `[[${stem}`];
  const results: Array<{ source: string; line: number; context: string }> = [];
  for (const source of collectAllFilesFromMindRoot(mindRoot)) {
    if (!source.endsWith('.md')) continue;
    const lines = readFileSync(resolveExistingSafe(mindRoot, source), 'utf-8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => line.includes(pattern))) results.push({ source, line: index + 1, context: line.slice(0, 300) });
    });
  }
  return results.slice(0, 200);
}

function gitLog(mindRoot: string, filePath: string, limit: number) {
  const output = execFileSync('git', ['log', `-n${Math.max(1, Math.min(limit, 50))}`, '--format=%H%x00%aI%x00%s%x00%an', '--', filePath], {
    cwd: mindRoot,
    encoding: 'utf-8',
  }).trim();
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [hash = '', date = '', message = '', author = ''] = line.split('\0');
    return { hash, date, message, author };
  });
}

function appendCsvRow(mindRoot: string, filePath: string, row: string[]): { newRowCount: number } {
  if (!filePath.toLowerCase().endsWith('.csv')) throw new Error('CSV row append requires a .csv file.');
  const absolute = resolveExistingSafe(mindRoot, filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const encoded = row.map((cell) => /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',');
  appendFileSync(absolute, `${appendSeparator(absolute)}${encoded}\n`, 'utf-8');
  const newRowCount = readFileSync(absolute, 'utf-8').split(/\r?\n/).filter(Boolean).length;
  return { newRowCount };
}

function readSkillContent(
  name: string,
  input: { mindRoot: string; settings: MindosRuntimeSettings; runtimeRoot?: string; homeDir?: string },
): string | null {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(name)) return null;
  for (const root of getSkillRootsFromRuntime(input)) {
    if (!existsSync(root.path)) continue;
    const file = resolveExistingSafe(root.path, `${name}/SKILL.md`);
    if (existsSync(file)) return readFileSync(file, 'utf-8');
  }
  return null;
}
