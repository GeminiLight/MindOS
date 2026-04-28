/**
 * Tests for PinoLoggerAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PinoLoggerAdapter } from './logger.js'
import type { LoggerConfig } from './types.js'
import { Writable } from 'stream'

class MemoryStream extends Writable {
  public logs: any[] = []

  _write(chunk: any, encoding: string, callback: () => void): void {
    try {
      const log = JSON.parse(chunk.toString())
      this.logs.push(log)
    } catch (e) {
      // Ignore parse errors
    }
    callback()
  }

  clear(): void {
    this.logs = []
  }
}

describe('PinoLoggerAdapter', () => {
  let stream: MemoryStream
  let logger: PinoLoggerAdapter

  beforeEach(() => {
    stream = new MemoryStream()
    const config: LoggerConfig = {
      level: 'debug',
      pretty: false,
      console: false,
    }
    // Create logger without transport to avoid async issues
    logger = new PinoLoggerAdapter(config)
  })

  it('should create logger instance', () => {
    expect(logger).toBeDefined()
    expect(logger.debug).toBeInstanceOf(Function)
    expect(logger.info).toBeInstanceOf(Function)
    expect(logger.warn).toBeInstanceOf(Function)
    expect(logger.error).toBeInstanceOf(Function)
  })

  it('should have trace method', () => {
    expect(() => logger.trace('Trace message')).not.toThrow()
  })

  it('should have debug method', () => {
    expect(() => logger.debug('Debug message')).not.toThrow()
  })

  it('should have info method', () => {
    expect(() => logger.info('Info message')).not.toThrow()
  })

  it('should have warn method', () => {
    expect(() => logger.warn('Warning message')).not.toThrow()
  })

  it('should have error method', () => {
    expect(() => logger.error('Error message')).not.toThrow()
  })

  it('should have fatal method', () => {
    expect(() => logger.fatal('Fatal message')).not.toThrow()
  })

  it('should accept context in log methods', () => {
    expect(() => logger.info('Message', { userId: '123' })).not.toThrow()
    expect(() => logger.debug('Message', { requestId: 'abc' })).not.toThrow()
  })

  it('should accept error in error method', () => {
    const error = new Error('Test error')
    expect(() => logger.error('Error occurred', error)).not.toThrow()
  })

  it('should accept error and context in error method', () => {
    const error = new Error('Test error')
    expect(() => logger.error('Error occurred', error, { userId: '123' })).not.toThrow()
  })

  it('should create child logger', () => {
    const child = logger.child({ module: 'auth' })
    expect(child).toBeDefined()
    expect(child.info).toBeInstanceOf(Function)
  })

  it('should allow child logger to log', () => {
    const child = logger.child({ module: 'auth' })
    expect(() => child.info('Auth event')).not.toThrow()
  })

  it('should support different log levels in config', () => {
    const infoLogger = new PinoLoggerAdapter({
      level: 'info',
      pretty: false,
      console: false,
    })
    expect(infoLogger).toBeDefined()

    const warnLogger = new PinoLoggerAdapter({
      level: 'warn',
      pretty: false,
      console: false,
    })
    expect(warnLogger).toBeDefined()
  })

  it('should support pretty printing config', () => {
    const prettyLogger = new PinoLoggerAdapter({
      level: 'info',
      pretty: true,
      console: true,
    })
    expect(prettyLogger).toBeDefined()
  })

  it('should support file output config', () => {
    const fileLogger = new PinoLoggerAdapter({
      level: 'info',
      pretty: false,
      console: false,
      file: '/tmp/test.log',
    })
    expect(fileLogger).toBeDefined()
  })

  it('should support custom redact fields', () => {
    const redactLogger = new PinoLoggerAdapter({
      level: 'info',
      pretty: false,
      console: false,
      redact: ['password', 'secret', 'apiKey'],
    })
    expect(redactLogger).toBeDefined()
  })

  it('should handle empty context', () => {
    expect(() => logger.info('Message', {})).not.toThrow()
  })

  it('should handle undefined context', () => {
    expect(() => logger.info('Message', undefined)).not.toThrow()
  })

  it('should handle complex context objects', () => {
    const context = {
      userId: '123',
      requestId: 'abc',
      metadata: {
        ip: '127.0.0.1',
        userAgent: 'test',
      },
    }
    expect(() => logger.info('Message', context)).not.toThrow()
  })
})

describe('Logger configuration', () => {
  it('should create logger with minimal config', () => {
    const logger = new PinoLoggerAdapter({
      level: 'info',
      pretty: false,
      console: false,
    })
    expect(logger).toBeDefined()
  })

  it('should create logger with all options', () => {
    const logger = new PinoLoggerAdapter({
      level: 'debug',
      pretty: true,
      console: true,
      file: '/tmp/test.log',
      redact: ['password'],
    })
    expect(logger).toBeDefined()
  })

  it('should support all log levels', () => {
    const levels: Array<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = [
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]

    levels.forEach((level) => {
      const logger = new PinoLoggerAdapter({
        level,
        pretty: false,
        console: false,
      })
      expect(logger).toBeDefined()
    })
  })
})
