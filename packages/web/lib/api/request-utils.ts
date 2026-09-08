import { NextRequest, NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { MindOSError, ErrorCodes } from '@/lib/errors';

/** Upper bound for JSON bodies on knowledge write routes (/api/inbox, /api/file, /api/file/import). */
export const KNOWLEDGE_WRITE_MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Body-read failure with an HTTP status attached. `code` + `statusCode` follow
 * the product error shape so handleRouteErrorSimple() maps it to the right
 * status if a route lets it propagate.
 */
export class RequestBodyError extends Error {
  readonly code: 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON';
  readonly statusCode: 413 | 400;

  constructor(code: 'PAYLOAD_TOO_LARGE' | 'INVALID_JSON', message: string) {
    super(message);
    this.name = 'RequestBodyError';
    this.code = code;
    this.statusCode = code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
  }
}

export function isPayloadTooLarge(error: unknown): error is RequestBodyError {
  return error instanceof RequestBodyError && error.statusCode === 413;
}

export function payloadTooLargeResponse(maxBytes: number): NextResponse<{ error: string }> {
  return NextResponse.json(
    { error: `Request body too large (limit ${maxBytes} bytes)` },
    { status: 413 },
  );
}

function parseContentLength(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read and parse a JSON body while enforcing a byte limit.
 *
 * A declared `content-length` above the limit is rejected before the body is
 * touched. Otherwise the stream is consumed chunk by chunk and cancelled as
 * soon as the running total exceeds `maxBytes`, so a client without a
 * content-length header (chunked upload) cannot make the server buffer an
 * unbounded payload the way `req.json()` would.
 *
 * Throws RequestBodyError with statusCode 413 (too large) or 400 (empty or
 * invalid JSON).
 */
export async function readJsonBodyWithLimit(req: Request, maxBytes: number): Promise<unknown> {
  const declared = parseContentLength(req.headers.get('content-length'));
  if (declared !== null && declared > maxBytes) {
    throw new RequestBodyError(
      'PAYLOAD_TOO_LARGE',
      `Request body too large: ${declared} bytes exceeds the ${maxBytes}-byte limit`,
    );
  }

  const body = req.body;
  if (!body) {
    throw new RequestBodyError('INVALID_JSON', 'Request body must be valid JSON');
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => { /* client may already be gone */ });
        throw new RequestBodyError(
          'PAYLOAD_TOO_LARGE',
          `Request body too large: exceeded the ${maxBytes}-byte limit`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (received === 0) {
    throw new RequestBodyError('INVALID_JSON', 'Request body must be valid JSON');
  }

  const raw = new TextDecoder('utf-8').decode(concatChunks(chunks, received));
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new RequestBodyError(
      'INVALID_JSON',
      `Request body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse JSON from request body safely.
 * Throws MindOSError if JSON is invalid.
 */
export async function parseJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch (err) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      'Request body must be valid JSON',
      { error: err instanceof Error ? err.message : String(err) },
      'Invalid JSON in request body',
    );
  }
}

/**
 * Parse and validate JSON body against a Zod schema.
 * Throws MindOSError if validation fails.
 */
export async function parseAndValidateBody<T>(
  req: NextRequest,
  schema: ZodType,
): Promise<T> {
  const body = await parseJsonBody(req);
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      `Validation failed: ${result.error.issues.map(e => `${e.path.join('.')} ${e.message}`).join('; ')}`,
      { errors: result.error.issues },
      'Request validation failed',
    );
  }

  return result.data as T;
}

/**
 * Resolve provider configuration from settings and environment.
 * Used by multiple routes to avoid duplication.
 */
export function resolveProviderConfig(): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  // This would need access to readSettings, but for now just define the interface
  // Routes will implement this themselves or we'll extract it further
  throw new Error('resolveProviderConfig should be implemented per route');
}
