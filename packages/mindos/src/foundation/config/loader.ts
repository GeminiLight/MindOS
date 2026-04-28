/**
 * Configuration loader
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AppConfig } from './types.js'
import { validateConfigWithDefaults } from './schema.js'
import { createError } from '../errors/index.js'

/**
 * Load configuration from file
 */
export async function loadConfigFromFile(filePath: string): Promise<AppConfig> {
  const absolutePath = resolve(filePath)

  if (!existsSync(absolutePath)) {
    throw createError(
      'CONFIGURATION_ERROR',
      `Configuration file not found: ${absolutePath}`
    )
  }

  try {
    const content = await readFile(absolutePath, 'utf-8')
    const rawConfig = JSON.parse(content)
    return validateConfigWithDefaults(rawConfig)
  } catch (error) {
    throw createError(
      'CONFIGURATION_ERROR',
      `Failed to load configuration from ${absolutePath}`,
      { cause: error as Error }
    )
  }
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {}

  // Server configuration
  if (process.env.PORT) {
    config.server = {
      ...config.server,
      port: parseInt(process.env.PORT, 10),
    } as any
  }

  if (process.env.HOST) {
    config.server = {
      ...config.server,
      host: process.env.HOST,
    } as any
  }

  // Workspace configuration
  if (process.env.WORKSPACE_ROOT) {
    config.workspace = {
      ...config.workspace,
      root: process.env.WORKSPACE_ROOT,
    } as any
  }

  // Search configuration
  if (process.env.MEILISEARCH_HOST) {
    config.search = {
      ...config.search,
      host: process.env.MEILISEARCH_HOST,
    } as any
  }

  if (process.env.MEILISEARCH_API_KEY) {
    config.search = {
      ...config.search,
      apiKey: process.env.MEILISEARCH_API_KEY,
    } as any
  }

  // Vector configuration
  if (process.env.VECTOR_DB_PATH) {
    config.vector = {
      ...config.vector,
      path: process.env.VECTOR_DB_PATH,
    } as any
  }

  // Logging configuration
  if (process.env.LOG_LEVEL) {
    config.logging = {
      ...config.logging,
      level: process.env.LOG_LEVEL as any,
    } as any
  }

  return config
}

/**
 * Merge configurations with priority: env > file > defaults
 */
export function mergeConfigs(...configs: Array<Partial<AppConfig>>): AppConfig {
  const merged = configs.reduce((acc, config) => {
    return deepMerge(acc, config)
  }, {} as Partial<AppConfig>)

  return validateConfigWithDefaults(merged)
}

/**
 * Deep merge objects
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    const sourceValue = source[key]
    const targetValue = result[key]

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue, sourceValue as any)
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as any
    }
  }

  return result
}
