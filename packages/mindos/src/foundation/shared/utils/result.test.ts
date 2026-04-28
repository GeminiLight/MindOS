/**
 * Tests for Result type utilities
 */

import { describe, it, expect } from 'vitest'
import { ok, err, isOk, isErr, unwrap, unwrapOr, map, mapErr, andThen, tryCatch, tryCatchSync } from './result.js'

describe('Result', () => {
  describe('ok', () => {
    it('should create a successful result', () => {
      const result = ok(42)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe(42)
      }
    })
  })

  describe('err', () => {
    it('should create an error result', () => {
      const error = new Error('test error')
      const result = err(error)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(error)
      }
    })
  })

  describe('isOk', () => {
    it('should return true for ok result', () => {
      expect(isOk(ok(42))).toBe(true)
    })

    it('should return false for err result', () => {
      expect(isOk(err(new Error()))).toBe(false)
    })
  })

  describe('isErr', () => {
    it('should return true for err result', () => {
      expect(isErr(err(new Error()))).toBe(true)
    })

    it('should return false for ok result', () => {
      expect(isErr(ok(42))).toBe(false)
    })
  })

  describe('unwrap', () => {
    it('should return value for ok result', () => {
      expect(unwrap(ok(42))).toBe(42)
    })

    it('should throw for err result', () => {
      const error = new Error('test error')
      expect(() => unwrap(err(error))).toThrow(error)
    })
  })

  describe('unwrapOr', () => {
    it('should return value for ok result', () => {
      expect(unwrapOr(ok(42), 0)).toBe(42)
    })

    it('should return default for err result', () => {
      expect(unwrapOr(err(new Error()), 0)).toBe(0)
    })
  })

  describe('map', () => {
    it('should transform ok value', () => {
      const result = map(ok(42), (x) => x * 2)
      expect(result).toEqual(ok(84))
    })

    it('should pass through error', () => {
      const error = new Error('test')
      const result = map(err(error), (x: number) => x * 2)
      expect(result).toEqual(err(error))
    })
  })

  describe('mapErr', () => {
    it('should pass through ok value', () => {
      const result = mapErr(ok(42), (e) => new Error('mapped'))
      expect(result).toEqual(ok(42))
    })

    it('should transform error', () => {
      const result = mapErr(err(new Error('original')), (e) => new Error('mapped'))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toBe('mapped')
      }
    })
  })

  describe('andThen', () => {
    it('should chain ok results', () => {
      const result = andThen(ok(42), (x) => ok(x * 2))
      expect(result).toEqual(ok(84))
    })

    it('should short-circuit on error', () => {
      const error = new Error('test')
      const result = andThen(err(error), (x: number) => ok(x * 2))
      expect(result).toEqual(err(error))
    })

    it('should propagate error from callback', () => {
      const error = new Error('callback error')
      const result = andThen(ok(42), () => err(error))
      expect(result).toEqual(err(error))
    })
  })

  describe('tryCatch', () => {
    it('should return ok for successful async function', async () => {
      const result = await tryCatch(async () => 42)
      expect(result).toEqual(ok(42))
    })

    it('should return err for failed async function', async () => {
      const error = new Error('async error')
      const result = await tryCatch(async () => {
        throw error
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(error)
      }
    })

    it('should wrap non-Error throws', async () => {
      const result = await tryCatch(async () => {
        throw 'string error'
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error.message).toBe('string error')
      }
    })
  })

  describe('tryCatchSync', () => {
    it('should return ok for successful sync function', () => {
      const result = tryCatchSync(() => 42)
      expect(result).toEqual(ok(42))
    })

    it('should return err for failed sync function', () => {
      const error = new Error('sync error')
      const result = tryCatchSync(() => {
        throw error
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(error)
      }
    })

    it('should wrap non-Error throws', () => {
      const result = tryCatchSync(() => {
        throw 'string error'
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error.message).toBe('string error')
      }
    })
  })
})
