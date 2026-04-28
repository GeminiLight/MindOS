/**
 * Logger types and interfaces
 */

/**
 * Log level
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Log context
 */
export interface LogContext {
  /** Request ID */
  requestId?: string
  /** User ID */
  userId?: string
  /** Operation name */
  operation?: string
  /** Additional context */
  [key: string]: unknown
}

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Log trace message
   */
  trace(message: string, context?: LogContext): void

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: LogContext): void

  /**
   * Log fatal message
   */
  fatal(message: string, error?: Error, context?: LogContext): void

  /**
   * Create child logger with additional context
   */
  child(context: LogContext): Logger
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Log level */
  level: LogLevel
  /** Enable pretty printing */
  pretty: boolean
  /** Log file path */
  file?: string
  /** Enable console output */
  console: boolean
  /** Redact sensitive fields */
  redact?: string[]
}
