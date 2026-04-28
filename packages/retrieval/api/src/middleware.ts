import type { Request, Response, NextFunction } from 'express'
import { createError } from '@geminilight/mindos/foundation'
import type { Logger } from '@geminilight/mindos/foundation'
import type { ErrorResponse } from './types.js'

export function errorHandler(logger: Logger) {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('API error', err instanceof Error ? err : new Error(err.message), { path: req.path })

    const statusCode = err.statusCode || 500
    const response: ErrorResponse = {
      error: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: err.details,
    }

    res.status(statusCode).json(response)
  }
}

export function notFoundHandler(req: Request, res: Response) {
  const response: ErrorResponse = {
    error: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found`,
  }
  res.status(404).json(response)
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
