/**
 * Logger factory
 */

import type { Logger, LoggerConfig } from './types.js'
import { PinoLoggerAdapter } from './logger.js'

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  pretty: process.env.NODE_ENV !== 'production',
  console: true,
}

/**
 * Create a logger instance
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  const finalConfig: LoggerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  }

  return new PinoLoggerAdapter(finalConfig)
}

/**
 * Global logger instance
 */
let globalLogger: Logger | undefined

/**
 * Get or create global logger
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = createLogger()
  }
  return globalLogger
}

/**
 * Set global logger
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger
}
