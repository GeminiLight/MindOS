/**
 * Error factory utilities
 */

import { AppError } from './base.js'
import type { ErrorCode, ErrorContext, ErrorMetadata } from './types.js'
import { ERROR_STATUS_CODES, ERROR_MESSAGES, isRetryableError, getRetryDelay } from './codes.js'

/**
 * Create an AppError from error code
 */
export function createError(
  code: ErrorCode,
  message?: string,
  options?: {
    context?: ErrorContext
    cause?: Error
    metadata?: Partial<ErrorMetadata>
  }
): AppError {
  const statusCode = ERROR_STATUS_CODES[code]
  const defaultMessage = ERROR_MESSAGES[code]

  return new AppError(
    message ?? defaultMessage,
    code,
    statusCode,
    {
      ...options,
      metadata: {
        ...options?.metadata,
        retryable: isRetryableError(code),
        retryAfter: getRetryDelay(code),
      },
    }
  )
}

/**
 * Wrap unknown error as AppError
 */
export function wrapError(error: unknown, context?: ErrorContext): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error
  }

  // Standard Error
  if (error instanceof Error) {
    return new AppError(
      error.message,
      'INTERNAL_ERROR',
      500,
      {
        context,
        cause: error,
      }
    )
  }

  // Unknown error type
  return new AppError(
    String(error),
    'INTERNAL_ERROR',
    500,
    { context }
  )
}

/**
 * Check if error is an AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Extract error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Extract error stack from unknown error
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack
  }
  return undefined
}

/**
 * Format error for logging
 */
export function formatErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return error.toJSON()
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    error: String(error),
  }
}
