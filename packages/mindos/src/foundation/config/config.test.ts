/**
 * Configuration management tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  InMemoryConfigProvider,
  FileConfigProvider,
  createConfigProvider,
  loadConfigFromEnv,
  mergeConfigs,
  validateConfig,
  validateConfigWithDefaults,
} from './index.js'
import type { AppConfig } from './types.js'

describe('Configuration Schema', () => {
  it('should validate complete config', () => {
    const config = {
      name: 'TestApp',
      version: '1.0.0',
      env: 'development' as const,
      server: {
        port: 3000,
        host: 'localhost',
        cors: true,
        timeout: 30000,
      },
      workspace: {
        root: '/test/workspace',
        indexedExtensions: ['.md'],
        excludedPaths: ['node_modules'],
        watchFiles: true,
      },
      search: {
        engine: 'meilisearch' as const,
        host: 'http://localhost:7700',
        indexName: 'test',
      },
      vector: {
        database: 'lancedb' as const,
        path: '/test/vector',
        embeddingModel: 'test-model',
        dimension: 384,
      },
      mcp: {
        port: 8781,
        enabled: true,
      },
      logging: {
        level: 'info' as const,
        pretty: false,
      },
    }

    const result = validateConfig(config)
    expect(result.name).toBe('TestApp')
    expect(result.server.port).toBe(3000)
  })

  it('should apply defaults for missing fields', () => {
    const config = {
      workspace: {
        root: '/test',
      },
      vector: {
        path: '/test/vector',
      },
    }

    const result = validateConfigWithDefaults(config)
    expect(result.name).toBe('MindOS')
    expect(result.version).toBe('1.0.0')
    expect(result.env).toBe('development')
    expect(result.server.port).toBe(3456)
    expect(result.server.host).toBe('localhost')
    expect(result.workspace.indexedExtensions).toEqual(['.md', '.markdown', '.txt'])
    expect(result.vector.dimension).toBe(384)
  })

  it('should reject invalid port numbers', () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test' },
      server: { port: 99999 },
    }

    expect(() => validateConfig(config)).toThrow()
  })

  it('should reject invalid environment', () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test' },
      env: 'invalid',
    }

    expect(() => validateConfig(config)).toThrow()
  })

  it('should reject invalid log level', () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test' },
      logging: { level: 'invalid' },
    }

    expect(() => validateConfig(config)).toThrow()
  })
})

describe('InMemoryConfigProvider', () => {
  let provider: InMemoryConfigProvider
  let testConfig: AppConfig

  beforeEach(() => {
    testConfig = {
      name: 'TestApp',
      version: '1.0.0',
      env: 'test',
      server: {
        port: 3000,
        host: 'localhost',
        cors: true,
        timeout: 30000,
      },
      workspace: {
        root: '/test/workspace',
        indexedExtensions: ['.md'],
        excludedPaths: ['node_modules'],
        watchFiles: true,
      },
      search: {
        engine: 'meilisearch',
        host: 'http://localhost:7700',
        indexName: 'test',
      },
      vector: {
        database: 'lancedb',
        path: '/test/vector',
        embeddingModel: 'test-model',
        dimension: 384,
      },
      mcp: {
        port: 8781,
        enabled: true,
      },
      logging: {
        level: 'info',
        pretty: false,
      },
    }

    provider = new InMemoryConfigProvider(testConfig)
  })

  it('should get top-level config value', () => {
    expect(provider.get('name')).toBe('TestApp')
    expect(provider.get('version')).toBe('1.0.0')
  })

  it('should get nested config value', () => {
    expect(provider.get('server.port')).toBe(3000)
    expect(provider.get('server.host')).toBe('localhost')
    expect(provider.get('workspace.root')).toBe('/test/workspace')
  })

  it('should return undefined for non-existent key', () => {
    expect(provider.get('nonexistent')).toBeUndefined()
    expect(provider.get('server.nonexistent')).toBeUndefined()
  })

  it('should get value with default', () => {
    expect(provider.getOrDefault('name', 'default')).toBe('TestApp')
    expect(provider.getOrDefault('nonexistent', 'default')).toBe('default')
  })

  it('should check if key exists', () => {
    expect(provider.has('name')).toBe(true)
    expect(provider.has('server.port')).toBe(true)
    expect(provider.has('nonexistent')).toBe(false)
  })

  it('should get all config', () => {
    const all = provider.getAll()
    expect(all.name).toBe('TestApp')
    expect(all.server.port).toBe(3000)
  })

  it('should handle reload (no-op)', async () => {
    await expect(provider.reload()).resolves.toBeUndefined()
  })
})

describe('FileConfigProvider', () => {
  let testDir: string
  let configPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `config-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    configPath = join(testDir, 'config.json')
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should load config from file', async () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test/vector' },
      server: { port: 4000 },
    }

    await writeFile(configPath, JSON.stringify(config))

    const provider = new FileConfigProvider(configPath, false)
    await provider.init()

    expect(provider.get('server.port')).toBe(4000)
    expect(provider.get('workspace.root')).toBe('/test')
  })

  it('should apply defaults when loading from file', async () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test/vector' },
    }

    await writeFile(configPath, JSON.stringify(config))

    const provider = new FileConfigProvider(configPath, false)
    await provider.init()

    expect(provider.get('name')).toBe('MindOS')
    expect(provider.get('server.port')).toBe(3456)
  })

  it('should reload config from file', async () => {
    const config1 = {
      workspace: { root: '/test1' },
      vector: { path: '/test/vector' },
    }

    await writeFile(configPath, JSON.stringify(config1))

    const provider = new FileConfigProvider(configPath, false)
    await provider.init()

    expect(provider.get('workspace.root')).toBe('/test1')

    // Update config file
    const config2 = {
      workspace: { root: '/test2' },
      vector: { path: '/test/vector' },
    }

    await writeFile(configPath, JSON.stringify(config2))
    await provider.reload()

    expect(provider.get('workspace.root')).toBe('/test2')
  })

  it('should throw error for non-existent file', async () => {
    const provider = new FileConfigProvider('/nonexistent/config.json', false)
    await expect(provider.init()).rejects.toThrow()
  })

  it('should throw error for invalid JSON', async () => {
    await writeFile(configPath, 'invalid json')

    const provider = new FileConfigProvider(configPath, false)
    await expect(provider.init()).rejects.toThrow()
  })
})

describe('Environment Variable Loading', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should load server config from env', () => {
    process.env.PORT = '5000'
    process.env.HOST = '0.0.0.0'

    const config = loadConfigFromEnv()
    expect(config.server?.port).toBe(5000)
    expect(config.server?.host).toBe('0.0.0.0')
  })

  it('should load workspace config from env', () => {
    process.env.WORKSPACE_ROOT = '/custom/workspace'

    const config = loadConfigFromEnv()
    expect(config.workspace?.root).toBe('/custom/workspace')
  })

  it('should load search config from env', () => {
    process.env.MEILISEARCH_HOST = 'http://custom:7700'
    process.env.MEILISEARCH_API_KEY = 'secret-key'

    const config = loadConfigFromEnv()
    expect(config.search?.host).toBe('http://custom:7700')
    expect(config.search?.apiKey).toBe('secret-key')
  })

  it('should load vector config from env', () => {
    process.env.VECTOR_DB_PATH = '/custom/vector'

    const config = loadConfigFromEnv()
    expect(config.vector?.path).toBe('/custom/vector')
  })

  it('should load logging config from env', () => {
    process.env.LOG_LEVEL = 'debug'

    const config = loadConfigFromEnv()
    expect(config.logging?.level).toBe('debug')
  })

  it('should return empty config when no env vars set', () => {
    const config = loadConfigFromEnv()
    expect(Object.keys(config).length).toBe(0)
  })
})

describe('Config Merging', () => {
  it('should merge multiple configs', () => {
    const config1 = {
      workspace: { root: '/test1' },
      vector: { path: '/vector' },
    }

    const config2 = {
      workspace: { root: '/test2' },
      server: { port: 4000 },
    }

    const merged = mergeConfigs(config1, config2)
    expect(merged.workspace.root).toBe('/test2')
    expect(merged.server.port).toBe(4000)
    expect(merged.vector.path).toBe('/vector')
  })

  it('should apply defaults after merging', () => {
    const config1 = {
      workspace: { root: '/test' },
    }

    const config2 = {
      vector: { path: '/vector' },
    }

    const merged = mergeConfigs(config1, config2)
    expect(merged.name).toBe('MindOS')
    expect(merged.server.port).toBe(3456)
  })

  it('should handle deep merging', () => {
    const config1 = {
      workspace: { root: '/test' },
      vector: { path: '/vector' },
      server: { port: 3000, host: 'localhost' },
    }

    const config2 = {
      server: { port: 4000 },
    }

    const merged = mergeConfigs(config1, config2)
    expect(merged.server.port).toBe(4000)
    expect(merged.server.host).toBe('localhost')
  })
})

describe('createConfigProvider', () => {
  let testDir: string
  let configPath: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `config-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
    configPath = join(testDir, 'config.json')
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('should create in-memory provider', async () => {
    const config = {
      name: 'TestApp',
      version: '1.0.0',
      env: 'test' as const,
      server: { port: 3000, host: 'localhost', cors: true, timeout: 30000 },
      workspace: { root: '/test', indexedExtensions: ['.md'], excludedPaths: [], watchFiles: true },
      search: { engine: 'meilisearch' as const, indexName: 'test' },
      vector: { database: 'lancedb' as const, path: '/test', embeddingModel: 'test', dimension: 384 },
      mcp: { port: 8781, enabled: true },
      logging: { level: 'info' as const, pretty: false },
    }

    const provider = await createConfigProvider({ config })
    expect(provider.get('name')).toBe('TestApp')
  })

  it('should create file provider', async () => {
    const config = {
      workspace: { root: '/test' },
      vector: { path: '/test/vector' },
    }

    await writeFile(configPath, JSON.stringify(config))

    const provider = await createConfigProvider({ filePath: configPath })
    expect(provider.get('workspace.root')).toBe('/test')
  })
})
