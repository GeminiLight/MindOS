/**
 * Quick Capture - domain logic for appending quick notes to the daily inbox.
 */

import { ApiError, mindosClient } from '@/lib/api-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkspaceIdentity, workspaceKey, serializeWorkspace } from './workspace-storage';

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
  captureId?: string;
  captureEntry?: string;
  captureHeading?: string;
  inboxPath?: string;
  workspace?: string;
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
  workspace: string;
  entry?: string;
  heading?: string;
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

export async function loadQuickCaptureDraft(scope = getWorkspaceIdentity()): Promise<string> {
  return await AsyncStorage.getItem(workspaceKey(DRAFT_STORAGE_KEY, scope)) ?? '';
}

export async function saveQuickCaptureDraft(text: string, scope = getWorkspaceIdentity()): Promise<void> {
  if (!text.trim()) {
    await clearQuickCaptureDraft(scope);
    return;
  }
  const key = workspaceKey(DRAFT_STORAGE_KEY, scope);
  await serializeWorkspace(key, () => AsyncStorage.setItem(key, text));
}

export async function clearQuickCaptureDraft(scope = getWorkspaceIdentity()): Promise<void> {
  const key = workspaceKey(DRAFT_STORAGE_KEY, scope);
  await serializeWorkspace(key, () => AsyncStorage.removeItem(key));
}

export async function loadPendingCaptures(scope = getWorkspaceIdentity()): Promise<PendingQuickCapture[]> {
  const raw = await AsyncStorage.getItem(workspaceKey(PENDING_QUEUE_STORAGE_KEY, scope));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isPendingQuickCapture) || parsed.some(capture => capture.workspace !== scope)) {
    throw new Error('This local note queue needs recovery. Its original data has been preserved.');
  }
  return parsed;
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
  const scope = options.workspace ?? getWorkspaceIdentity();
  const pending: PendingQuickCapture = {
    workspace: scope,
    entry: formatCaptureContent(text, contentDate),
    heading: '# Inbox - ' + pathDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    id: `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    inboxPath: options.inboxPath ?? buildInboxPath(basePath, pathDate),
    basePath,
    pathDateISO: pathDate.toISOString(),
    contentDateISO: contentDate.toISOString(),
    createdAt: new Date().toISOString(),
  };

  await serializeWorkspace(workspaceKey(PENDING_QUEUE_STORAGE_KEY, scope), async () => {
    const captures = await loadPendingCaptures(scope);
    await persistPendingCaptures([...captures, pending], scope);
  });
  return pending;
}

export async function removePendingCaptures(ids: string[], scope = getWorkspaceIdentity()): Promise<PendingQuickCapture[]> {
  return serializeWorkspace(workspaceKey(PENDING_QUEUE_STORAGE_KEY, scope), async () => {
    const next = (await loadPendingCaptures(scope)).filter(capture => !ids.includes(capture.id));
    await persistPendingCaptures(next, scope);
    return next;
  });
}

export async function retryPendingCaptures(): Promise<RetryPendingCapturesResult> {
  const scope = getWorkspaceIdentity();
  return serializeWorkspace(workspaceKey('capture-sync', scope), async () => {
    const pending = await loadPendingCaptures(scope);
    const saved: PendingQuickCapture[] = [];
    for (const capture of pending) {
      try {
        await saveQuickCapture(capture.text, {
          workspace: scope, captureId: capture.id, inboxPath: capture.inboxPath,
          captureEntry: capture.entry, captureHeading: capture.heading,
          contentDate: new Date(capture.contentDateISO),
        });
        await removePendingCaptures([capture.id], scope);
        saved.push(capture);
      } catch (error) {
        return {
          saved, remaining: await loadPendingCaptures(scope), failed: capture,
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }
    return { saved, remaining: await loadPendingCaptures(scope) };
  });
}

export async function saveQuickCapture(text: string, options: QuickCaptureOptions = {}): Promise<QuickCaptureSaveResult> {
  if (!isValidCapture(text)) throw new Error('Capture text cannot be empty');
  const scope = options.workspace ?? getWorkspaceIdentity();
  const inboxPath = options.inboxPath ?? buildInboxPath(options.basePath, options.pathDate ?? new Date());
  const contentDate = options.contentDate ?? new Date();
  const marker = options.captureId ? `<!-- mindos-capture:${options.captureId} -->` : '';
  const checkOwner = () => {
    if (scope !== getWorkspaceIdentity()) throw new Error('Workspace changed. This note is kept on its original device queue.');
  };
  return serializeWorkspace(workspaceKey(`capture-file:${inboxPath}`, scope), async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      checkOwner();
      let existing = ''; let mtime: number | undefined; let missing = false;
      let revision: string | undefined; let vaultId: string | undefined;
      try {
        const file = await mindosClient.getFileContent(inboxPath);
        existing = file.content; mtime = file.mtime; revision = file.revision; vaultId = file.vaultId;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) missing = true;
        else throw new QuickCaptureReadError();
      }
      checkOwner();
      if (marker && existing.includes(marker)) return { inboxPath, content: existing };
      if (!missing && (typeof mtime !== 'number' || !Number.isFinite(mtime))) {
        throw new Error('This server cannot protect concurrent edits. Update MindOS, then sync this note.');
      }
      const appended = options.captureEntry
        ? existing.trim() ? `${existing.replace(/\n+$/, '')}\n${options.captureEntry}\n` : `${options.captureHeading ?? '# Inbox'}\n\n${options.captureEntry}\n`
        : appendCaptureToContent(existing, text, contentDate);
      const content = marker ? `${appended}${marker}\n` : appended;
      const result = missing
        ? await mindosClient.createFile(inboxPath, content)
        : await mindosClient.saveFile(inboxPath, content, mtime, { expectedRevision: revision, expectedVaultId: vaultId });
      if (result.ok) return { inboxPath, content };
      if (result.error !== 'conflict' && result.error !== 'exists') throw new Error(result.error || 'Failed to save quick capture');
    }
    throw new Error('This inbox is changing on another device. Your note is safe locally; retry sync shortly.');
  });
}

async function persistPendingCaptures(captures: PendingQuickCapture[], scope: string): Promise<void> {
  if (captures.length === 0) {
    await AsyncStorage.removeItem(workspaceKey(PENDING_QUEUE_STORAGE_KEY, scope));
    return;
  }
  await AsyncStorage.setItem(workspaceKey(PENDING_QUEUE_STORAGE_KEY, scope), JSON.stringify(captures));
}

function isPendingQuickCapture(value: unknown): value is PendingQuickCapture {
  if (!value || typeof value !== 'object') return false;
  const capture = value as PendingQuickCapture;
  return typeof capture.workspace === 'string'
    && typeof capture.id === 'string'
    && typeof capture.text === 'string'
    && typeof capture.inboxPath === 'string'
    && typeof capture.basePath === 'string'
    && typeof capture.pathDateISO === 'string'
    && typeof capture.contentDateISO === 'string'
    && typeof capture.createdAt === 'string';
}

/** Old releases did not record ownership. Expose the raw local notes for manual recovery only. */
export async function readLegacyCaptureNotes(): Promise<string> {
  const [draft, queue] = await Promise.all([
    AsyncStorage.getItem(DRAFT_STORAGE_KEY), AsyncStorage.getItem(PENDING_QUEUE_STORAGE_KEY),
  ]);
  const sections: string[] = [];
  if (draft?.trim()) sections.push(`## Older quick note draft\n\n${draft}`);
  if (queue) {
    const notes: unknown = JSON.parse(queue);
    if (!Array.isArray(notes)) throw new Error('The older note queue is unreadable. Its original data has been preserved.');
    for (const note of notes) {
      if (typeof note?.text === 'string') sections.push(`## ${note.inboxPath || 'Older note'}\n\n${note.text}`);
    }
  }
  return sections.join('\n\n');
}
