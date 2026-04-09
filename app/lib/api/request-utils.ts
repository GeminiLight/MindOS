import { NextRequest } from 'next/server';
import type { ZodSchema } from 'zod';
import { MindOSError, ErrorCodes } from '@/lib/errors';

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
  schema: ZodSchema,
): Promise<T> {
  const body = await parseJsonBody(req);
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new MindOSError(
      ErrorCodes.INVALID_REQUEST,
      `Validation failed: ${result.error.errors.map(e => `${e.path.join('.')} ${e.message}`).join('; ')}`,
      { errors: result.error.errors },
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
