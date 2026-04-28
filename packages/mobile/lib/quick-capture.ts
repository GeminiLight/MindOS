/**
 * Quick Capture - domain logic for appending quick notes to the daily inbox.
 */

import { ApiError, mindosClient } from '@/lib/api-client';

export class QuickCaptureReadError extends Error {
  constructor(message = "Failed to read today's inbox. Please retry.") {
    super(message);
    this.name = 'QuickCaptureReadError';
  }
}

export interface QuickCaptureOptions {
  basePath?: string;
  /** Date used for inbox file path (defaults to now) */
  pathDate?: Date;
  /** Date used for timestamp in note content (defaults to now, separate from pathDate) */
  contentDate?: Date;
}

export interface QuickCaptureSaveResult {
  inboxPath: string;
  content: string;
}

export function buildInboxPath(basePath = 'inbox', date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${basePath}/${year}-${month}-${day}.md`;
}

export function isValidCapture(text: string): boolean {
  return text.trim().length > 0;
}

export function formatCaptureContent(text: string, date = new Date()): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `[${hours}:${minutes}] ${trimmed}`;
}

export function appendCaptureToContent(
  existingContent: string,
  captureText: string,
  date = new Date(),
): string {
  if (!isValidCapture(captureText)) return existingContent;

  const formatted = formatCaptureContent(captureText, date);

  if (!existingContent.trim()) {
    const today = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return `# Inbox - ${today}\n\n${formatted}\n`;
  }

  return `${existingContent.replace(/\n+$/, '')}\n${formatted}\n`;
}

export async function saveQuickCapture(
  text: string,
  options: QuickCaptureOptions = {},
): Promise<QuickCaptureSaveResult> {
  if (!isValidCapture(text)) {
    throw new Error('Capture text cannot be empty');
  }

  const pathDate = options.pathDate ?? new Date();
  const contentDate = options.contentDate ?? new Date();
  const inboxPath = buildInboxPath(options.basePath, pathDate);

  let existingContent = '';
  try {
    const file = await mindosClient.getFileContent(inboxPath);
    existingContent = file.content;
  } catch (error) {
    const isNotFound = error instanceof ApiError && error.status === 404;
    if (!isNotFound) {
      throw new QuickCaptureReadError();
    }
  }

  const content = appendCaptureToContent(existingContent, text, contentDate);
  const result = await mindosClient.saveFile(inboxPath, content);
  if (!result.ok) {
    throw new Error(result.error || 'Failed to save quick capture');
  }

  return { inboxPath, content };
}
