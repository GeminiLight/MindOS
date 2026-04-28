import { Router } from 'express'
import { z } from 'zod'
import type { ApiContext, SearchRequest, SearchResponse } from '../types.js'
import { asyncHandler } from '../middleware.js'

const searchSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional().default(10),
  offset: z.number().int().nonnegative().optional().default(0),
  filters: z.record(z.any()).optional(),
})

export function createSearchRouter(ctx: ApiContext): Router {
  const router = Router()

  router.post(
    '/search',
    asyncHandler(async (req, res) => {
      const startTime = Date.now()
      const body = searchSchema.parse(req.body)

      const result = await ctx.search.search(body.query, {
        limit: body.limit,
        offset: body.offset,
      })

      if (!result.ok) {
        return res.status(500).json({
          error: 'SEARCH_FAILED',
          message: result.error.message,
        })
      }

      const response: SearchResponse = {
        results: result.value.items.map((item) => ({
          id: item.document.id,
          content: item.document.content,
          score: item.score,
          metadata: item.document.metadata || {},
        })),
        total: result.value.total,
        took: Date.now() - startTime,
      }

      res.json(response)
    })
  )

  router.post(
    '/vector-search',
    asyncHandler(async (req, res) => {
      const startTime = Date.now()
      const { query, limit = 10, filter } = req.body

      if (!query || typeof query !== 'string') {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Query is required',
        })
      }

      // For now, return empty results as we need embedding service
      const response: SearchResponse = {
        results: [],
        total: 0,
        took: Date.now() - startTime,
      }

      res.json(response)
    })
  )

  return router
}
