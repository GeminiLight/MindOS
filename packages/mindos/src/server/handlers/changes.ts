import { LocalFileSystem } from '../../knowledge/storage/local.js';
import {
  getContentChangeSummary,
  listContentChanges,
  markContentChangesSeen,
  type ContentChangeEvent,
  type ContentChangeSummary,
} from '../../knowledge/audit/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, type MindosServerResponse } from '../response.js';

export type ChangesHandlerServices = {
  mindRoot: string;
};

export type ChangesListPayload = {
  events: ContentChangeEvent[];
};

export type ChangesMarkSeenPayload = {
  ok: true;
};

export async function handleChangesGet(
  query: MindosRequestQuery | undefined,
  services: ChangesHandlerServices,
): Promise<MindosServerResponse<ContentChangeSummary | ChangesListPayload | { error: string }>> {
  const op = queryValue(query, 'op') ?? 'summary';
  const fs = new LocalFileSystem();

  if (op === 'summary') {
    const result = await getContentChangeSummary(fs, services.mindRoot);
    return result.ok ? json(result.value) : json({ error: result.error.message }, { status: 500 });
  }

  if (op === 'list') {
    const limitRaw = queryValue(query, 'limit');
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit <= 0) return json({ error: 'invalid limit' }, { status: 400 });
    const sourceParam = queryValue(query, 'source');
    const source = sourceParam === 'user' || sourceParam === 'agent' || sourceParam === 'system'
      ? sourceParam
      : undefined;
    const result = await listContentChanges(fs, services.mindRoot, {
      path: queryValue(query, 'path'),
      source,
      op: queryValue(query, 'event_op'),
      q: queryValue(query, 'q'),
      limit,
    });
    return result.ok ? json({ events: result.value }) : json({ error: result.error.message }, { status: 500 });
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
}

export async function handleChangesPost(
  body: unknown,
  services: ChangesHandlerServices,
): Promise<MindosServerResponse<ChangesMarkSeenPayload | { error: string }>> {
  if (!body || typeof body !== 'object') return json({ error: 'invalid JSON' }, { status: 400 });
  const op = (body as { op?: unknown }).op;
  if (typeof op !== 'string') return json({ error: 'missing op' }, { status: 400 });

  if (op === 'mark_seen') {
    const result = await markContentChangesSeen(new LocalFileSystem(), services.mindRoot);
    return result.ok ? json({ ok: true }) : json({ error: result.error.message }, { status: 500 });
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
}
