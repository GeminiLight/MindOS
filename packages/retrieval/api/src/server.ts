import express, { type Express } from 'express'
import cors from 'cors'
import type { Server } from 'http'
import type { ApiConfig, ApiContext } from './types.js'
import { errorHandler, notFoundHandler } from './middleware.js'
import { createSearchRouter } from './routes/search.js'
import { createIndexRouter } from './routes/index.js'
import { ok, err, type Result } from '@geminilight/mindos/foundation'
import { createError } from '@geminilight/mindos/foundation'

export class ApiServer {
  private app: Express
  private server?: Server
  private config: ApiConfig
  private ctx: ApiContext

  constructor(config: ApiConfig, ctx: ApiContext) {
    this.config = config
    this.ctx = ctx
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandlers()
  }

  private setupMiddleware() {
    // Body parsing
    this.app.use(express.json())
    this.app.use(express.urlencoded({ extended: true }))

    // CORS
    if (this.config.cors.enabled) {
      this.app.use(
        cors({
          origin: this.config.cors.origins,
          credentials: true,
        })
      )
    }

    // Request logging
    this.app.use((req, res, next) => {
      this.ctx.logger.debug('API request', {
        method: req.method,
        path: req.path,
        query: req.query,
      })
      next()
    })
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() })
    })

    // API routes
    this.app.use('/api/search', createSearchRouter(this.ctx))
    this.app.use('/api/index', createIndexRouter(this.ctx))
  }

  private setupErrorHandlers() {
    this.app.use(notFoundHandler)
    this.app.use(errorHandler(this.ctx.logger))
  }

  async start(): Promise<Result<void>> {
    try {
      return new Promise((resolve) => {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.ctx.logger.info('API server started', {
            host: this.config.host,
            port: this.config.port,
          })
          resolve(ok(undefined))
        })
      })
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR', 'Failed to start API server', {
          cause: error as Error,
        })
      )
    }
  }

  async stop(): Promise<Result<void>> {
    try {
      if (this.server) {
        return new Promise((resolve) => {
          this.server!.close(() => {
            this.ctx.logger.info('API server stopped')
            resolve(ok(undefined))
          })
        })
      }
      return ok(undefined)
    } catch (error) {
      return err(
        createError('INTERNAL_ERROR', 'Failed to stop API server', {
          cause: error as Error,
        })
      )
    }
  }

  getApp(): Express {
    return this.app
  }
}
