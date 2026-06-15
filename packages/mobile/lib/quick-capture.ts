/**
 * Quick Capture - domain logic for appending quick notes to the daily inbox.
 */

import { ApiError, mindosClient } from '@/lib/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_STORAGE_KEY = 'mindos_quick_capture_draft';
const PENDING_QUEUE_STORAGE_KEY = 'mindos_quick_capture_pending_queue';

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

export interface PendingQuickCapture {
  id: string;
  text: string;
  inboxPath: string;
  basePath: string;
  pathDateISO: string;
  contentDateISO: string;
  createdAt: string;
}

export interface RetryPendingCapturesResult {
  saved: PendingQuickCapture[];
  remaining: PendingQuickCapture[];
  failed?: PendingQuickCapture;
  error?: Error;
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

export async function loadQuickCaptureDraft(): Promise<string> {
  return await AsyncStorage.getItem(DRAFT_STORAGE_KEY) ?? '';
}

export async function saveQuickCaptureDraft(text: string): Promise<void> {
  if (!text.trim()) {
    await clearQuickCaptureDraft();
    return;
  }
  await AsyncStorage.setItem(DRAFT_STORAGE_KEY, text);
}

export async function clearQuickCaptureDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
}

export async function loadPendingCaptures(): Promise<PendingQuickCapture[]> {
  const raw = await AsyncStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingQuickCapture);
  } catch {
    return [];
  }
}

export async function queueQuickCapture(
  text: string,
  options: QuickCaptureOptions = {},
): Promise<PendingQuickCapture> {
  if (!isValidCapture(text)) {
    throw new Error('Capture text cannot be empty');
  }

  const pathDate = options.pathDate ?? new Date();
  const contentDate = options.contentDate ?? new Date();
  const basePath = options.basePath ?? 'inbox';
  const pending: PendingQuickCapture = {
    id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    inboxPath: buildInboxPath(basePath, pathDate),
    basePath,
    pathDateISO: pathDate.toISOString(),
    contentDateISO: contentDate.toISOString(),
    createdAt: new Date().toISOString(),
  };

  const pendingCaptures = await loadPendingCaptures();
  await persistPendingCaptures([...pendingCaptures, pending]);
  return pending;
}

export async function removePendingCaptures(ids: string[]): Promise<PendingQuickCapture[]> {
  const idSet = new Set(ids);
  const next = (await loadPendingCaptures()).filter((capture) => !idSet.has(capture.id));
  await persistPendingCaptures(next);
  return next;
}

export async function retryPendingCaptures(): Promise<RetryPendingCapturesResult> {
  const pendingCaptures = await loadPendingCaptures();
  const saved: PendingQuickCapture[] = [];
  let remaining = pendingCaptures;

  for (const capture of pendingCaptures) {
    try {
      await saveQuickCapture(capture.text, {
        basePath: capture.basePath,
        pathDate: new Date(capture.pathDateISO),
        contentDate: new Date(capture.contentDateISO),
      });
      saved.push(capture);
      remaining = remaining.filter((item) => item.id !== capture.id);
      await persistPendingCaptures(remaining);
    } catch (error) {
      return {
        saved,
        remaining,
        failed: capture,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  return { saved, remaining };
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

async function persistPendingCaptures(captures: PendingQuickCapture[]): Promise<void> {
  if (captures.length === 0) {
    await AsyncStorage.removeItem(PENDING_QUEUE_STORAGE_KEY);
    return;
  }
  await AsyncStorage.setItem(PENDING_QUEUE_STORAGE_KEY, JSON.stringify(captures));
}

function isPendingQuickCapture(value: unknown): value is PendingQuickCapture {
  if (!value || typeof value !== 'object') return false;
  const capture = value as PendingQuickCapture;
  return typeof capture.id === 'string'
    && typeof capture.text === 'string'
    && typeof capture.inboxPath === 'string'
    && typeof capture.basePath === 'string'
    && typeof capture.pathDateISO === 'string'
    && typeof capture.contentDateISO === 'string'
    && typeof capture.createdAt === 'string';
}
