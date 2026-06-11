import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, posix, relative, resolve } from 'node:path';
import { resolveExistingSafe, resolveSafe } from '../../foundation/security/index.js';
import { parsePermissionRules, type PermissionRule } from '../../foundation/permissions/index.js';
import {
  createKnowledgeOperationActor,
  deriveKnowledgeOperationSource,
  executeKnowledgeOperation,
  type ContentChangeSource,
  type KnowledgeChangeEvent,
  type KnowledgeOperationHandler,
} from '../../knowledge/knowledge-ops/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, type MindosServerResponse } from '../response.js';
import { isMindosBuiltinAssistantId } from './assistants.js';

export type FileGetHandlerServices = {
  mindRoot?: string;
  readTextFile(path: string): string;
  readLines(path: string): string[];
  listSpaces(): string[];
  listDirectories(): string[];
};

export type FilePostHandlerServices = {
  mindRoot: string;
};

export type FilePostHandlerOptions = {
  sourceHeader?: string | null;
  agentHeader?: string | null;
  permissionRules?: PermissionRule[];
  protectedRootFiles?: Iterable<string>;
};

export type FilePostResponse = MindosServerResponse<Record<string, unknown> | { error: string; requestId?: string; message?: string }> & {
  changeEvent?: KnowledgeChangeEvent | null;
  source?: ContentChangeSource;
  treeChanged?: boolean;
};

export function handleFileGet(
  query: MindosRequestQuery | undefined,
  services: FileGetHandlerServices,
): MindosServerResponse<unknown> {
  const op = queryValue(query, 'op') ?? 'read_file';

  if (op === 'list_spaces') return json({ spaces: services.mindRoot ? listDetailedSpaces(services.mindRoot) : services.listSpaces() });
  if (op === 'list_dirs') return json({ dirs: services.mindRoot ? listDirectories(services.mindRoot) : services.listDirectories() });
  if (op === 'check_conflicts') return handleCheckConflicts(query, services);

  const filePath = queryValue(query, 'path');
  if (!filePath) return json({ error: 'missing path' }, { status: 400 });

  try {
    if (op === 'read_lines') {
      return json({ lines: services.readLines(filePath) });
    }
    if (op === 'read_file') {
      return json({ content: services.readTextFile(filePath) });
    }
    return json({ error: `Unknown op: ${op}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|ENOENT/i.test(message)) return json({ error: 'File not found' }, { status: 404 });
    if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
    return json({ error: message }, { status: 500 });
  }
}

export async function handleFilePost(
  body: unknown,
  services: FilePostHandlerServices,
  options: FilePostHandlerOptions = {},
): Promise<FilePostResponse> {
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, { status: 400 });

  const payload = body as Record<string, unknown>;
  const source = deriveKnowledgeOperationSource({
    hasAgentHeader: Boolean(options.agentHeader),
    bodySource: payload.source,
    headerSource: options.sourceHeader,
  });

  try {
    const result = await executeKnowledgeOperation({
      body: payload,
      source,
      actor: createKnowledgeOperationActor(source, options.agentHeader),
      handlers: createFileOperationHandlers(services.mindRoot),
      permissionRules: options.permissionRules ?? parsePermissionRules(process.env.MINDOS_PERMISSION_RULES),
      protectedRootFiles: options.protectedRootFiles,
      responses: {
        badRequest: (message) => json({ error: message }, { status: 400 }),
        denied: (reason) => json({ error: reason }, { status: 403 }),
        permissionRequired: ({ op, path, reason, requestId }) => json({
          error: 'permission_required',
          requestId,
          message: `${reason} (${op} ${path})`,
        }, { status: 403 }),
      },
    });

    return attachOperationMetadata(result.response, result);
  } catch (error) {
    return mapFilePostError(error);
  }
}

function createFileOperationHandlers(mindRoot: string): Record<string, KnowledgeOperationHandler<MindosServerResponse> | undefined> {
  return {
    save_file: (filePath, params) => saveFile(mindRoot, filePath, params),
    create_file: (filePath, params) => createFile(mindRoot, filePath, params),
    append_to_file: (filePath, params) => appendToFile(mindRoot, filePath, params),
    insert_lines: (filePath, params) => insertLinesOperation(mindRoot, filePath, params),
    update_lines: (filePath, params) => updateLinesOperation(mindRoot, filePath, params),
    insert_after_heading: (filePath, params) => insertAfterHeadingOperation(mindRoot, filePath, params),
    update_section: (filePath, params) => updateSectionOperation(mindRoot, filePath, params),
    delete_file: (filePath) => deleteFile(mindRoot, filePath),
    rename_file: (filePath, params) => renameFile(mindRoot, filePath, params),
    move_file: (filePath, params) => moveFile(mindRoot, filePath, params),
    create_space: (_filePath, params) => createSpace(mindRoot, params),
    rename_space: (filePath, params) => renameSpace(mindRoot, filePath, params),
    append_csv: (filePath, params) => appendCsv(mindRoot, filePath, params),
  };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function attachOperationMetadata(
  response: MindosServerResponse,
  result: { changeEvent: KnowledgeChangeEvent | null; source: ContentChangeSource; treeChanged: boolean },
): FilePostResponse {
  return Object.assign(response, {
    changeEvent: result.changeEvent,
    source: result.source,
    treeChanged: result.treeChanged,
  }) as FilePostResponse;
}

function handleCheckConflicts(
  query: MindosRequestQuery | undefined,
  services: FileGetHandlerServices,
): MindosServerResponse<{ conflicts: string[] } | { error: string }> {
  const names = queryValue(query, 'names');
  if (!names) return json({ error: 'missing names' }, { status: 400 });
  if (!services.mindRoot) return json({ error: 'MIND_ROOT not configured' }, { status: 400 });

  try {
    const space = queryValue(query, 'space') ?? '';
    const conflicts: string[] = [];
    for (const originalName of names.split(',').map((name) => name.trim()).filter(Boolean)) {
      const targetName = markdownTargetName(sanitizeFileName(originalName));
      const rel = space ? posix.join(space, targetName) : targetName;
      if (existsSync(resolveExistingSafe(services.mindRoot, rel))) conflicts.push(originalName);
    }
    return json({ conflicts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
    return json({ error: message }, { status: 500 });
  }
}

function listDetailedSpaces(mindRoot: string): Array<{ name: string; path: string; fileCount: number; description: string }> {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const spacePath = entry.name;
      return {
        name: entry.name,
        path: spacePath,
        fileCount: countFiles(resolveExistingSafe(mindRoot, spacePath)),
        description: readSpaceDescription(mindRoot, spacePath),
      };
    })
    .filter((space) => space.fileCount > 0 || space.description)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function listDirectories(mindRoot: string): string[] {
  const root = resolve(mindRoot);
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = join(abs, entry.name);
      dirs.push(relative(root, child).split('\\').join('/'));
      walk(child);
    }
  };
  walk(root);
  return dirs.sort((a, b) => a.localeCompare(b));
}

function countFiles(absDir: string): number {
  let count = 0;
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else count++;
    }
  };
  walk(absDir);
  return count;
}

function readSpaceDescription(mindRoot: string, spacePath: string): string {
  try {
    const readme = readFileSync(resolveExistingSafe(mindRoot, posix.join(spacePath, 'README.md')), 'utf-8');
    return readme
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))[0] ?? '';
  } catch {
    return '';
  }
}

function sanitizeFileName(name: string): string {
  return basename(name).replace(/[<>:"|?*\x00-\x1f]/g, '_').trim();
}

function markdownTargetName(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === '.md' || ext === '.csv') return name;
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base || 'untitled'}.md`;
}

function relativeKnowledgePath(mindRoot: string, absPath: string): string {
  return relative(resolve(mindRoot), absPath).split('\\').join('/');
}

function existingKnowledgePath(mindRoot: string, filePath: string): string {
  return relativeKnowledgePath(mindRoot, resolveExistingSafe(mindRoot, filePath));
}

function isBuiltinAssistantPath(filePath: string): boolean {
  const normalized = filePath.split('\\').join('/').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[0] === '.mindos'
    && parts[1] === 'assistants'
    && typeof parts[2] === 'string'
    && isMindosBuiltinAssistantId(parts[2]);
}

function assertNotBuiltinAssistantDestructivePath(filePath: string, operation: string): void {
  if (!isBuiltinAssistantPath(filePath)) return;
  throw new Error(`Access denied: built-in Assistant "${filePath}" cannot be ${operation}`);
}

function saveFile(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const content = requireString(params.content, 'content');
  const abs = resolveExistingSafe(mindRoot, filePath);
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  if (typeof params.expectedMtime === 'number' && existsSync(abs) && statSync(abs).mtimeMs > params.expectedMtime) {
    return {
      response: json({ error: 'conflict', serverMtime: statSync(abs).mtimeMs } as unknown as { error: string }, { status: 409 }),
      changeEvent: null,
    };
  }
  const before = safeRead(mindRoot, filePath);
  atomicWriteFile(abs, content);
  return {
    response: json({ ok: true, path: normalizedPath, mtime: statSync(abs).mtimeMs }),
    changeEvent: { op: 'save_file', path: normalizedPath, summary: 'Updated file content', before, after: content },
  };
}

function createFile(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const content = readString(params.content, '');
  const abs = resolveExistingSafe(mindRoot, filePath);
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, { encoding: 'utf-8', flag: 'wx' });
  return {
    response: json({ ok: true, path: normalizedPath, mtime: statSync(abs).mtimeMs }),
    changeEvent: { op: 'create_file', path: normalizedPath, summary: 'Created file', before: '', after: content },
  };
}

function appendToFile(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const content = requireString(params.content, 'content');
  if (filePath === '.agent-log.json') {
    const entries = parseAgentAuditJsonLines(content);
    for (const entry of entries) appendAgentAuditEvent(mindRoot, entry);
    return { response: json({ ok: true, path: filePath }), changeEvent: null };
  }
  const before = safeRead(mindRoot, filePath);
  const abs = resolveExistingSafe(mindRoot, filePath);
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, appendSeparator(abs) + content, 'utf-8');
  return {
    response: json({ ok: true, path: normalizedPath, mtime: statSync(abs).mtimeMs }),
    changeEvent: { op: 'append_to_file', path: normalizedPath, summary: 'Appended content to file', before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function insertLinesOperation(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const afterIndex = requireNumber(params.after_index, 'after_index');
  const lines = requireStringArray(params.lines, 'lines');
  const before = safeRead(mindRoot, filePath);
  const existing = readLines(mindRoot, filePath);
  const normalizedPath = existingKnowledgePath(mindRoot, filePath);
  if (afterIndex >= existing.length) throw new Error(`Invalid after_index: ${afterIndex} >= total lines (${existing.length})`);
  existing.splice(afterIndex < 0 ? 0 : afterIndex + 1, 0, ...lines);
  writeText(mindRoot, normalizedPath, existing.join('\n'));
  return {
    response: json({ ok: true, path: normalizedPath }),
    changeEvent: { op: 'insert_lines', path: normalizedPath, summary: `Inserted ${lines.length} line(s)`, before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function updateLinesOperation(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const start = requireNumber(params.start, 'start');
  const end = requireNumber(params.end, 'end');
  const lines = requireStringArray(params.lines, 'lines');
  if (start < 0 || end < 0) throw new Error('start/end must be >= 0');
  if (start > end) throw new Error('start must be <= end');
  const before = safeRead(mindRoot, filePath);
  const existing = readLines(mindRoot, filePath);
  const normalizedPath = existingKnowledgePath(mindRoot, filePath);
  if (start >= existing.length) throw new Error(`Invalid line index: start (${start}) >= total lines (${existing.length})`);
  existing.splice(start, end - start + 1, ...lines);
  writeText(mindRoot, normalizedPath, existing.join('\n'));
  return {
    response: json({ ok: true, path: normalizedPath }),
    changeEvent: { op: 'update_lines', path: normalizedPath, summary: `Updated lines ${start}-${end}`, before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function insertAfterHeadingOperation(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const heading = requireString(params.heading, 'heading');
  const content = requireString(params.content, 'content');
  const before = safeRead(mindRoot, filePath);
  const lines = readLines(mindRoot, filePath);
  const normalizedPath = existingKnowledgePath(mindRoot, filePath);
  const idx = findHeading(lines, heading);
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);
  let insertAt = idx + 1;
  while (insertAt < lines.length && (lines[insertAt] ?? '').trim() === '') insertAt++;
  lines.splice(insertAt, 0, '', content);
  writeText(mindRoot, normalizedPath, lines.join('\n'));
  return {
    response: json({ ok: true, path: normalizedPath }),
    changeEvent: { op: 'insert_after_heading', path: normalizedPath, summary: `Inserted content after heading "${heading}"`, before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function updateSectionOperation(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const heading = requireString(params.heading, 'heading');
  const content = requireString(params.content, 'content');
  const before = safeRead(mindRoot, filePath);
  const lines = readLines(mindRoot, filePath);
  const normalizedPath = existingKnowledgePath(mindRoot, filePath);
  const idx = findHeading(lines, heading);
  if (idx === -1) throw new Error(`Heading not found: "${heading}"`);
  const headingLine = lines[idx] ?? '';
  const headingLevel = (headingLine.match(/^#+/) ?? [''])[0].length;
  let sectionEnd = lines.length - 1;
  for (let i = idx + 1; i < lines.length; i++) {
    const match = /^(#+)\s/.exec(lines[i] ?? '');
    const level = match?.[1]?.length ?? Number.POSITIVE_INFINITY;
    if (level <= headingLevel) {
      sectionEnd = i - 1;
      break;
    }
  }
  while (sectionEnd > idx && (lines[sectionEnd] ?? '').trim() === '') sectionEnd--;
  lines.splice(idx + 1, sectionEnd - idx, '', content);
  writeText(mindRoot, normalizedPath, lines.join('\n'));
  return {
    response: json({ ok: true, path: normalizedPath }),
    changeEvent: { op: 'update_section', path: normalizedPath, summary: `Updated section "${heading}"`, before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function deleteFile(mindRoot: string, filePath: string) {
  if (!filePath.includes('/') && basename(filePath) === 'TODO.md') {
    return { response: json({ error: `"${filePath}" is a protected file and cannot be deleted` }, { status: 403 }), changeEvent: null };
  }
  const abs = resolveExistingSafe(mindRoot, filePath);
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  assertNotBuiltinAssistantDestructivePath(normalizedPath, 'deleted');
  const before = safeRead(mindRoot, filePath);
  const trash = moveToTrash(mindRoot, normalizedPath);
  return {
    response: json({ ok: true, path: normalizedPath, trashId: trash.id }),
    changeEvent: { op: 'delete_file', path: normalizedPath, summary: 'Moved to trash', before, after: '' },
  };
}

function renameFile(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const newName = requireString(params.new_name, 'new_name');
  validateLeafName(newName, 'filename');
  const oldAbs = resolveExistingSafe(mindRoot, filePath);
  const oldPath = relativeKnowledgePath(mindRoot, oldAbs);
  assertNotBuiltinAssistantDestructivePath(oldPath, 'renamed');
  const newRelPath = posix.join(posix.dirname(oldPath), newName);
  const newAbs = resolveSafe(mindRoot, newRelPath);
  assertNotBuiltinAssistantDestructivePath(newRelPath, 'renamed into');
  if (dirname(newAbs) !== dirname(oldAbs)) throw new Error('Invalid filename: must stay in the same directory');
  if (existsSync(newAbs)) throw new Error('A file with that name already exists');
  const before = safeRead(mindRoot, filePath);
  renameSync(oldAbs, newAbs);
  const newPath = relativeKnowledgePath(mindRoot, newAbs);
  return {
    response: json({ ok: true, newPath }),
    changeEvent: { op: 'rename_file', path: newPath, summary: `Renamed file to ${newName}`, before, after: safeRead(mindRoot, newPath), beforePath: oldPath, afterPath: newPath },
  };
}

function moveFile(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const toPath = requireString(params.to_path ?? params.toPath ?? params.newPath, 'to_path');
  const before = safeRead(mindRoot, filePath);
  const fromAbs = resolveExistingSafe(mindRoot, filePath);
  const toAbs = resolveExistingSafe(mindRoot, toPath);
  const fromPath = relativeKnowledgePath(mindRoot, fromAbs);
  const normalizedToPath = relativeKnowledgePath(mindRoot, toAbs);
  assertNotBuiltinAssistantDestructivePath(fromPath, 'moved');
  assertNotBuiltinAssistantDestructivePath(normalizedToPath, 'moved into');
  if (existsSync(toAbs)) throw new Error(`Destination already exists: ${toPath}`);
  mkdirSync(dirname(toAbs), { recursive: true });
  renameSync(fromAbs, toAbs);
  return {
    response: json({ ok: true, path: normalizedToPath, newPath: normalizedToPath, affectedFiles: [] }),
    changeEvent: { op: 'move_file', path: normalizedToPath, summary: `Moved file to ${normalizedToPath}`, before, after: safeRead(mindRoot, normalizedToPath), beforePath: fromPath, afterPath: normalizedToPath },
  };
}

function createSpace(mindRoot: string, params: Record<string, unknown>) {
  const name = requireString(params.name, 'name').trim();
  validateLeafName(name, 'name');
  const parent = typeof params.parent_path === 'string' && params.parent_path.trim() ? params.parent_path.trim() : '';
  const spacePath = parent ? posix.join(parent, name) : name;
  const abs = resolveExistingSafe(mindRoot, spacePath);
  if (existsSync(abs)) throw new Error('Space already exists');
  mkdirSync(abs, { recursive: true });
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  const description = readString(params.description, '');
  writeFileSync(join(abs, 'INSTRUCTION.md'), `# ${name}\n\n${description}\n`, 'utf-8');
  writeFileSync(join(abs, 'README.md'), `# ${name}\n\n${description}\n`, 'utf-8');
  return {
    response: json({ ok: true, path: normalizedPath }),
    changeEvent: { op: 'create_space', path: normalizedPath, summary: 'Created space', before: '', after: description },
  };
}

function renameSpace(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const newName = requireString(params.new_name, 'new_name').trim();
  validateLeafName(newName, 'space name');
  const oldAbs = resolveExistingSafe(mindRoot, filePath);
  if (!statSync(oldAbs).isDirectory()) throw new Error(`Not a directory: ${filePath}`);
  const oldPath = relativeKnowledgePath(mindRoot, oldAbs);
  assertNotBuiltinAssistantDestructivePath(oldPath, 'renamed');
  const newRelPath = posix.join(posix.dirname(oldPath), newName);
  const newAbs = resolveSafe(mindRoot, newRelPath);
  assertNotBuiltinAssistantDestructivePath(newRelPath, 'renamed into');
  if (dirname(newAbs) !== dirname(oldAbs)) throw new Error('Invalid space name: must stay in the same directory');
  if (existsSync(newAbs)) throw new Error('A space with that name already exists');
  renameSync(oldAbs, newAbs);
  const newPath = relativeKnowledgePath(mindRoot, newAbs);
  return {
    response: json({ ok: true, newPath }),
    changeEvent: { op: 'rename_space', path: newPath, summary: `Renamed space to ${newName}`, beforePath: oldPath, afterPath: newPath },
  };
}

function validateLeafName(name: string, label: string): void {
  if (!name) throw new Error(`missing or empty ${label}`);
  if (name === '.' || name === '..') throw new Error(`Invalid ${label}: must not be "." or ".."`);
  if (name.includes('/') || name.includes('\\')) throw new Error(`Invalid ${label}: must not contain path separators`);
}

function appendCsv(mindRoot: string, filePath: string, params: Record<string, unknown>) {
  const row = requireStringArray(params.row, 'row');
  if (row.length === 0) throw new Error('row must be non-empty array');
  if (!filePath.endsWith('.csv')) throw new Error('Only .csv files support row append');
  const before = safeRead(mindRoot, filePath);
  const escaped = row.map((cell) => cell.includes(',') || cell.includes('"') || cell.includes('\n') ? `"${cell.replace(/"/g, '""')}"` : cell);
  const abs = resolveExistingSafe(mindRoot, filePath);
  const normalizedPath = relativeKnowledgePath(mindRoot, abs);
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, `${escaped.join(',')}\n`, 'utf-8');
  const newRowCount = readFileSync(abs, 'utf-8').trim().split('\n').filter(Boolean).length;
  return {
    response: json({ ok: true, path: normalizedPath, newRowCount }),
    changeEvent: { op: 'append_csv', path: normalizedPath, summary: `Appended CSV row (${row.length} cell${row.length === 1 ? '' : 's'})`, before, after: safeRead(mindRoot, normalizedPath) },
  };
}

function atomicWriteFile(absPath: string, content: string): void {
  const dir = dirname(absPath);
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, absPath);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
    throw error;
  }
}

function readLines(mindRoot: string, filePath: string): string[] {
  return readFileSync(resolveExistingSafe(mindRoot, filePath), 'utf-8').split('\n');
}

function writeText(mindRoot: string, filePath: string, content: string): void {
  atomicWriteFile(resolveExistingSafe(mindRoot, filePath), content);
}

function safeRead(mindRoot: string, filePath: string): string {
  try {
    return readFileSync(resolveExistingSafe(mindRoot, filePath), 'utf-8');
  } catch {
    return '';
  }
}

function appendSeparator(absPath: string): string {
  if (!existsSync(absPath) || statSync(absPath).size === 0) return '';
  const content = readFileSync(absPath, 'utf-8');
  return content.endsWith('\n\n') ? '' : '\n';
}

function findHeading(lines: string[], heading: string): number {
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed === heading || trimmed.replace(/^#+\s*/, '') === heading.replace(/^#+\s*/, '');
  });
}

type TrashMeta = { id: string; originalPath: string; deletedAt: string; expiresAt: string; fileName: string; isDirectory: boolean };

function moveToTrash(mindRoot: string, filePath: string): TrashMeta {
  const src = resolveExistingSafe(mindRoot, filePath);
  if (!existsSync(src)) throw new Error(`File not found: ${filePath}`);
  const isDirectory = statSync(src).isDirectory();
  const id = `${Date.now()}_${basename(filePath).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')}`;
  const trashDir = resolveSafeSiblingDir(mindRoot, '.trash');
  const metaDir = resolveSafeSiblingDir(mindRoot, '.trash-meta');
  mkdirSync(trashDir, { recursive: true });
  mkdirSync(metaDir, { recursive: true });
  const dest = join(trashDir, id);
  try {
    renameSync(src, dest);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : undefined;
    if (code !== 'EXDEV') throw error;
    if (isDirectory) {
      cpSync(src, dest, { recursive: true });
      rmSync(src, { recursive: true, force: true });
    } else {
      copyFileSync(src, dest);
      unlinkSync(src);
    }
  }
  const now = new Date();
  const meta = {
    id,
    originalPath: filePath,
    deletedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    fileName: basename(filePath),
    isDirectory,
  };
  writeFileSync(join(metaDir, `${id}.json`), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

function resolveSafeSiblingDir(mindRoot: string, name: string): string {
  if (!name || name.includes('/') || name.includes('\\') || basename(name) !== name) {
    throw new Error('Invalid sibling directory name');
  }

  const parent = resolve(dirname(mindRoot));
  const target = resolve(parent, name);
  const relativeToParent = relative(parent, target);
  if (relativeToParent === '..' || relativeToParent.startsWith('..') || resolve(relativeToParent) === relativeToParent) {
    throw new Error('Access denied: sibling directory outside root parent');
  }

  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink()) {
      throw new Error('Access denied: sibling directory must not be a symlink');
    }
    const parentReal = realpathSync(parent);
    const targetReal = realpathSync(target);
    const realRelative = relative(parentReal, targetReal);
    if (realRelative === '..' || realRelative.startsWith('..') || resolve(realRelative) === realRelative) {
      throw new Error('Access denied: sibling directory outside root parent');
    }
  }

  return target;
}

type AgentAuditInput = {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
};

function parseAgentAuditJsonLines(raw: string): AgentAuditInput[] {
  const entries: AgentAuditInput[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({
        ts: typeof parsed.ts === 'string' ? parsed.ts : new Date().toISOString(),
        tool: typeof parsed.tool === 'string' && parsed.tool.trim() ? parsed.tool : 'unknown-tool',
        params: parsed.params && typeof parsed.params === 'object' ? parsed.params as Record<string, unknown> : {},
        result: parsed.result === 'error' ? 'error' : 'ok',
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
        agentName: typeof parsed.agentName === 'string' ? parsed.agentName : undefined,
      });
    } catch {
      // Ignore malformed legacy lines.
    }
  }
  return entries;
}

function appendAgentAuditEvent(mindRoot: string, input: AgentAuditInput): void {
  const file = resolveExistingSafe(mindRoot, '.mindos/agent-audit-log.json');
  let state: { version: 1; events: Array<Record<string, unknown>> } = { version: 1, events: [] };
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8')) as typeof state;
      if (Array.isArray(parsed.events)) state = { version: 1, events: parsed.events };
    }
  } catch {
    state = { version: 1, events: [] };
  }
  state.events.unshift({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
    op: 'append',
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`missing ${field}`);
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`missing ${field}`);
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be array`);
  if (!value.every((item) => typeof item === 'string')) throw new Error(`${field} must be array`);
  return value;
}

function mapFilePostError(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error);
  if (/missing |must be|Invalid |Heading not found|row must|Only \.csv|start|after_index|line index|not a directory/i.test(message)) return json({ error: message }, { status: 400 });
  if (/EEXIST|already exists/i.test(message)) return json({ error: 'File already exists' }, { status: 409 });
  if (/ENOENT|not found/i.test(message)) return json({ error: 'File not found' }, { status: 404 });
  if (/access denied|outside root|absolute paths/i.test(message)) return json({ error: 'Access denied' }, { status: 403 });
  return json({ error: message }, { status: 500 });
}
