import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from 'node:fs';
import { resolveSafe } from '../../foundation/security/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';

export const RAW_FILE_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

export const MAX_RAW_FILE_SIZE = 200 * 1024 * 1024;

export type RawFileHandlerServices = {
  mindRoot: string;
};

export type RawFileHandlerOptions = {
  range?: string | null;
};

export function handleRawFile(
  query: MindosRequestQuery | undefined,
  services: RawFileHandlerServices,
  options: RawFileHandlerOptions = {},
): MindosServerResponse<Buffer | { error: string }> {
  const filePath = queryValue(query, 'path');
  if (!filePath) return json({ error: 'Missing path parameter' }, { status: 400 });

  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const mime = RAW_FILE_MIME_TYPES[ext];
  if (!mime) return json({ error: `Unsupported binary file type: ${ext}` }, { status: 400 });

  let resolved: string;
  try {
    resolved = resolveSafe(services.mindRoot, filePath);
  } catch {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  if (!existsSync(resolved)) return json({ error: 'File not found' }, { status: 404 });

  const stat = statSync(resolved);
  if (stat.size > MAX_RAW_FILE_SIZE) {
    return json(
      { error: `File too large (${Math.round(stat.size / 1024 / 1024)}MB). Max: ${MAX_RAW_FILE_SIZE / 1024 / 1024}MB` },
      { status: 413 },
    );
  }

  const totalSize = stat.size;
  const rangeHeader = options.range;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Math.min(Number.parseInt(match[1] ?? '0', 10), totalSize - 1);
      const end = Math.min(match[2] ? Number.parseInt(match[2], 10) : totalSize - 1, totalSize - 1);
      const chunkSize = end - start + 1;
      const buffer = Buffer.alloc(chunkSize);
      const fd = openSync(resolved, 'r');
      try {
        readSync(fd, buffer, 0, chunkSize, start);
      } finally {
        closeSync(fd);
      }
      return {
        status: 206,
        body: buffer,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          ...privateCacheHeaders(60),
        },
      };
    }
  }

  const buffer = readFileSync(resolved);
  return {
    status: 200,
    body: buffer,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      ...privateCacheHeaders(60),
    },
  };
}
