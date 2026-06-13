import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import net from 'node:net'
import http from 'node:http'
import { ApiServer } from './server.js'
import type { ApiConfig, ApiContext } from './types.js'
import { ok, err } from '@geminilight/mindos/foundation'
import { createError } from '@geminilight/mindos/foundation'

describe('ApiServer', () => {
  let config: ApiConfig
  let mockCtx: ApiContext
  let originalAnthropicAuthToken: string | undefined
  const openServers: http.Server[] = []

  // supertest's `request(app)` listens on the wildcard address with port 0; the
  // kernel may assign a port whose 127.0.0.1 IPv4 binding is already held by an
  // unrelated daemon (specific + wildcard bindings coexist). supertest then
  // connects to 127.0.0.1:<port>, the most specific binding wins, and the
  // request silently lands on the foreign daemon (observed: a local agent
  // answering 403 → "should get index stats" flaked under parallel turbo runs).
  // Binding explicitly to 127.0.0.1 forces the kernel to assign a port that is
  // actually free on the address supertest connects to.
  async function listenLocal(server: ApiServer): Promise<http.Server> {
    const httpServer = http.createServer(server.getApp())
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    openServers.push(httpServer)
    return httpServer
  }

  afterEach(async () => {
    await Promise.all(
      openServers.splice(0).map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve()))
      )
    )
  })

  beforeAll(() => {
    originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
    delete process.env.ANTHROPIC_AUTH_TOKEN
  })

  afterAll(() => {
    if (originalAnthropicAuthToken === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken
    }
  })

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
      const response = await request(await listenLocal(server)).get('/health')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('status', 'ok')
      expect(response.body).toHaveProperty('timestamp')
    })
  })

  describe('Search Routes', () => {
    it('should search successfully with valid query', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
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
      const response = await request(await listenLocal(server))
        .post('/api/search/search')
        .send({ query: '', limit: 10 })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error', 'INVALID_REQUEST')
    })

    it('should handle search errors', async () => {
      mockCtx.search.search = vi
        .fn()
        .mockResolvedValue(err(createError('SEARCH_ERROR', 'Search failed')))

      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
        .post('/api/search/search')
        .send({ query: 'test' })

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'SEARCH_FAILED')
    })

    it('should use default limit and offset', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
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
      const response = await request(await listenLocal(server))
        .post('/api/search/vector-search')
        .send({ query: 'test', limit: 5 })

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('results')
      expect(response.body.results).toHaveLength(0) // Empty for now
    })

    it('should return 400 for vector search without query', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
        .post('/api/search/vector-search')
        .send({ limit: 5 })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error', 'INVALID_REQUEST')
    })
  })

  describe('Index Routes', () => {
    it('should start indexing successfully', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
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
      const response = await request(await listenLocal(server))
        .post('/api/index/index')
        .send({ path: '' })

      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('error', 'INVALID_REQUEST')
    })

    it('should handle indexing errors', async () => {
      mockCtx.indexer.start = vi
        .fn()
        .mockResolvedValue(err(createError('INTERNAL_ERROR', 'Indexing failed')))

      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
        .post('/api/index/index')
        .send({ path: '/test' })

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'INDEX_FAILED')
    })

    it('should get index stats', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server)).get('/api/index/stats')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('totalFiles', 10)
    })

    it('should reindex successfully', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server)).post('/api/index/reindex')

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
      const response = await request(await listenLocal(server)).post('/api/index/reindex')

      expect(response.status).toBe(500)
      expect(response.body).toHaveProperty('error', 'REINDEX_FAILED')
    })
  })

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server)).get('/api/unknown')

      expect(response.status).toBe(404)
      expect(response.body).toHaveProperty('error', 'NOT_FOUND')
      expect(response.body.message).toContain('/api/unknown')
    })

    it('should handle errors with error handler', async () => {
      const server = new ApiServer(config, mockCtx)
      mockCtx.search.search = vi.fn().mockRejectedValue(new Error('Unexpected error'))

      const response = await request(await listenLocal(server))
        .post('/api/search/search')
        .send({ query: 'test' })

      expect(response.status).toBe(500)
      expect(mockCtx.logger.error).toHaveBeenCalled()
    })
  })

  describe('CORS', () => {
    it('should enable CORS when configured', async () => {
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
        .get('/health')
        .set('Origin', 'http://localhost:3000')

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    })

    it('should not enable CORS when disabled', async () => {
      config.cors.enabled = false
      const server = new ApiServer(config, mockCtx)
      const response = await request(await listenLocal(server))
        .get('/health')
        .set('Origin', 'http://localhost:3000')

      expect(response.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  describe('Test harness port binding', () => {
    it('keeps requests on our app when an IPv4-only daemon holds the same port on 127.0.0.1', async () => {
      // Decoy plays the unrelated local daemon (real incident: a dev-machine
      // agent on an ephemeral port answering 403 to everything).
      const decoy = http.createServer((req, res) => {
        res.statusCode = 403
        res.setHeader('x-decoy', '1')
        res.end('forbidden')
      })
      await new Promise<void>((resolve, reject) => {
        decoy.once('error', reject)
        decoy.listen(0, '127.0.0.1', resolve)
      })
      const decoyAddress = decoy.address()
      if (!decoyAddress || typeof decoyAddress === 'string') {
        throw new Error('Expected TCP decoy address')
      }
      const port = decoyAddress.port

      const server = new ApiServer(config, mockCtx)
      // What `request(app)` effectively did: wildcard bind, same port number.
      const wildcard = http.createServer(server.getApp())
      const wildcardBindSucceeded = await new Promise<boolean>((resolve) => {
        wildcard.once('error', () => resolve(false))
        wildcard.listen(port, () => resolve(true))
      })

      try {
        if (wildcardBindSucceeded) {
          // Hazard is real on this platform: both sockets coexist and the
          // decoy (most specific binding) receives 127.0.0.1 traffic even
          // though our app "listens" on the same port.
          const hijacked = await request(`http://127.0.0.1:${port}`).get('/api/index/stats')
          expect(hijacked.headers['x-decoy']).toBe('1')
          expect(hijacked.status).toBe(403)
        }

        // listenLocal binds 127.0.0.1 explicitly, so the kernel can only
        // assign a port that is free on the address supertest connects to.
        const bound = await listenLocal(server)
        const boundAddress = bound.address()
        if (!boundAddress || typeof boundAddress === 'string') {
          throw new Error('Expected TCP server address')
        }
        expect(boundAddress.address).toBe('127.0.0.1')
        expect(boundAddress.port).not.toBe(port)
        const response = await request(bound).get('/api/index/stats')
        expect(response.status).toBe(200)
        expect(response.body).toHaveProperty('totalFiles', 10)
      } finally {
        await new Promise<void>((resolve) => wildcard.close(() => resolve()))
        await new Promise<void>((resolve) => decoy.close(() => resolve()))
      }
    })
  })

  describe('Server Lifecycle', () => {
    it('should start and stop server successfully', async () => {
      config.port = 0
      const server = new ApiServer(config, mockCtx)
      const startResult = await server.start()
      expect(startResult.ok).toBe(true)
      expect(mockCtx.logger.info).toHaveBeenCalledWith(
        'API server started',
        expect.objectContaining({ host: 'localhost', port: 0 })
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

    it('should return an error when the configured port is already in use', async () => {
      const blocker = net.createServer()
      await new Promise<void>((resolve) => {
        blocker.listen(0, '127.0.0.1', resolve)
      })
      const address = blocker.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP test server address')
      }

      config.host = '127.0.0.1'
      config.port = address.port
      const server = new ApiServer(config, mockCtx)
      const uncaughtErrors: unknown[] = []
      const uncaughtHandler = (error: unknown) => {
        uncaughtErrors.push(error)
      }
      process.once('uncaughtException', uncaughtHandler)

      try {
        const result = await Promise.race([
          server.start(),
          new Promise<Awaited<ReturnType<ApiServer['start']>>>((resolve) => {
            setTimeout(() => resolve(err(createError('TIMEOUT', 'start timed out'))), 250)
          }),
        ])

        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error).toMatchObject({ code: 'INTERNAL_ERROR' })
        }
        expect(uncaughtErrors).toHaveLength(0)
      } finally {
        process.off('uncaughtException', uncaughtHandler)
        await new Promise<void>((resolve) => blocker.close(() => resolve()))
      }
    })
  })
})
