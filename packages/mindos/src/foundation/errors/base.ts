/**
 * Base error class for all MindOS errors
 */

import type { ErrorCode, ErrorContext, ErrorMetadata } from './types.js'

/**
 * Base application error
 */
export class AppError extends Error {
  /** Error code */
  public readonly code: ErrorCode

  /** HTTP status code */
  public readonly statusCode: number

  /** Error context */
  public readonly context?: ErrorContext

  /** Error metadata */
  public readonly metadata: ErrorMetadata

  /** Original error (if wrapped) */
  public override readonly cause?: Error

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.context = options?.context
    this.cause = options?.cause
    this.metadata = {
      timestamp: Date.now(),
      ...options?.metadata,
    }

    // Maintain proper stack trace
    Error.captureStackTrace(this, this.constructor)
  }

  /**
   * Convert error to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      metadata: this.metadata,
      stack: this.stack,
    }
  }

  /**
   * Convert error to user-friendly message
   */
  toUserMessage(): string {
    return this.message
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'VALIDATION_ERROR', 400, options)
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(
    resource: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(`${resource} not found`, 'NOT_FOUND', 404, options)
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppError {
  constructor(
    message = 'Unauthorized',
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'UNAUTHORIZED', 401, options)
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends AppError {
  constructor(
    message = 'Forbidden',
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'FORBIDDEN', 403, options)
  }
}

/**
 * Conflict error
 */
export class ConflictError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'CONFLICT', 409, options)
  }
}

/**
 * Internal server error
 */
export class InternalError extends AppError {
  constructor(
    message = 'Internal server error',
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'INTERNAL_ERROR', 500, options)
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends AppError {
  constructor(
    service: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(`${service} is unavailable`, 'SERVICE_UNAVAILABLE', 503, options)
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends AppError {
  constructor(
    operation: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(`${operation} timed out`, 'TIMEOUT', 408, options)
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends AppError {
  constructor(
    message = 'Rate limit exceeded',
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, options)
  }
}

/**
 * File system error
 */
export class FileSystemError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'FILE_SYSTEM_ERROR', 500, options)
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'DATABASE_ERROR', 500, options)
  }
}

/**
 * Network error
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: ErrorContext
      cause?: Error
      metadata?: Partial<ErrorMetadata>
    }
  ) {
    super(message, 'NETWORK_ERROR', 500, options)
  }
}
