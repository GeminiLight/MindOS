import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { ApiServer } from './server.js'
import type { ApiConfig, ApiContext } from './types.js'
import { ok, err } from '@geminilight/mindos/foundation'
import { createError } from '@geminilight/mindos/foundation'

describe('ApiServer', () => {
  let config: ApiConfig
  let mockCtx: ApiContext

  beforeEach(() => {
    config = {
      port: 3000,
      host: 'localhost',
      cors: {
        enabled: true,
        origins: ['http://localhost:3000'],
      },
      rateLimit: {
        enabled: false,
        windowMs: 60000,
        maxRequests: 100,
      },
    }

    mockCtx = {
      indexer: {
        start: vi.fn().mockResolvedValue(ok(undefined)),
        getStats: vi.fn().mockReturnValue({
          totalFiles: 10,
          totalSize: 1024,
          lastIndexedAt: new Date(),
        }),
      } as any,
      search: {
        search: vi.fn().mockResolvedValue(
          ok({
            items: [
              {
                document: {
                  id: '1',
                  title: 'Test',
                  content: 'Test content',
                  path: '/test.md',
                  tags: [],
                  createdAt: Date.now(),
                  modifiedAt: Date.now(),
                },
                score: 0.9,
              },
            ],
            total: 1,
            processingTime: 10,
            offset: 0,
            limit: 10,
          })
        ),
        clear: vi.fn().mockResolvedValue(ok(undefined)),
      } as any,
      vector: {
        clear: vi.fn().mockResolvedValue(ok(undefined)),
      } as any,
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as any,
    }
  })

  describe('Health Check', () => {
    it('should return 200 for health check', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp()).get('/health')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('status', 'ok')
      expect(response.body).toHaveProperty('timestamp')
    })
  })

  describe('Search Routes', () => {
    it('should search successfully with valid query', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/search')
        .send({ query: 'test', limit: 10, offset: 0 })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('results')
      expect(response.body.results).toHaveLength(1)
      expect(response.body.results[0]).toHaveProperty('id', '1')
      expect(response.body.results[0]).toHaveProperty('content', 'Test content')
      expect(response.body).toHaveProperty('total', 1)
      expect(response.body).toHaveProperty('took')
    })

    it('should return 400 for invalid search query', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/search')
        .send({ query: '', limit: 10 })

      expect(response.status).toBe(500)
    })

    it('should handle search errors', async () => {
      mockCtx.search.search = vi
        .fn()
        .mockResolvedValue(err(createError('SEARCH_ERROR', 'Search failed')))

      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/search')
        .send({ query: 'test' })

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'SEARCH_FAILED')
    })

    it('should use default limit and offset', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/search')
        .send({ query: 'test' })

      expect(response.status).toBe(200)
      expect(mockCtx.search.search).toHaveBeenCalledWith('test', {
        limit: 10,
        offset: 0,
      })
    })

    it('should handle vector search endpoint', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/vector-search')
        .send({ query: 'test', limit: 5 })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('results')
      expect(response.body.results).toHaveLength(0) // Empty for now
    })

    it('should return 400 for vector search without query', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/search/vector-search')
        .send({ limit: 5 })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error', 'INVALID_REQUEST')
    })
  })

  describe('Index Routes', () => {
    it('should start indexing successfully', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/index/index')
        .send({ path: '/test', recursive: true })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('indexed', 10)
      expect(response.body).toHaveProperty('failed', 0)
      expect(response.body).toHaveProperty('duration')
      expect(mockCtx.indexer.start).toHaveBeenCalled()
    })

    it('should return 400 for invalid index request', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/index/index')
        .send({ path: '' })

      expect(response.status).toBe(500)
    })

    it('should handle indexing errors', async () => {
      mockCtx.indexer.start = vi
        .fn()
        .mockResolvedValue(err(createError('INTERNAL_ERROR', 'Indexing failed')))

      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .post('/api/index/index')
        .send({ path: '/test' })

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'INDEX_FAILED')
    })

    it('should get index stats', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp()).get('/api/index/stats')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('totalFiles', 10)
    })

    it('should reindex successfully', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp()).post('/api/index/reindex')

      expect(response.status).toBe(200)
      expect(mockCtx.search.clear).toHaveBeenCalled()
      expect(mockCtx.vector.clear).toHaveBeenCalled()
      expect(mockCtx.indexer.start).toHaveBeenCalled()
    })

    it('should handle reindex errors', async () => {
      mockCtx.indexer.start = vi
        .fn()
        .mockResolvedValue(err(createError('INTERNAL_ERROR', 'Reindexing failed')))

      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp()).post('/api/index/reindex')

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'REINDEX_FAILED')
    })
  })

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp()).get('/api/unknown')

      expect(response.status).toBe(404)
      expect(response.body).toHaveProperty('error', 'NOT_FOUND')
      expect(response.body.message).toContain('/api/unknown')
    })

    it('should handle errors with error handler', async () => {
      const server = new ApiServer(config, mockCtx)
      mockCtx.search.search = vi.fn().mockRejectedValue(new Error('Unexpected error'))

      const response = await request(server.getApp())
        .post('/api/search/search')
        .send({ query: 'test' })

      expect(response.status).toBe(500)
      expect(mockCtx.logger.error).toHaveBeenCalled()
    })
  })

  describe('CORS', () => {
    it('should enable CORS when configured', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .get('/health')
        .set('Origin', 'http://localhost:3000')

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    })

    it('should not enable CORS when disabled', async () => {
      config.cors.enabled = false
      const server = new ApiServer(config, mockCtx)
      const response = await request(server.getApp())
        .get('/health')
        .set('Origin', 'http://localhost:3000')

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  describe('Server Lifecycle', () => {
    it('should start and stop server successfully', async () => {
      const server = new ApiServer(config, mockCtx)
      const startResult = await server.start()
      expect(startResult.ok).toBe(true)
      expect(mockCtx.logger.info).toHaveBeenCalledWith(
        'API server started',
        expect.objectContaining({ host: 'localhost', port: 3000 })
      )

      const stopResult = await server.stop()
      expect(stopResult.ok).toBe(true)
      expect(mockCtx.logger.info).toHaveBeenCalledWith('API server stopped')
    })

    it('should handle stop when server not started', async () => {
      const server = new ApiServer(config, mockCtx)
      const stopResult = await server.stop()
      expect(stopResult.ok).toBe(true)
    })
  })
})
