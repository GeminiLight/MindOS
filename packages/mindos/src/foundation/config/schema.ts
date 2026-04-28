/**
 * Configuration schema validation using Zod
 */

import { z } from 'zod'

/**
 * Server configuration schema
 */
const serverConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3456),
  host: z.string().default('localhost'),
  cors: z.boolean().default(true),
  timeout: z.number().int().min(0).default(30000),
})

/**
 * Workspace configuration schema
 */
const workspaceConfigSchema = z.object({
  root: z.string(),
  indexedExtensions: z.array(z.string()).default(['.md', '.markdown', '.txt']),
  excludedPaths: z.array(z.string()).default(['node_modules', '.git', 'dist']),
  watchFiles: z.boolean().default(true),
})

/**
 * Search configuration schema
 */
const searchConfigSchema = z.object({
  engine: z.enum(['meilisearch', 'local']).default('meilisearch'),
  host: z.string().optional(),
  apiKey: z.string().optional(),
  indexName: z.string().default('documents'),
})

/**
 * Vector configuration schema
 */
const vectorConfigSchema = z.object({
  database: z.enum(['lancedb', 'local']).default('lancedb'),
  path: z.string(),
  embeddingModel: z.string().default('all-MiniLM-L6-v2'),
  dimension: z.number().int().min(1).default(384),
})

/**
 * MCP configuration schema
 */
const mcpConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8781),
  enabled: z.boolean().default(true),
})

/**
 * Logging configuration schema
 */
const loggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  pretty: z.boolean().default(false),
  file: z.string().optional(),
})

/**
 * Application configuration schema
 */
export const appConfigSchema = z.object({
  name: z.string().default('MindOS'),
  version: z.string().default('1.0.0'),
  env: z.enum(['development', 'production', 'test']).default('development'),
  server: serverConfigSchema.default({}),
  workspace: workspaceConfigSchema,
  search: searchConfigSchema.default({}),
  vector: vectorConfigSchema,
  mcp: mcpConfigSchema.default({}),
  logging: loggingConfigSchema.default({}),
})

/**
 * Validate configuration
 */
export function validateConfig(config: unknown): z.infer<typeof appConfigSchema> {
  return appConfigSchema.parse(config)
}

/**
 * Validate configuration with defaults
 */
export function validateConfigWithDefaults(
  config: Partial<z.infer<typeof appConfigSchema>>
): z.infer<typeof appConfigSchema> {
  return appConfigSchema.parse(config)
}
