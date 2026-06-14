import yaml from 'js-yaml';
import type { DataWriteOptions, IFileManager, TAbstractFile, TFile, TFolder } from '../types';
import type { AppShim } from './app';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  hadFrontmatter: boolean;
} {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content, hadFrontmatter: false };
  }

  const rawFrontmatter = match[1] ?? '';
  let parsed: unknown = {};
  try {
    parsed = rawFrontmatter.trim() ? yaml.load(rawFrontmatter) : {};
  } catch {
    parsed = {};
  }

  return {
    frontmatter: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {},
    body: content.slice(match[0].length),
    hadFrontmatter: true,
  };
}

function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string, hadFrontmatter: boolean): string {
  const keys = Object.keys(frontmatter);
  if (keys.length === 0) {
    return hadFrontmatter ? body.replace(/^\r?\n/, '') : body;
  }

  const frontmatterText = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }).trimEnd();
  return `---\n${frontmatterText}\n---\n${body}`;
}

function sanitizeWikiLinkPart(value: string): string {
  return value.replace(/\]\]/g, '').replace(/\|/g, '-').trim();
}

function normalizeVaultPath(input: string): string {
  const normalizedInput = input
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
  const parts: string[] = [];
  for (const part of normalizedInput.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function parentPathFor(sourcePath: string): string {
  const normalized = normalizeVaultPath(sourcePath);
  return normalized.includes('/') ? normalized.split('/').slice(0, -1).join('/') : '';
}

function sanitizeAttachmentFilename(filename: string): string {
  const parts = filename
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  const safePart = parts[parts.length - 1];
  return safePart?.trim() || 'attachment';
}

function splitFilename(filename: string): { base: string; extension: string } {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) {
    return { base: filename, extension: '' };
  }
  return {
    base: filename.slice(0, dotIndex),
    extension: filename.slice(dotIndex),
  };
}

export class FileManagerShim implements IFileManager {
  constructor(private readonly app: AppShim) {}

  async processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void | Promise<void>,
    options?: DataWriteOptions,
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const parsed = parseFrontmatter(content);
    await fn(parsed.frontmatter);
    await this.app.vault.modify(file, serializeFrontmatter(parsed.frontmatter, parsed.body, parsed.hadFrontmatter), options);
  }

  generateMarkdownLink(file: TFile, sourcePath: string, subpath?: string, alias?: string): string {
    void sourcePath;
    const linkPath = file.path.replace(/\.md$/i, '');
    const suffix = subpath ? sanitizeWikiLinkPart(subpath) : '';
    const target = `${sanitizeWikiLinkPart(linkPath)}${suffix}`;
    const label = alias ? `|${sanitizeWikiLinkPart(alias)}` : '';
    return `[[${target}${label}]]`;
  }

  getNewFileParent(sourcePath: string, _newFilePath?: string): TFolder {
    const parentPath = parentPathFor(sourcePath);
    return this.app.vault.getFolderByPath(parentPath) ?? this.app.vault.getRoot();
  }

  async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
    await this.app.vault.rename(file, newPath);
  }

  async promptForDeletion(_file: TAbstractFile): Promise<boolean> {
    return true;
  }

  async trashFile(file: TAbstractFile): Promise<void> {
    await this.app.vault.trash(file, true);
  }

  async getAvailablePathForAttachment(filename: string, sourcePath?: string): Promise<string> {
    const activeSourcePath = sourcePath ?? this.app.workspace.getActiveFile()?.path ?? '';
    const parentPath = parentPathFor(activeSourcePath);
    if (parentPath && !this.app.vault.getFolderByPath(parentPath)) {
      await this.app.vault.createFolder(parentPath);
    }

    const safeFilename = sanitizeAttachmentFilename(filename);
    const { base, extension } = splitFilename(safeFilename);
    let counter = 0;
    while (true) {
      const candidateName = counter === 0 ? safeFilename : `${base} ${counter}${extension}`;
      const candidatePath = parentPath ? `${parentPath}/${candidateName}` : candidateName;
      if (!await this.app.vault.adapter.exists(candidatePath)) {
        return candidatePath;
      }
      counter += 1;
    }
  }
}
