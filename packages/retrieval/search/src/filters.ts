import type { SearchOptions } from './types.js'

/**
 * Meilisearch filter string literal. Tags and path prefixes come from user
 * input; an unescaped quote used to break the expression (or widen it).
 */
export function meilisearchStringLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function buildMeilisearchFilter(options: SearchOptions): string | undefined {
  const filters: string[] = []

  if (options.tags && options.tags.length > 0) {
    const tagFilters = options.tags.map((tag) => `tags = ${meilisearchStringLiteral(tag)}`).join(' OR ')
    filters.push(`(${tagFilters})`)
  }

  if (options.pathPrefix) {
    filters.push(`path STARTS WITH ${meilisearchStringLiteral(options.pathPrefix)}`)
  }

  if (options.createdAfter) {
    filters.push(`createdAt >= ${options.createdAfter.getTime()}`)
  }

  if (options.createdBefore) {
    filters.push(`createdAt <= ${options.createdBefore.getTime()}`)
  }

  return filters.length > 0 ? filters.join(' AND ') : undefined
}
