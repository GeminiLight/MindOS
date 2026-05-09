import { posix } from 'node:path';
import { resolveSafe } from '../../foundation/security/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { collectAllFilesFromMindRoot } from '../runtime.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export type SpaceOverviewHandlerServices = {
  mindRoot: string;
  collectAllFiles?: () => string[];
};

export type SpaceOverviewPayload = {
  fileCount: number;
};

export function handleSpaceOverviewGet(
  query: MindosRequestQuery | undefined,
  services: SpaceOverviewHandlerServices,
): MindosServerResponse<SpaceOverviewPayload | { error: string }> {
  const space = normalizeSpace(queryValue(query, 'space'));
  if (!space) return json({ error: 'space parameter required' }, { status: 400 });

  try {
    resolveSafe(services.mindRoot, space);
  } catch {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  const files = services.collectAllFiles?.() ?? collectAllFilesFromMindRoot(services.mindRoot);
  const prefix = space === '.' ? '' : `${space}/`;
  const fileCount = files.filter((filePath) => {
    const normalized = normalizeSpace(filePath);
    return normalized ? normalized.startsWith(prefix) : false;
  }).length;

  return json({ fileCount }, { headers: privateCacheHeaders(30) });
}

function normalizeSpace(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = posix.normalize(value.trim().replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return normalized;
  return normalized;
}
