import type { FileNode } from '@/lib/types';

export interface FilesBannerState {
  title: string;
  message: string;
  showRetry: boolean;
}

export interface FilesTabViewState {
  showEmptyState: boolean;
  banner: FilesBannerState | null;
  tree: FileNode[];
}

export type FileNameNormalizationResult =
  | { ok: true; fileName: string; title: string }
  | { ok: false; message: string };

const FALLBACK_FILES_ERROR_MESSAGE = 'Unable to load files right now';
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);
const WINDOWS_INVALID_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*']);

export const getFilesErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return FALLBACK_FILES_ERROR_MESSAGE;
};

export const getFilesTabViewState = (tree: FileNode[], error: unknown): FilesTabViewState => {
  const hasError = Boolean(error);
  return {
    tree,
    showEmptyState: tree.length === 0 && !hasError,
    banner: hasError
      ? {
          title: 'Files are temporarily unavailable',
          message: getFilesErrorMessage(error),
          showRetry: true,
        }
      : null,
  };
};

export const getRenameInputDefaultValue = (fileName: string): string => fileName.replace(/\.md$/, '');

export function normalizeNewMarkdownFileName(input: string): FileNameNormalizationResult {
  const rawName = input.trim();
  if (!rawName) return { ok: false, message: 'Enter a file name.' };
  const rawInvalid = validateSingleFileName(rawName);
  if (rawInvalid) return { ok: false, message: rawInvalid };
  const fileName = /\.md$/i.test(rawName) ? rawName : `${rawName}.md`;
  const invalid = validateSingleFileName(fileName);
  if (invalid) return { ok: false, message: invalid };
  return {
    ok: true,
    fileName,
    title: fileName.replace(/\.md$/i, ''),
  };
}

export function normalizeRenameTarget(originalName: string, input: string): FileNameNormalizationResult {
  const rawName = input.trim();
  if (!rawName) return { ok: false, message: 'Enter a new file name.' };
  const rawInvalid = validateSingleFileName(rawName);
  if (rawInvalid) return { ok: false, message: rawInvalid };
  const shouldPreserveMarkdown = /\.md$/i.test(originalName) && !hasExtension(rawName);
  const fileName = shouldPreserveMarkdown ? `${rawName}.md` : rawName;
  const invalid = validateSingleFileName(fileName);
  if (invalid) return { ok: false, message: invalid };
  return {
    ok: true,
    fileName,
    title: fileName.replace(/\.[^/.]+$/, ''),
  };
}

function hasExtension(fileName: string): boolean {
  const lastSlash = Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\'));
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > lastSlash && lastDot > 0 && lastDot < fileName.length - 1;
}

function validateSingleFileName(fileName: string): string | null {
  if (fileName === '.' || fileName === '..') return 'File name cannot be "." or "..".';
  if (fileName.includes('/') || fileName.includes('\\')) return 'File name cannot contain path separators.';
  if (hasInvalidPortableCharacter(fileName)) return 'File name contains characters that are not portable.';
  if (/[ .]$/.test(fileName)) return 'File name cannot end with a space or dot.';

  const baseName = fileName.split('.')[0]?.toUpperCase() ?? '';
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    return `"${baseName}" is reserved on Windows. Choose another name.`;
  }

  return null;
}

function hasInvalidPortableCharacter(fileName: string): boolean {
  for (let index = 0; index < fileName.length; index += 1) {
    const char = fileName[index];
    if (char && WINDOWS_INVALID_CHARS.has(char)) return true;
    if (fileName.charCodeAt(index) < 32) return true;
  }
  return false;
}
