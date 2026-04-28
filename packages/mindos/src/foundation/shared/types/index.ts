/**
 * Common types used across MindOS packages
 */

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>

/**
 * Optional type helper
 */
export type Optional<T> = T | null | undefined

/**
 * JSON-serializable types
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Deep partial type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Deep readonly type
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}

/**
 * Timestamp in milliseconds
 */
export type Timestamp = number

/**
 * ISO 8601 date string
 */
export type ISODateString = string

/**
 * UUID string
 */
export type UUID = string

/**
 * File path string
 */
export type FilePath = string

/**
 * URL string
 */
export type URLString = string

export * from './workspace.js'
export * from './document.js'
export * from './search.js'
