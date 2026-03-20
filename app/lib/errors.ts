import { NextResponse } from 'next/server';

/**
 * Centralized error class for MindOS backend business logic.
 *
 * Every throw in `lib/core/` should use this class so that:
 * 1. API routes can detect it in catch blocks and return structured JSON.
 * 2. Callers can switch on `code` for programmatic handling.
 * 3. `userMessage` provides a translatable, user-safe description.
 */
export class MindOSError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public context?: Record<string, unknown>,
    public userMessage?: string,
  ) {
    super(message);
    this.name = 'MindOSError';
  }
}

export const ErrorCodes = {
  // File operations
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ALREADY_EXISTS: 'FILE_ALREADY_EXISTS',
  PATH_OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  PROTECTED_FILE: 'PROTECTED_FILE',
  INVALID_PATH: 'INVALID_PATH',
  INVALID_RANGE: 'INVALID_RANGE',
  HEADING_NOT_FOUND: 'HEADING_NOT_FOUND',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  // API
  INVALID_REQUEST: 'INVALID_REQUEST',
  MODEL_INIT_FAILED: 'MODEL_INIT_FAILED',
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Standardized API error response envelope. */
export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

/** Extract a human-readable message from an unknown thrown value. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/** Map an ErrorCode to an HTTP status code. */
function mapCodeToStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCodes.FILE_NOT_FOUND:
    case ErrorCodes.HEADING_NOT_FOUND:
      return 404;
    case ErrorCodes.FILE_ALREADY_EXISTS:
      return 409;
    case ErrorCodes.PATH_OUTSIDE_ROOT:
    case ErrorCodes.PROTECTED_FILE:
    case ErrorCodes.PERMISSION_DENIED:
      return 403;
    case ErrorCodes.INVALID_PATH:
    case ErrorCodes.INVALID_RANGE:
    case ErrorCodes.INVALID_FILE_TYPE:
    case ErrorCodes.INVALID_REQUEST:
      return 400;
    case ErrorCodes.MODEL_INIT_FAILED:
    case ErrorCodes.INTERNAL_ERROR:
    default:
      return 500;
  }
}

/**
 * Build a NextResponse with the standard `{ ok, error }` envelope.
 *
 * If `status` is omitted it is derived from the error code.
 */
export function apiError(code: ErrorCode, message: string, status?: number): NextResponse<ApiErrorResponse> {
  const effectiveStatus = status ?? mapCodeToStatus(code);
  return NextResponse.json({ ok: false as const, error: { code, message } }, { status: effectiveStatus });
}

/**
 * Convenience: catch an unknown error and return a structured API response.
 *
 * Usage in route handlers:
 * ```ts
 * catch (err) {
 *   return handleRouteError(err);
 * }
 * ```
 */
export function handleRouteError(err: unknown): NextResponse<ApiErrorResponse> {
  if (err instanceof MindOSError) {
    return apiError(err.code, err.message);
  }
  return apiError(ErrorCodes.INTERNAL_ERROR, 'Internal server error', 500);
}
