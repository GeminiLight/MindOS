/**
 * Logger implementation using Pino
 */

import pino from 'pino'
import type { Logger as PinoLogger } from 'pino'
import type { Logger, LogContext, LoggerConfig } from './types.js'
import { formatErrorForLog } from '../errors/index.js'

/**
 * Pino-based logger implementation
 */
export class PinoLoggerAdapter implements Logger {
  private readonly pinoLogger: PinoLogger

  constructor(config: LoggerConfig, baseContext?: LogContext) {
    const options: pino.LoggerOptions = {
      level: config.level,
      redact: config.redact ?? ['password', 'token', 'apiKey', 'secret'],
      base: baseContext,
    }

    // Create transport for pretty printing or file output
    const targets: pino.TransportTargetOptions[] = []

    if (config.console) {
      if (config.pretty) {
        targets.push({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        })
      } else {
        targets.push({
          target: 'pino/file',
          options: { destination: 1 }, // stdout
        })
      }
    }

    if (config.file) {
      targets.push({
        target: 'pino/file',
        options: { destination: config.file },
      })
    }

    if (targets.length > 0) {
      this.pinoLogger = pino(options, pino.transport({ targets }))
    } else {
      this.pinoLogger = pino(options)
    }
  }

  trace(message: string, context?: LogContext): void {
    this.pinoLogger.trace(context ?? {}, message)
  }

  debug(message: string, context?: LogContext): void {
    this.pinoLogger.debug(context ?? {}, message)
  }

  info(message: string, context?: LogContext): void {
    this.pinoLogger.info(context ?? {}, message)
  }

  warn(message: string, context?: LogContext): void {
    this.pinoLogger.warn(context ?? {}, message)
  }

  error(message: string, error?: Error, context?: LogContext): void {
    const ctx = {
      ...context,
      ...(error ? { error: formatErrorForLog(error) } : {}),
    }
    this.pinoLogger.error(ctx, message)
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    const ctx = {
      ...context,
      ...(error ? { error: formatErrorForLog(error) } : {}),
    }
    this.pinoLogger.fatal(ctx, message)
  }

  child(context: LogContext): Logger {
    const childPino = this.pinoLogger.child(context)
    return new PinoLoggerAdapter(
      {
        level: this.pinoLogger.level as any,
        pretty: false,
        console: true,
      },
      context
    )
  }
}
