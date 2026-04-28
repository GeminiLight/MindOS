/**
 * Tests for error handling utilities
 */

import { describe, it, expect } from 'vitest'
import {
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  InternalError,
  ServiceUnavailableError,
  TimeoutError,
  RateLimitError,
  FileSystemError,
  DatabaseError,
  NetworkError,
} from './base.js'
import {
  createError,
  wrapError,
  isAppError,
  getErrorMessage,
  getErrorStack,
  formatErrorForLog,
} from './factory.js'

describe('AppError', () => {
  it('should create error with message, code, and status', () => {
    const error = new AppError('Invalid input', 'VALIDATION_ERROR', 400)
    expect(error.message).toBe('Invalid input')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('AppError')
  })

  it('should include context', () => {
    const context = { field: 'email', value: 'invalid' }
    const error = new AppError('Invalid email', 'VALIDATION_ERROR', 400, { context })
    expect(error.context).toEqual(context)
  })

  it('should include cause', () => {
    const cause = new Error('Original error')
    const error = new AppError('Wrapped error', 'INTERNAL_ERROR', 500, { cause })
    expect(error.cause).toBe(cause)
  })

  it('should include metadata with timestamp', () => {
    const error = new AppError('Test', 'INTERNAL_ERROR', 500)
    expect(error.metadata).toBeDefined()
    expect(error.metadata.timestamp).toBeTypeOf('number')
  })

  it('should serialize to JSON', () => {
    const error = new AppError('Resource not found', 'NOT_FOUND', 404, {
      context: { id: '123' },
    })
    const json = error.toJSON()
    expect(json.name).toBe('AppError')
    expect(json.message).toBe('Resource not found')
    expect(json.code).toBe('NOT_FOUND')
    expect(json.statusCode).toBe(404)
    expect(json.context).toEqual({ id: '123' })
    expect(json.metadata).toBeDefined()
  })

  it('should convert to user message', () => {
    const error = new AppError('Test error', 'INTERNAL_ERROR', 500)
    expect(error.toUserMessage()).toBe('Test error')
  })
})

describe('Specific Error Classes', () => {
  it('ValidationError should have correct defaults', () => {
    const error = new ValidationError('Invalid input')
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe('Invalid input')
  })

  it('NotFoundError should format message', () => {
    const error = new NotFoundError('User')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.statusCode).toBe(404)
    expect(error.message).toBe('User not found')
  })

  it('UnauthorizedError should have default message', () => {
    const error = new UnauthorizedError()
    expect(error.code).toBe('UNAUTHORIZED')
    expect(error.statusCode).toBe(401)
    expect(error.message).toBe('Unauthorized')
  })

  it('ForbiddenError should have default message', () => {
    const error = new ForbiddenError()
    expect(error.code).toBe('FORBIDDEN')
    expect(error.statusCode).toBe(403)
    expect(error.message).toBe('Forbidden')
  })

  it('ConflictError should accept custom message', () => {
    const error = new ConflictError('Resource already exists')
    expect(error.code).toBe('CONFLICT')
    expect(error.statusCode).toBe(409)
    expect(error.message).toBe('Resource already exists')
  })

  it('InternalError should have default message', () => {
    const error = new InternalError()
    expect(error.code).toBe('INTERNAL_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Internal server error')
  })

  it('ServiceUnavailableError should format message', () => {
    const error = new ServiceUnavailableError('Database')
    expect(error.code).toBe('SERVICE_UNAVAILABLE')
    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Database is unavailable')
  })

  it('TimeoutError should format message', () => {
    const error = new TimeoutError('API request')
    expect(error.code).toBe('TIMEOUT')
    expect(error.statusCode).toBe(408)
    expect(error.message).toBe('API request timed out')
  })

  it('RateLimitError should have default message', () => {
    const error = new RateLimitError()
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(error.statusCode).toBe(429)
    expect(error.message).toBe('Rate limit exceeded')
  })

  it('FileSystemError should accept custom message', () => {
    const error = new FileSystemError('File not found')
    expect(error.code).toBe('FILE_SYSTEM_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('File not found')
  })

  it('DatabaseError should accept custom message', () => {
    const error = new DatabaseError('Connection failed')
    expect(error.code).toBe('DATABASE_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Connection failed')
  })

  it('NetworkError should accept custom message', () => {
    const error = new NetworkError('Connection timeout')
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('Connection timeout')
  })
})

describe('createError', () => {
  it('should create error with default message', () => {
    const error = createError('NOT_FOUND')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.message).toBe('Resource not found')
    expect(error.statusCode).toBe(404)
  })

  it('should create error with custom message', () => {
    const error = createError('NOT_FOUND', 'User not found')
    expect(error.message).toBe('User not found')
  })

  it('should create error with context', () => {
    const error = createError('NOT_FOUND', 'User not found', {
      context: { userId: '123' },
    })
    expect(error.context).toEqual({ userId: '123' })
  })

  it('should include retryable metadata', () => {
    const error = createError('TIMEOUT')
    expect(error.metadata.retryable).toBe(true)
  })
})

describe('wrapError', () => {
  it('should return AppError as-is', () => {
    const original = new AppError('Test', 'INTERNAL_ERROR', 500)
    const wrapped = wrapError(original)
    expect(wrapped).toBe(original)
  })

  it('should wrap standard Error', () => {
    const original = new Error('Test error')
    const wrapped = wrapError(original)
    expect(wrapped).toBeInstanceOf(AppError)
    expect(wrapped.message).toBe('Test error')
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.cause).toBe(original)
  })

  it('should wrap unknown error', () => {
    const wrapped = wrapError('string error')
    expect(wrapped).toBeInstanceOf(AppError)
    expect(wrapped.message).toBe('string error')
    expect(wrapped.code).toBe('INTERNAL_ERROR')
  })

  it('should include context when wrapping', () => {
    const context = { operation: 'test' }
    const wrapped = wrapError(new Error('Test'), context)
    expect(wrapped.context).toEqual(context)
  })
})

describe('isAppError', () => {
  it('should return true for AppError', () => {
    const error = new AppError('Test', 'INTERNAL_ERROR', 500)
    expect(isAppError(error)).toBe(true)
  })

  it('should return true for error subclasses', () => {
    expect(isAppError(new ValidationError('Test'))).toBe(true)
    expect(isAppError(new NotFoundError('Resource'))).toBe(true)
  })

  it('should return false for regular Error', () => {
    const error = new Error('Test')
    expect(isAppError(error)).toBe(false)
  })

  it('should return false for non-error values', () => {
    expect(isAppError('string')).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError(undefined)).toBe(false)
    expect(isAppError({})).toBe(false)
  })
})

describe('getErrorMessage', () => {
  it('should extract message from Error', () => {
    const error = new Error('Test error')
    expect(getErrorMessage(error)).toBe('Test error')
  })

  it('should extract message from AppError', () => {
    const error = new AppError('App error', 'INTERNAL_ERROR', 500)
    expect(getErrorMessage(error)).toBe('App error')
  })

  it('should convert non-error to string', () => {
    expect(getErrorMessage('string')).toBe('string')
    expect(getErrorMessage(123)).toBe('123')
    expect(getErrorMessage(null)).toBe('null')
  })
})

describe('getErrorStack', () => {
  it('should extract stack from Error', () => {
    const error = new Error('Test')
    const stack = getErrorStack(error)
    expect(stack).toBeDefined()
    expect(stack).toContain('Error: Test')
  })

  it('should return undefined for non-error', () => {
    expect(getErrorStack('string')).toBeUndefined()
    expect(getErrorStack(null)).toBeUndefined()
  })
})

describe('formatErrorForLog', () => {
  it('should format AppError', () => {
    const error = new AppError('Test', 'INTERNAL_ERROR', 500, {
      context: { id: '123' },
    })
    const formatted = formatErrorForLog(error)
    expect(formatted.name).toBe('AppError')
    expect(formatted.message).toBe('Test')
    expect(formatted.code).toBe('INTERNAL_ERROR')
    expect(formatted.statusCode).toBe(500)
  })

  it('should format standard Error', () => {
    const error = new Error('Test error')
    const formatted = formatErrorForLog(error)
    expect(formatted.name).toBe('Error')
    expect(formatted.message).toBe('Test error')
    expect(formatted.stack).toBeDefined()
  })

  it('should format unknown error', () => {
    const formatted = formatErrorForLog('string error')
    expect(formatted.error).toBe('string error')
  })
})
