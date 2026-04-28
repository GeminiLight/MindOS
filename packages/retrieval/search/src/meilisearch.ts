/**
 * MeiliSearch implementation of SearchEngine
 */

import { MeiliSearch, type Index } from 'meilisearch'
import type { SearchEngine, SearchDocument, SearchOptions, SearchResults, IndexStats } from './types.js'
import type { Result } from '@geminilight/mindos/foundation'
import { ok, err } from '@geminilight/mindos/foundation'
import { createError, wrapError } from '@geminilight/mindos/foundation'

/**
 * MeiliSearch configuration
 */
export interface MeiliSearchConfig {
  /** MeiliSearch host URL */
  host: string
  /** API key */
  apiKey?: string
  /** Index name */
  indexName: string
}

/**
 * MeiliSearch-based search engine
 */
export class MeiliSearchEngine implements SearchEngine {
  private readonly client: MeiliSearch
  private readonly indexName: string
  private index: Index | null = null

  constructor(config: MeiliSearchConfig) {
    this.client = new MeiliSearch({
      host: config.host,
      apiKey: config.apiKey,
    })
    this.indexName = config.indexName
  }

  /**
   * Initialize the index
   */
  private async getIndex(): Promise<Result<Index>> {
    if (this.index) {
      return ok(this.index)
    }

    try {
      // Try to get existing index
      this.index = this.client.index(this.indexName)

      // Configure searchable attributes
      await this.index.updateSearchableAttributes([
        'title',
        'content',
        'tags',
        'path',
      ])

      // Configure filterable attributes
      await this.index.updateFilterableAttributes([
        'tags',
        'path',
        'createdAt',
        'modifiedAt',
      ])

      // Configure sortable attributes
      await this.index.updateSortableAttributes([
        'createdAt',
        'modifiedAt',
      ])

      return ok(this.index)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async indexDocument(document: SearchDocument): Promise<Result<void>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      await indexResult.value.addDocuments([document])
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async indexDocuments(documents: SearchDocument[]): Promise<Result<void>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      await indexResult.value.addDocuments(documents)
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async removeDocument(id: string): Promise<Result<void>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      await indexResult.value.deleteDocument(id)
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async removeDocuments(ids: string[]): Promise<Result<void>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      await indexResult.value.deleteDocuments(ids)
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<Result<SearchResults>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      // Build filter string
      const filters: string[] = []

      if (options.tags && options.tags.length > 0) {
        const tagFilters = options.tags.map((tag) => `tags = "${tag}"`).join(' OR ')
        filters.push(`(${tagFilters})`)
      }

      if (options.pathPrefix) {
        filters.push(`path STARTS WITH "${options.pathPrefix}"`)
      }

      if (options.createdAfter) {
        filters.push(`createdAt >= ${options.createdAfter.getTime()}`)
      }

      if (options.createdBefore) {
        filters.push(`createdAt <= ${options.createdBefore.getTime()}`)
      }

      const filterString = filters.length > 0 ? filters.join(' AND ') : undefined

      // Perform search
      const result = await indexResult.value.search(query, {
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
        filter: filterString,
        attributesToSearchOn: options.attributesToSearchOn,
        showMatchesPosition: options.highlight ?? false,
      })

      // Transform results
      const items = result.hits.map((hit: any) => ({
        document: hit as SearchDocument,
        score: hit._rankingScore ?? 0,
        highlights: hit._formatted ? this.extractHighlights(hit._formatted) : undefined,
      }))

      return ok({
        items,
        total: result.estimatedTotalHits ?? result.hits.length,
        processingTime: result.processingTimeMs,
        offset: result.offset,
        limit: result.limit,
      })
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async getDocument(id: string): Promise<Result<SearchDocument | null>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      const document = await indexResult.value.getDocument(id)
      return ok(document as SearchDocument)
    } catch (error: any) {
      // MeiliSearch throws error for not found
      if (error.code === 'document_not_found') {
        return ok(null)
      }
      return err(wrapError(error))
    }
  }

  async clear(): Promise<Result<void>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      await indexResult.value.deleteAllDocuments()
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async getStats(): Promise<Result<IndexStats>> {
    const indexResult = await this.getIndex()
    if (!indexResult.ok) {
      return indexResult
    }

    try {
      const stats = await indexResult.value.getStats()
      return ok({
        documentCount: stats.numberOfDocuments,
        sizeInBytes: 0, // MeiliSearch doesn't provide this
        lastUpdatedAt: new Date(), // Use current time as approximation
      })
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async health(): Promise<Result<boolean>> {
    try {
      const health = await this.client.health()
      return ok(health.status === 'available')
    } catch (error) {
      return ok(false)
    }
  }

  /**
   * Extract highlights from formatted result
   */
  private extractHighlights(formatted: any): Record<string, string[]> {
    const highlights: Record<string, string[]> = {}

    for (const [key, value] of Object.entries(formatted)) {
      if (typeof value === 'string' && value.includes('<em>')) {
        // Extract highlighted portions
        const matches = value.match(/<em>([^<]+)<\/em>/g)
        if (matches) {
          highlights[key] = matches.map((m) => m.replace(/<\/?em>/g, ''))
        }
      }
    }

    return highlights
  }
}
