'use client';

export interface InboxFileInfo {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isAging: boolean;
  source?: InboxFileSourceInfo;
}

export interface InboxFileSourceInfo {
  kind?: string;
  url?: string;
  domain?: string;
  siteName?: string;
  platform?: string;
  platformLabel?: string;
  title?: string;
}

export interface InboxSaveInput {
  name: string;
  content: string;
  encoding?: 'text' | 'base64' | string;
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

export class InboxClientError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'InboxClientError';
    this.status = status;
  }
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const data = await res.json();
    return data && typeof data === 'object' ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessageFromBody(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  const message = body.message;
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

function normalizeSaveResult(body: Record<string, unknown>): InboxSaveResult {
  const saved = Array.isArray(body.saved)
    ? body.saved.filter((item): item is { original: string; path: string } => (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { original?: unknown }).original === 'string' &&
      typeof (item as { path?: unknown }).path === 'string'
    ))
    : [];
  const skipped = Array.isArray(body.skipped)
    ? body.skipped.filter((item): item is { name: string; reason: string } => (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { name?: unknown }).name === 'string' &&
      typeof (item as { reason?: unknown }).reason === 'string'
    ))
    : [];
  return {
    saved,
    skipped,
    ...(typeof body.source === 'string' ? { source: body.source } : {}),
  };
}

function normalizeArchiveResult(body: Record<string, unknown>): InboxArchiveResult {
  const archived = Array.isArray(body.archived)
    ? body.archived.filter((item): item is { original: string; archivedPath: string } => (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as { original?: unknown }).original === 'string' &&
      typeof (item as { archivedPath?: unknown }).archivedPath === 'string'
    ))
    : [];
  const notFound = Array.isArray(body.notFound)
    ? body.notFound.filter((item): item is string => typeof item === 'string')
    : [];
  return { archived, notFound };
}

function normalizeInboxSourceInfo(value: unknown): InboxFileSourceInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const result: InboxFileSourceInfo = {};
  for (const key of ['kind', 'url', 'domain', 'siteName', 'platform', 'platformLabel', 'title'] as const) {
    const next = source[key];
    if (typeof next === 'string' && next.trim()) result[key] = next;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export async function fetchInboxFiles(fallbackError: string): Promise<InboxFileInfo[]> {
  const res = await fetch('/api/inbox');
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new InboxClientError(errorMessageFromBody(body, fallbackError), res.status);
  }
  const files = Array.isArray(body.files) ? body.files : [];
  return files.flatMap((item): InboxFileInfo[] => {
    if (
      item === null ||
      typeof item !== 'object' ||
      typeof (item as { name?: unknown }).name !== 'string' ||
      typeof (item as { path?: unknown }).path !== 'string' ||
      typeof (item as { size?: unknown }).size !== 'number' ||
      typeof (item as { modifiedAt?: unknown }).modifiedAt !== 'string' ||
      typeof (item as { isAging?: unknown }).isAging !== 'boolean'
    ) {
      return [];
    }
    const source = normalizeInboxSourceInfo((item as { source?: unknown }).source);
    return [{
      name: (item as { name: string }).name,
      path: (item as { path: string }).path,
      size: (item as { size: number }).size,
      modifiedAt: (item as { modifiedAt: string }).modifiedAt,
      isAging: (item as { isAging: boolean }).isAging,
      ...(source ? { source } : {}),
    }];
  });
}

export async function saveInboxFiles(
  files: InboxSaveInput[],
  fallbackError: string,
  extraBody: Record<string, unknown> = {},
): Promise<InboxSaveResult> {
  const res = await fetch('/api/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...extraBody, files }),
  });
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new InboxClientError(errorMessageFromBody(body, fallbackError), res.status);
  }
  return normalizeSaveResult(body);
}

export async function archiveInboxFiles(
  names: string[],
  fallbackError: string,
): Promise<InboxArchiveResult> {
  const res = await fetch('/api/inbox', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new InboxClientError(errorMessageFromBody(body, fallbackError), res.status);
  }
  return normalizeArchiveResult(body);
}
