/**
 * Dependency-free structured logger.
 *
 * Writes one JSON object per line to stdout, a caller-provided stream and/or a
 * file. `child()` merges bindings and shares the parent's sink, so a deep
 * child tree never opens extra streams. `pretty` switches to a human readable
 * line format for terminals. The adapter never throws from a log call: a
 * failing sink is swallowed because logging must not take the process down.
 */

import { createWriteStream } from 'node:fs'
import type { Logger, LogContext, LoggerConfig, LogLevel } from './types.js'
import { formatErrorForLog } from '../errors/index.js'

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
}

const DEFAULT_REDACT = ['password', 'token', 'apiKey', 'secret']
const REDACTED = '[Redacted]'

const LEVEL_COLORS: Record<Exclude<LogLevel, 'silent'>, string> = {
  trace: '[90m',
  debug: '[34m',
  info: '[32m',
  warn: '[33m',
  error: '[31m',
  fatal: '[35m',
}
const RESET = '[0m'

/**
 * Serialized log record (one JSON line).
 */
export interface LogRecord {
  level: Exclude<LogLevel, 'silent'>
  time: string
  msg: string
  [key: string]: unknown
}

/**
 * Where records go. Shared between a logger and all of its children.
 */
class LogSink {
  private readonly streams: NodeJS.WritableStream[]
  private readonly pretty: boolean

  constructor(config: LoggerConfig) {
    const streams: NodeJS.WritableStream[] = []
    if (config.stream) streams.push(config.stream)
    if (config.console) streams.push(process.stdout)
    if (config.file) {
      try {
        streams.push(createWriteStream(config.file, { flags: 'a' }))
      } catch {
        // A logger that cannot open its file must not stop the caller.
      }
    }
    this.streams = streams
    this.pretty = config.pretty
  }

  write(record: LogRecord): void {
    if (this.streams.length === 0) return
    for (const stream of this.streams) {
      try {
        const line = this.pretty ? formatPretty(record, isTty(stream)) : `${JSON.stringify(record)}\n`
        stream.write(line)
      } catch {
        // Swallow sink failures: logging is best effort.
      }
    }
  }
}

function isTty(stream: NodeJS.WritableStream): boolean {
  return Boolean((stream as { isTTY?: boolean }).isTTY)
}

function formatPretty(record: LogRecord, color: boolean): string {
  const { level, time, msg, ...rest } = record
  const label = level.toUpperCase().padEnd(5)
  const coloredLabel = color ? `${LEVEL_COLORS[level]}${label}${RESET}` : label
  const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `${time} ${coloredLabel} ${msg}${extra}\n`
}

function redactValue(value: unknown, keys: ReadonlySet<string>, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys, depth + 1))
  if (value instanceof Date) return value.toISOString()
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = keys.has(key) ? REDACTED : redactValue(entry, keys, depth + 1)
  }
  return out
}

/**
 * JSON-lines logger implementation
 */
export class JsonLoggerAdapter implements Logger {
  private readonly config: LoggerConfig
  private readonly baseContext: LogContext
  private readonly sink: LogSink
  private readonly redactKeys: ReadonlySet<string>
  private readonly threshold: number

  constructor(config: LoggerConfig, baseContext?: LogContext, sink?: LogSink) {
    this.config = config
    this.baseContext = { ...(baseContext ?? {}) }
    this.sink = sink ?? new LogSink(config)
    this.redactKeys = new Set(config.redact ?? DEFAULT_REDACT)
    this.threshold = LEVEL_VALUES[config.level] ?? LEVEL_VALUES.info
  }

  /** Bindings inherited by every record this logger writes. */
  bindings(): LogContext {
    return { ...this.baseContext }
  }

  /** Whether a record at `level` would be written. */
  isLevelEnabled(level: LogLevel): boolean {
    return LEVEL_VALUES[level] >= this.threshold && level !== 'silent'
  }

  trace(message: string, context?: LogContext): void {
    this.write('trace', message, context)
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context)
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context)
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.write('error', message, withError(context, error))
  }

  fatal(message: string, error?: Error, context?: LogContext): void {
    this.write('fatal', message, withError(context, error))
  }

  child(context: LogContext): Logger {
    return new JsonLoggerAdapter(this.config, { ...this.baseContext, ...context }, this.sink)
  }

  private write(level: Exclude<LogLevel, 'silent'>, message: string, context?: LogContext): void {
    if (!this.isLevelEnabled(level)) return
    try {
      const fields = redactValue({ ...this.baseContext, ...(context ?? {}) }, this.redactKeys) as Record<string, unknown>
      const record: LogRecord = {
        level,
        time: new Date().toISOString(),
        ...fields,
        msg: String(message),
      }
      this.sink.write(record)
    } catch {
      // Never let logging throw into the caller.
    }
  }
}

function withError(context: LogContext | undefined, error: Error | undefined): LogContext | undefined {
  if (!error) return context
  return { ...(context ?? {}), error: formatErrorForLog(error) }
}

/**
 * Backwards-compatible name for the previous pino-based adapter.
 * @deprecated use {@link JsonLoggerAdapter}
 */
export const PinoLoggerAdapter = JsonLoggerAdapter
export type PinoLoggerAdapter = JsonLoggerAdapter
