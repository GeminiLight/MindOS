/**
 * Result type utilities
 */

import type { Result, AsyncResult } from '../types/index.js'

/**
 * Create a successful result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

/**
 * Create a failed result
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/**
 * Check if result is successful
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok === true
}

/**
 * Check if result is failed
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return result.ok === false
}

/**
 * Unwrap result value or throw error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value
  }
  throw result.error
}

/**
 * Unwrap result value or return default
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue
}

/**
 * Map result value
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}

/**
 * Map result error
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  return result.ok ? result : err(fn(result.error))
}

/**
 * Chain result operations
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return result.ok ? fn(result.value) : result
}

/**
 * Wrap async function to return Result
 */
export async function tryCatch<T>(
  fn: () => Promise<T>
): AsyncResult<T, Error> {
  try {
    const value = await fn()
    return ok(value)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Wrap sync function to return Result
 */
export function tryCatchSync<T>(fn: () => T): Result<T, Error> {
  try {
    const value = fn()
    return ok(value)
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
