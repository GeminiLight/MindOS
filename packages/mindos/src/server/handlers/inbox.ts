import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, basename, join } from 'node:path';
import { resolveExistingSafe, resolveSafe } from '../../foundation/security/index.js';
import { json, type MindosServerResponse } from '../response.js';

export const INBOX_DIR = 'Inbox';
const PROCESSED_DIR = '.processed';
const AGING_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_IMPORT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf',
  '.doc', '.docx', '.docm',
]);

const INBOX_INSTRUCTION = `# Inbox Instruction Set

## Goal
This is the **Inbox** - a staging area for unprocessed files.
Files here are waiting to be organized into the right location in the knowledge base.

## Rules
- New files dropped here should be preserved as-is until the user triggers organization.
- When organizing, analyze file content and move each file to the most appropriate Space/directory.
- If a file belongs to an existing topic, merge or append rather than creating duplicates.
- After organizing, the Inbox should be empty or contain only files that don't fit anywhere.
- Never delete files from Inbox - always move them to a better location.

## Boundary
- Root INSTRUCTION.md rules take precedence.
- This INSTRUCTION.md only applies to the Inbox directory.
`;

const INBOX_README = `# Inbox

Quick capture staging area. Drop files here and organize them later with AI.

## Usage
- Drag files onto the MindOS window to save them here instantly.
- Click "AI Organize" on the homepage to sort everything into the right place.
`;

export type InboxHandlerServices = {
  mindRoot: string;
};

export interface InboxFileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging: boolean;
}

export interface InboxSaveInput {
  name: string;
  content: string;
  encoding?: 'text' | 'base64';
}

export interface InboxSaveResult {
  saved: Array<{ original: string; path: string }>;
  skipped: Array<{ name: string; reason: string }>;
  source?: string;
}

export interface InboxArchiveResult {
  archived: Array<{ original: string; archivedPath: string }>;
  notFound: string[];
}

export function handleInboxGet(
  services: InboxHandlerServices,
): MindosServerResponse<{ files: InboxFileInfo[] } | { error: string }> {
  if (!services.mindRoot.trim()) {
    return json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }
  try {
    ensureInboxSpace(services.mindRoot);
    return json({ files: listInboxFiles(services.mindRoot) });
  } catch (error) {
    return mapInboxError(error);
  }
}

export function handleInboxPost(
  body: unknown,
  services: InboxHandlerServices,
): MindosServerResponse<InboxSaveResult | { error: string }> {
  if (!services.mindRoot.trim()) {
    return json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { files?: unknown }).files)) {
    return json({ error: 'Request body must contain a files array' }, { status: 400 });
  }

  const { files, source } = body as { files: InboxSaveInput[]; source?: string };
  try {
    return json(saveToInbox(services.mindRoot, files, source));
  } catch (error) {
    return mapInboxError(error);
  }
}

export function handleInboxDelete(
  body: unknown,
  services: InboxHandlerServices,
): MindosServerResponse<InboxArchiveResult | { error: string }> {
  if (!services.mindRoot.trim()) {
    return json({ error: 'MIND_ROOT is not configured' }, { status: 400 });
  }

  const { names } = (body ?? {}) as { names?: unknown };
  if (!Array.isArray(names) || names.length === 0) {
    return json({ error: 'Request body must contain a non-empty names array' }, { status: 400 });
  }

  try {
    return json(archiveFromInbox(services.mindRoot, names.filter((name): name is string => typeof name === 'string')));
  } catch (error) {
    return mapInboxError(error);
  }
}

export function ensureInboxSpace(mindRoot: string): string {
  const inboxDir = resolveExistingSafe(mindRoot, INBOX_DIR);
  mkdirSync(inboxDir, { recursive: true });

  const instructionPath = join(inboxDir, 'INSTRUCTION.md');
  if (!existsSync(instructionPath)) {
    writeFileSync(instructionPath, INBOX_INSTRUCTION, 'utf-8');
  }

  const readmePath = join(inboxDir, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, INBOX_README, 'utf-8');
  }

  return inboxDir;
}

export function listInboxFiles(mindRoot: string): InboxFileInfo[] {
  const inboxDir = resolveExistingSafe(mindRoot, INBOX_DIR);
  if (!existsSync(inboxDir)) return [];

  const now = Date.now();
  const files: InboxFileInfo[] = [];
  for (const entry of readdirSync(inboxDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const lowerName = entry.name.toLowerCase();
    if (lowerName === 'instruction.md' || lowerName === 'readme.md') continue;
    if (entry.name.startsWith('.')) continue;

    const filePath = join(inboxDir, entry.name);
    try {
      const stat = statSync(filePath);
      files.push({
        name: entry.name,
        path: `${INBOX_DIR}/${entry.name}`,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isAging: now - stat.mtime.getTime() > AGING_THRESHOLD_MS,
      });
    } catch {
      // The file may have been deleted between readdir and stat.
    }
  }

  return files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

export function saveToInbox(mindRoot: string, files: InboxSaveInput[], source?: string): InboxSaveResult {
  const inboxDir = ensureInboxSpace(mindRoot);
  const saved: InboxSaveResult['saved'] = [];
  const skipped: InboxSaveResult['skipped'] = [];

  for (const file of files) {
    if (!file.name || typeof file.name !== 'string') {
      skipped.push({ name: file.name || '(empty)', reason: 'Invalid file name' });
      continue;
    }
    if (file.content == null || typeof file.content !== 'string') {
      skipped.push({ name: file.name, reason: 'Missing or invalid content' });
      continue;
    }

    const ext = extname(file.name).toLowerCase();
    if (!ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
      skipped.push({ name: file.name, reason: `Unsupported format: ${ext}` });
      continue;
    }

    try {
      const sanitized = sanitizeFileName(file.name);
      const raw = decodeContent(file.encoding, file.content);
      const converted = convertToMarkdown(sanitized, raw);
      const uniqueName = resolveUniqueName(inboxDir, converted.targetName);
      const targetPath = `${INBOX_DIR}/${uniqueName}`;
      resolveSafe(mindRoot, targetPath);
      writeFileSync(join(inboxDir, uniqueName), converted.content, 'utf-8');
      saved.push({ original: file.name, path: targetPath });
    } catch (error) {
      skipped.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { saved, skipped, source };
}

export function archiveFromInbox(mindRoot: string, names: string[]): InboxArchiveResult {
  const inboxDir = resolveExistingSafe(mindRoot, INBOX_DIR);
  const processedDir = resolveExistingSafe(mindRoot, `${INBOX_DIR}/${PROCESSED_DIR}`);
  mkdirSync(processedDir, { recursive: true });

  const archived: InboxArchiveResult['archived'] = [];
  const notFound: string[] = [];
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

  for (const name of names) {
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower === 'instruction.md' || lower === 'readme.md') continue;

    const baseName = basename(name);
    const srcPath = join(inboxDir, baseName);
    try {
      resolveSafe(mindRoot, `${INBOX_DIR}/${baseName}`);
      if (!existsSync(srcPath)) {
        notFound.push(name);
        continue;
      }
      const archivedName = `${ts}_${baseName}`;
      const archivedPath = `${INBOX_DIR}/${PROCESSED_DIR}/${archivedName}`;
      renameSync(srcPath, resolveExistingSafe(mindRoot, archivedPath));
      archived.push({
        original: name,
        archivedPath,
      });
    } catch {
      notFound.push(name);
    }
  }

  return { archived, notFound };
}

function mapInboxError(error: unknown): MindosServerResponse<{ error: string }> {
  const message = error instanceof Error ? error.message : String(error);
  if (/access denied|outside root|absolute paths/i.test(message)) {
    return json({ error: 'Access denied' }, { status: 403 });
  }
  return json({ error: message }, { status: 500 });
}

function decodeContent(encoding: string | undefined, content: string): string {
  return encoding === 'base64' ? decodeBase64Buffer(content).toString('utf-8') : content;
}

function decodeBase64Buffer(content: string): Buffer {
  const normalized = content.replace(/\s/g, '');
  if (
    normalized.length % 4 === 1 ||
    /[^A-Za-z0-9+/=]/.test(normalized) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error('Invalid base64 content');
  }
  return Buffer.from(normalized, 'base64');
}

function resolveUniqueName(inboxDir: string, targetName: string): string {
  let resolved = join(inboxDir, targetName);
  if (!existsSync(resolved)) return targetName;

  const ext = extname(targetName);
  const stem = ext ? targetName.slice(0, -ext.length) : targetName;
  let n = 1;
  while (existsSync(resolved)) {
    const candidate = `${stem}-${n}${ext}`;
    resolved = join(inboxDir, candidate);
    if (!existsSync(resolved)) return candidate;
    n++;
  }
  return targetName;
}

function sanitizeFileName(name: string): string {
  let base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  base = base.replace(/\.\./g, '').replace(/^\/+/, '');
  base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-');
  base = base.replace(/-{2,}/g, '-');
  base = base.replace(/^[-\s]+|[-\s]+$/g, '');
  base = base.replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(base)) base = `_${base}`;
  return base || 'imported-file';
}

function titleFromFileName(name: string): string {
  const ext = extname(name);
  const stem = (ext ? name.slice(0, -ext.length) : name).replace(/^\.+/, '');
  const words = stem.replace(/[-_]+/g, ' ').trim().split(/\s+/);
  if (words.length === 0 || (words.length === 1 && !words[0])) return 'Untitled';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function convertToMarkdown(fileName: string, rawContent: string): { content: string; targetName: string } {
  const ext = extname(fileName).toLowerCase();
  const stem = basename(fileName, ext) || 'note';
  const title = titleFromFileName(fileName);

  if (ext === '.md' || ext === '.markdown' || ext === '.csv' || ext === '.json') {
    return { content: rawContent, targetName: sanitizeFileName(fileName) };
  }

  if (ext === '.txt') {
    return { content: `# ${title}\n\n${rawContent}`, targetName: sanitizeFileName(`${stem}.md`) };
  }

  if (ext === '.yaml' || ext === '.yml') {
    return { content: `# ${title}\n\n\`\`\`yaml\n${rawContent}\n\`\`\`\n`, targetName: sanitizeFileName(`${stem}.md`) };
  }

  if (ext === '.html' || ext === '.htm') {
    return { content: `# ${title}\n\n${stripHtmlTags(rawContent)}\n`, targetName: sanitizeFileName(`${stem}.md`) };
  }

  if (ext === '.xml') {
    return { content: `# ${title}\n\n\`\`\`xml\n${rawContent}\n\`\`\`\n`, targetName: sanitizeFileName(`${stem}.md`) };
  }

  return { content: `# ${title}\n\n${rawContent}`, targetName: sanitizeFileName(`${stem}.md`) };
}
