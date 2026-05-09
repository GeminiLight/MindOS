import { createHash } from 'node:crypto';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, publicCacheHeaders, type MindosServerResponse } from '../response.js';

export type FilesHandlerServices = {
  collectAllFiles(): string[];
};

export type FilesPage = {
  files: string[];
  total: number;
  offset: number;
  limit: number;
};

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function generateETag(input: string) {
  return `"${createHash('sha1').update(input).digest('hex')}"`;
}

export function handleFiles(query: MindosRequestQuery | undefined, services: FilesHandlerServices): MindosServerResponse<string[] | FilesPage> {
  const files = services.collectAllFiles();
  const limitRaw = queryValue(query, 'limit');
  const offset = parseNonNegativeInteger(queryValue(query, 'offset'), 0);
  const limit = parseNonNegativeInteger(limitRaw, 0);
  const headers = publicCacheHeaders(60, generateETag(files.join('\n')));

  if (limitRaw !== undefined && limit > 0) {
    return json({
      files: files.slice(offset, offset + limit),
      total: files.length,
      offset,
      limit,
    }, { headers });
  }

  return json(files, { headers });
}
