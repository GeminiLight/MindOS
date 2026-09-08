/**
 * Tests for JsonLoggerAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { JsonLoggerAdapter, PinoLoggerAdapter } from './logger.js'
import { createLogger } from './factory.js'
import type { LoggerConfig } from './types.js'
import { Writable } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

class MemoryStream extends Writable {
  public lines: string[] = []

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.lines.push(chunk.toString())
    callback()
  }

  json(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

class ThrowingStream extends Writable {
  _write(): void {
    throw new Error('sink exploded')
  }
}

function config(overrides: Partial<LoggerConfig> = {}): LoggerConfig {
  return { level: 'debug', pretty: false, console: false, ...overrides }
}

describe('JsonLoggerAdapter', () => {
  let stream: MemoryStream
  let logger: JsonLoggerAdapter

  beforeEach(() => {
    stream = new MemoryStream()
    logger = new JsonLoggerAdapter(config({ stream }))
  })

  it('writes one JSON object per line with level, time, message and context', () => {
    logger.info('hello', { userId: '123' })

    expect(stream.lines).toHaveLength(1)
    expect(stream.lines[0].endsWith('\n')).toBe(true)
    const [record] = stream.json()
    expect(record).toMatchObject({ level: 'info', msg: 'hello', userId: '123' })
    expect(typeof record.time).toBe('string')
    expect(Number.isNaN(Date.parse(record.time as string))).toBe(false)
  })

  it('exposes every log level', () => {
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    logger.fatal('f')

    expect(stream.json().map((record) => record.level)).toEqual(['debug', 'info', 'warn', 'error', 'fatal'])
  })

  it('filters records below the configured level', () => {
    const warnLogger = new JsonLoggerAdapter(config({ level: 'warn', stream }))
    warnLogger.debug('dropped')
    warnLogger.info('dropped')
    warnLogger.warn('kept')
    warnLogger.error('kept too')

    expect(stream.json().map((record) => record.msg)).toEqual(['kept', 'kept too'])
    expect(warnLogger.isLevelEnabled('info')).toBe(false)
    expect(warnLogger.isLevelEnabled('warn')).toBe(true)
  })

  it('writes nothing at level silent', () => {
    const silent = new JsonLoggerAdapter(config({ level: 'silent', stream }))
    silent.fatal('nope')
    expect(stream.lines).toEqual([])
    expect(silent.isLevelEnabled('fatal')).toBe(false)
  })

  it('serializes the error passed to error() and fatal()', () => {
    const error = new Error('boom')
    logger.error('failed', error, { requestId: 'r-1' })
    logger.fatal('dead', error)

    const [first, second] = stream.json()
    expect(first).toMatchObject({ level: 'error', msg: 'failed', requestId: 'r-1' })
    expect(JSON.stringify(first.error)).toContain('boom')
    expect(second).toMatchObject({ level: 'fatal', msg: 'dead' })
    expect(second.error).toBeDefined()
  })

  it('redacts default sensitive keys at any depth', () => {
    logger.info('login', { password: 'p', nested: { apiKey: 'k', keep: 'v' }, list: [{ token: 't' }] })

    const [record] = stream.json()
    expect(record.password).toBe('[Redacted]')
    expect(record.nested).toEqual({ apiKey: '[Redacted]', keep: 'v' })
    expect(record.list).toEqual([{ token: '[Redacted]' }])
  })

  it('honours a custom redact list', () => {
    const custom = new JsonLoggerAdapter(config({ stream, redact: ['ssn'] }))
    custom.info('x', { ssn: '1', password: 'visible' })

    const [record] = stream.json()
    expect(record.ssn).toBe('[Redacted]')
    expect(record.password).toBe('visible')
  })

  it('handles empty, undefined and nested context objects', () => {
    expect(() => logger.info('a', {})).not.toThrow()
    expect(() => logger.info('b', undefined)).not.toThrow()
    logger.info('c', { metadata: { ip: '127.0.0.1', userAgent: 'test' } })

    const records = stream.json()
    expect(records).toHaveLength(3)
    expect(records[2].metadata).toEqual({ ip: '127.0.0.1', userAgent: 'test' })
  })

  it('never throws when the sink fails', () => {
    const broken = new JsonLoggerAdapter(config({ stream: new ThrowingStream() }))
    expect(() => broken.info('still fine')).not.toThrow()
  })

  it('writes nothing when console, file and stream are all off', () => {
    const quiet = new JsonLoggerAdapter(config())
    expect(() => quiet.info('nowhere')).not.toThrow()
  })

  it('appends JSON lines to the configured file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindos-logger-'))
    const file = join(dir, 'app.log')
    try {
      const fileLogger = new JsonLoggerAdapter(config({ file }))
      fileLogger.info('to file', { n: 1 })
      fileLogger.warn('again')
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const lines = readFileSync(file, 'utf8').trim().split('\n')
          expect(lines).toHaveLength(2)
          expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', msg: 'to file', n: 1 })
          expect(JSON.parse(lines[1])).toMatchObject({ level: 'warn', msg: 'again' })
          rmSync(dir, { recursive: true, force: true })
          resolve()
        }, 50)
      })
    } catch (error) {
      rmSync(dir, { recursive: true, force: true })
      throw error
    }
  })

  it('formats a readable line in pretty mode', () => {
    const pretty = new JsonLoggerAdapter(config({ pretty: true, stream }))
    pretty.warn('careful', { code: 7 })

    expect(stream.lines).toHaveLength(1)
    const line = stream.lines[0]
    expect(() => JSON.parse(line)).toThrow()
    expect(line).toContain('WARN')
    expect(line).toContain('careful')
    expect(line).toContain('"code":7')
    expect(line).not.toContain('[')
  })

  it('accepts the pretty + console config used by the default factory without writing to the test stream', () => {
    const consoleLogger = new JsonLoggerAdapter(config({ level: 'silent', pretty: true, console: true }))
    expect(() => consoleLogger.info('suppressed by level')).not.toThrow()
  })
})

describe('JsonLoggerAdapter.child', () => {
  it('merges bindings, shares the parent sink and keeps the parent bindings intact', () => {
    const stream = new MemoryStream()
    const parent = new JsonLoggerAdapter(config({ stream }), { service: 'test' })
    const child = parent.child({ requestId: 'r-1' }) as JsonLoggerAdapter
    const grandchild = child.child({ step: 2 }) as JsonLoggerAdapter

    expect(child).not.toBe(parent)
    expect(parent.bindings()).toEqual({ service: 'test' })
    expect(child.bindings()).toEqual({ service: 'test', requestId: 'r-1' })
    expect(grandchild.bindings()).toEqual({ service: 'test', requestId: 'r-1', step: 2 })

    grandchild.info('hello from grandchild', { extra: true })
    const records = stream.json()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ service: 'test', requestId: 'r-1', step: 2, extra: true, msg: 'hello from grandchild' })
  })

  it('lets call-site context override inherited bindings', () => {
    const stream = new MemoryStream()
    const child = new JsonLoggerAdapter(config({ stream }), { requestId: 'parent' }).child({ requestId: 'child' })
    child.info('x', { requestId: 'call' })
    expect(stream.json()[0].requestId).toBe('call')
  })

  it('inherits the parent level filter', () => {
    const stream = new MemoryStream()
    const child = new JsonLoggerAdapter(config({ level: 'error', stream })).child({ module: 'auth' })
    child.info('dropped')
    child.error('kept')
    expect(stream.json().map((record) => record.msg)).toEqual(['kept'])
  })
})

describe('Logger configuration', () => {
  it('supports all log levels in config', () => {
    const levels: Array<LoggerConfig['level']> = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
    for (const level of levels) {
      expect(new JsonLoggerAdapter(config({ level }))).toBeDefined()
    }
  })

  it('falls back to info when an unknown level is passed at runtime', () => {
    const stream = new MemoryStream()
    const weird = new JsonLoggerAdapter(config({ level: 'loud' as LoggerConfig['level'], stream }))
    weird.debug('dropped')
    weird.info('kept')
    expect(stream.json().map((record) => record.msg)).toEqual(['kept'])
  })

  it('keeps the PinoLoggerAdapter name as an alias', () => {
    expect(PinoLoggerAdapter).toBe(JsonLoggerAdapter)
  })

  it('createLogger merges partial config over defaults and returns a working logger', () => {
    const stream = new MemoryStream()
    const logger = createLogger({ console: false, pretty: false, stream, level: 'info' })
    logger.debug('dropped')
    logger.info('kept')
    expect(stream.json().map((record) => record.msg)).toEqual(['kept'])
  })
})
