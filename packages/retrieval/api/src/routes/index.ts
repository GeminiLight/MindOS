import { Router } from 'express'
import { z } from 'zod'
import type { ApiContext, IndexRequest, IndexResponse } from '../types.js'
import { asyncHandler } from '../middleware.js'

const indexSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional().default(true),
})

export function createIndexRouter(ctx: ApiContext): Router {
  const router = Router()

  router.post(
    '/index',
    asyncHandler(async (req, res) => {
      const body = indexSchema.parse(req.body)
      const startTime = Date.now()

      const result = await ctx.indexer.start()

      if (!result.ok) {
        return res.status(500).json({
          error: 'INDEX_FAILED',
          message: result.error.message,
        })
      }

      const stats = ctx.indexer.getStats()
      const response: IndexResponse = {
        indexed: stats.totalFiles,
        failed: 0,
        duration: Date.now() - startTime,
      }

      res.json(response)
    })
  )

  router.get(
    '/stats',
    asyncHandler(async (req, res) => {
      const stats = ctx.indexer.getStats()
      res.json(stats)
    })
  )

  router.post(
    '/reindex',
    asyncHandler(async (req, res) => {
      const startTime = Date.now()

      // Clear existing indexes
      await ctx.search.clear()
      await ctx.vector.clear()

      // Rebuild index
      const result = await ctx.indexer.start()

      if (!result.ok) {
        return res.status(500).json({
          error: 'REINDEX_FAILED',
          message: result.error.message,
        })
      }

      const stats = ctx.indexer.getStats()
      const response: IndexResponse = {
        indexed: stats.totalFiles,
        failed: 0,
        duration: Date.now() - startTime,
      }

      res.json(response)
    })
  )

  return router
}
