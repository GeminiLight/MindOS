import type { ContentChangeEvent, ContentChangeSummary } from '../../knowledge/audit/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, type MindosServerResponse } from '../response.js';
import {
  getContentChangeFacetsFromLog,
  getContentChangeSummaryFromLog,
  listContentChangesFromLog,
  markContentChangesSeenInLog,
  type ContentChangeFacets,
} from './change-log-store.js';

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
): Promise<MindosServerResponse<ContentChangeSummary | ChangesListPayload | ContentChangeFacets | { error: string }>> {
  const op = queryValue(query, 'op') ?? 'summary';

  if (op === 'summary') {
    try {
      return json(getContentChangeSummaryFromLog(services.mindRoot));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  if (op === 'facets') {
    try {
      return json(getContentChangeFacetsFromLog(services.mindRoot));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  if (op === 'list') {
    const limitRaw = queryValue(query, 'limit');
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isFinite(limit) || limit <= 0) return json({ error: 'invalid limit' }, { status: 400 });
    const sourceParam = queryValue(query, 'source');
    const source = sourceParam === 'user' || sourceParam === 'agent' || sourceParam === 'system'
      ? sourceParam
      : undefined;
    try {
      const events = listContentChangesFromLog(services.mindRoot, {
        path: queryValue(query, 'path'),
        space: queryValue(query, 'space'),
        source,
        agent: queryValue(query, 'agent'),
        op: queryValue(query, 'event_op'),
        q: queryValue(query, 'q'),
        limit,
      });
      return json({ events });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
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
    try {
      markContentChangesSeenInLog(services.mindRoot);
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
}
