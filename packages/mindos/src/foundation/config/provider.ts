/**
 * Configuration provider implementation
 */

import type { AppConfig, ConfigProvider } from './types.js'
import { loadConfigFromFile, loadConfigFromEnv, mergeConfigs } from './loader.js'

/**
 * File-based configuration provider
 */
export class FileConfigProvider implements ConfigProvider {
  private config: AppConfig

  constructor(
    private readonly filePath: string,
    private readonly useEnv = true
  ) {
    this.config = {} as AppConfig
  }

  /**
   * Initialize configuration
   */
  async init(): Promise<void> {
    await this.reload()
  }

  async reload(): Promise<void> {
    const fileConfig = await loadConfigFromFile(this.filePath)
    const envConfig = this.useEnv ? loadConfigFromEnv() : {}
    this.config = mergeConfigs(fileConfig, envConfig)
  }

  get<T = unknown>(key: string): T | undefined {
    return getNestedValue(this.config, key) as T | undefined
  }

  getOrDefault<T = unknown>(key: string, defaultValue: T): T {
    const value = this.get<T>(key)
    return value !== undefined ? value : defaultValue
  }

  has(key: string): boolean {
    return getNestedValue(this.config, key) !== undefined
  }

  getAll(): AppConfig {
    return this.config
  }
}

/**
 * In-memory configuration provider
 */
export class InMemoryConfigProvider implements ConfigProvider {
  constructor(private config: AppConfig) {}

  async reload(): Promise<void> {
    // No-op for in-memory provider
  }

  get<T = unknown>(key: string): T | undefined {
    return getNestedValue(this.config, key) as T | undefined
  }

  getOrDefault<T = unknown>(key: string, defaultValue: T): T {
    const value = this.get<T>(key)
    return value !== undefined ? value : defaultValue
  }

  has(key: string): boolean {
    return getNestedValue(this.config, key) !== undefined
  }

  getAll(): AppConfig {
    return this.config
  }
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): unknown {
  const keys = path.split('.')
  let current = obj

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined
    }
    current = current[key]
  }

  return current
}

/**
 * Create configuration provider
 */
export async function createConfigProvider(
  options: { filePath: string; useEnv?: boolean } | { config: AppConfig }
): Promise<ConfigProvider> {
  if ('config' in options) {
    return new InMemoryConfigProvider(options.config)
  }

  const provider = new FileConfigProvider(options.filePath, options.useEnv)
  await provider.init()
  return provider
}
