import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { errorHandler, notFoundHandler, asyncHandler } from './middleware.js'
import type { Logger } from '@geminilight/mindos/foundation'

describe('Middleware', () => {
  describe('errorHandler', () => {
    it('should handle errors with status code', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
      } as any

      const err = {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      }

      const req = { path: '/api/test' } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn() as NextFunction

      const handler = errorHandler(mockLogger)
      handler(err, req, res, next)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'API error',
        expect.any(Error),
        { path: '/api/test' }
      )
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      })
    })

    it('should use default status code 500', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
      } as any

      const err = {
        message: 'Something went wrong',
      }

      const req = { path: '/api/test' } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn() as NextFunction

      const handler = errorHandler(mockLogger)
      handler(err, req, res, next)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        error: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        details: undefined,
      })
    })

    it('should handle Error instances', () => {
      const mockLogger: Logger = {
        error: vi.fn(),
      } as any

      const err = new Error('Test error')

      const req = { path: '/api/test' } as Request
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any
      const next = vi.fn() as NextFunction

      const handler = errorHandler(mockLogger)
      handler(err, req, res, next)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'API error',
        err,
        { path: '/api/test' }
      )
    })
  })

  describe('notFoundHandler', () => {
    it('should return 404 with route information', () => {
      const req = {
        method: 'GET',
        path: '/api/unknown',
      } as Request

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any

      notFoundHandler(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        error: 'NOT_FOUND',
        message: 'Route GET /api/unknown not found',
      })
    })

    it('should handle POST requests', () => {
      const req = {
        method: 'POST',
        path: '/api/missing',
      } as Request

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any

      notFoundHandler(req, res)

      expect(res.json).toHaveBeenCalledWith({
        error: 'NOT_FOUND',
        message: 'Route POST /api/missing not found',
      })
    })
  })

  describe('asyncHandler', () => {
    it('should handle successful async functions', async () => {
      const fn = vi.fn().mockResolvedValue(undefined)
      const req = {} as Request
      const res = {} as Response
      const next = vi.fn() as NextFunction

      const handler = asyncHandler(fn)
      await handler(req, res, next)

      expect(fn).toHaveBeenCalledWith(req, res, next)
      expect(next).not.toHaveBeenCalled()
    })

    it('should catch and forward errors', async () => {
      const error = new Error('Async error')
      const fn = vi.fn().mockRejectedValue(error)
      const req = {} as Request
      const res = {} as Response
      const next = vi.fn() as NextFunction

      const handler = asyncHandler(fn)
      await handler(req, res, next)

      expect(fn).toHaveBeenCalledWith(req, res, next)
      expect(next).toHaveBeenCalledWith(error)
    })

    it('should handle synchronous errors', async () => {
      const error = new Error('Sync error')
      const fn = async () => {
        throw error
      }
      const req = {} as Request
      const res = {} as Response
      const next = vi.fn() as NextFunction

      const handler = asyncHandler(fn)
      await handler(req, res, next)

      expect(next).toHaveBeenCalledWith(error)
    })

    it('should handle functions that return values', async () => {
      const fn = vi.fn().mockResolvedValue({ data: 'test' })
      const req = {} as Request
      const res = {} as Response
      const next = vi.fn() as NextFunction

      const handler = asyncHandler(fn)
      await handler(req, res, next)

      expect(fn).toHaveBeenCalledWith(req, res, next)
      expect(next).not.toHaveBeenCalled()
    })
  })
})
