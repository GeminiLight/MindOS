import { closeSync, existsSync, openSync, read, readSync, statSync } from 'node:fs';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { queryValue, type MindosRequestQuery } from '../context.js';
import { json, privateCacheHeaders, type MindosServerResponse } from '../response.js';
import { etagMatches } from '../web-response.js';

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

/** Files above this size are refused (413) rather than served. */
export const MAX_RAW_FILE_SIZE = 200 * 1024 * 1024;

/**
 * Responses up to this many bytes are read into one Buffer (one syscall, no
 * stream machinery — the common case for embedded images); anything larger is
 * streamed from the descriptor so a 190 MB video never sits in the heap.
 */
export const RAW_FILE_STREAM_THRESHOLD = 1024 * 1024;

const RAW_FILE_STREAM_CHUNK = 64 * 1024;

export type RawFileBody = Buffer | ReadableStream<Uint8Array>;

export type RawFileHandlerServices = {
  mindRoot: string;
};

export type RawFileHandlerOptions = {
  range?: string | null;
  /** `If-None-Match` from the request; a match answers 304 without opening the file. */
  ifNoneMatch?: string | null;
};

let openRawFileHandles = 0;

/** Descriptors currently held by streamed raw-file bodies (closed on end, cancel and error). */
export function getOpenRawFileHandleCountForTests(): number {
  return openRawFileHandles;
}

export function handleRawFile(
  query: MindosRequestQuery | undefined,
  services: RawFileHandlerServices,
  options: RawFileHandlerOptions = {},
): MindosServerResponse<RawFileBody | { error: string }> {
  const filePath = queryValue(query, 'path');
  if (!filePath) return json({ error: 'Missing path parameter' }, { status: 400 });

  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const mime = RAW_FILE_MIME_TYPES[ext];
  if (!mime) return json({ error: `Unsupported binary file type: ${ext}` }, { status: 400 });

  let resolved: string;
  try {
    resolved = resolveExistingSafe(services.mindRoot, filePath);
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
  // Weak validator: size + mtime is what the 60s private cache already relies on.
  const etag = `W/"${totalSize}-${Math.round(stat.mtimeMs)}"`;
  const cacheHeaders = { ETag: etag, ...privateCacheHeaders(60) };
  if (options.ifNoneMatch && etagMatches(options.ifNoneMatch, etag)) {
    return { status: 304, headers: { ...cacheHeaders, 'Accept-Ranges': 'bytes' } };
  }

  const rangeHeader = options.range;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number.parseInt(match[1] ?? '0', 10);
      const end = Math.min(match[2] ? Number.parseInt(match[2], 10) : totalSize - 1, totalSize - 1);
      // RFC 9110: a first-byte-pos past the end, or an inverted range, is not
      // satisfiable. Previously this produced a negative Buffer.alloc -> 500.
      if (totalSize === 0 || !Number.isFinite(start) || start >= totalSize || end < start) {
        return {
          status: 416,
          body: { error: 'Requested range not satisfiable' },
          headers: { 'Content-Range': `bytes */${totalSize}`, 'Accept-Ranges': 'bytes' },
        };
      }
      const chunkSize = end - start + 1;
      return {
        status: 206,
        body: openRawFileBody(resolved, start, chunkSize),
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          ...rawContentSecurityHeaders(mime),
          ...cacheHeaders,
        },
      };
    }
  }

  return {
    status: 200,
    body: openRawFileBody(resolved, 0, totalSize),
    headers: {
      'Content-Type': mime,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      ...rawContentSecurityHeaders(mime),
      ...cacheHeaders,
    },
  };
}

/** `length` bytes from `start`: one Buffer below the threshold, a pull stream above it. */
function openRawFileBody(file: string, start: number, length: number): RawFileBody {
  if (length <= 0) return Buffer.alloc(0);
  if (length <= RAW_FILE_STREAM_THRESHOLD) {
    const buffer = Buffer.alloc(length);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    return buffer;
  }
  return createRawFileStream(file, start, length);
}

/**
 * Pull-based stream over one descriptor. The descriptor is opened
 * synchronously so the handler stays synchronous and a leak is observable
 * right away; every exit (last chunk, consumer cancel, read error, file shrunk
 * underneath us) goes through `close()` exactly once.
 */
function createRawFileStream(file: string, start: number, length: number): ReadableStream<Uint8Array> {
  const fd = openSync(file, 'r');
  openRawFileHandles += 1;
  let closed = false;
  let offset = start;
  let remaining = length;

  const close = () => {
    if (closed) return;
    closed = true;
    openRawFileHandles -= 1;
    try {
      closeSync(fd);
    } catch {
      // Already closed by the OS (e.g. the file vanished); nothing to release.
    }
  };

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (closed) return undefined;
      const size = Math.min(RAW_FILE_STREAM_CHUNK, remaining);
      const buffer = Buffer.allocUnsafe(size);
      return new Promise<void>((resolve) => {
        read(fd, buffer, 0, size, offset, (error, bytesRead) => {
          if (closed) {
            resolve();
            return;
          }
          if (error) {
            close();
            controller.error(error);
            resolve();
            return;
          }
          if (bytesRead === 0) {
            // The file shrank after stat: end the stream short rather than hang.
            close();
            controller.close();
            resolve();
            return;
          }
          offset += bytesRead;
          remaining -= bytesRead;
          controller.enqueue(bytesRead === size ? buffer : buffer.subarray(0, bytesRead));
          if (remaining <= 0) {
            close();
            controller.close();
          }
          resolve();
        });
      });
    },
    cancel() {
      close();
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: RAW_FILE_STREAM_CHUNK * 2 }));
}

/**
 * Raw files are served inline on the app origin. An SVG with a <script> opened
 * directly would execute with the session cookie (stored XSS via any write
 * path that accepts .svg). The sandbox CSP gives the document an opaque origin
 * and blocks script; nosniff stops browsers from re-interpreting other types.
 */
function rawContentSecurityHeaders(mime: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if (mime === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "sandbox; script-src 'none'";
  }
  return headers;
}
