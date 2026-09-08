/**
 * LanceDB implementation of VectorDatabase
 *
 * Backed by `@lancedb/lancedb` (the successor of the deprecated `vectordb`
 * package). Predicates stay SQL text built by `filters.ts`; the vector column
 * comes back as an Arrow list, so it is normalized to `number[]` here.
 */

import * as lancedb from '@lancedb/lancedb'
import { buildLanceIdFilter, buildLanceMetadataFilter } from './filters.js'
import type { Connection, Table } from '@lancedb/lancedb'
import type { VectorDatabase, VectorEmbedding, VectorQuery, VectorSearchResults, VectorIndexStats } from './types.js'
import type { Result } from '@geminilight/mindos/foundation'
import { ok, err } from '@geminilight/mindos/foundation'
import { wrapError } from '@geminilight/mindos/foundation'

/**
 * LanceDB configuration
 */
export interface LanceDBConfig {
  /** Database path */
  path: string
  /** Table name */
  tableName: string
  /** Vector dimension */
  dimension: number
}

interface LanceRow {
  id: string
  vector: Iterable<number> | ArrayLike<number>
  metadata?: string | null
  _distance?: number | null
}

const INIT_ROW_ID = '__init__'

function toNumberArray(vector: LanceRow['vector']): number[] {
  return Array.from(vector as Iterable<number>, (value) => Number(value))
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * LanceDB-based vector database
 */
export class LanceDBVectorDatabase implements VectorDatabase {
  private readonly config: LanceDBConfig
  private connection: Connection | null = null
  private table: Table | null = null

  constructor(config: LanceDBConfig) {
    this.config = config
  }

  /**
   * Initialize the database connection
   */
  private async getConnection(): Promise<Result<Connection>> {
    if (this.connection) {
      return ok(this.connection)
    }

    try {
      this.connection = await lancedb.connect(this.config.path)
      return ok(this.connection)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  /**
   * Get or create the table
   */
  private async getTable(): Promise<Result<Table>> {
    if (this.table) {
      return ok(this.table)
    }

    const connResult = await this.getConnection()
    if (!connResult.ok) {
      return connResult
    }

    try {
      const tableNames = await connResult.value.tableNames()

      if (tableNames.includes(this.config.tableName)) {
        this.table = await connResult.value.openTable(this.config.tableName)
      } else {
        // LanceDB infers the schema from data, so seed one row with the right
        // shape (a `vector` column of the configured dimension plus a JSON
        // metadata string) and remove it straight away.
        const table = await connResult.value.createTable(this.config.tableName, [
          {
            id: INIT_ROW_ID,
            vector: new Array(this.config.dimension).fill(0),
            metadata: '{}',
          },
        ])
        await table.delete(buildLanceIdFilter([INIT_ROW_ID]))
        this.table = table
      }

      return ok(this.table)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async addVector(embedding: VectorEmbedding): Promise<Result<void>> {
    return this.addVectors([embedding])
  }

  async addVectors(embeddings: VectorEmbedding[]): Promise<Result<void>> {
    const tableResult = await this.getTable()
    if (!tableResult.ok) {
      return tableResult
    }

    try {
      if (embeddings.length === 0) return ok(undefined)
      const records = embeddings.map((e) => ({
        id: e.id,
        vector: e.vector,
        metadata: JSON.stringify(e.metadata ?? {}),
      }))

      await tableResult.value.add(records)
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async removeVector(id: string): Promise<Result<void>> {
    return this.removeVectors([id])
  }

  async removeVectors(ids: string[]): Promise<Result<void>> {
    const tableResult = await this.getTable()
    if (!tableResult.ok) {
      return tableResult
    }

    try {
      if (ids.length === 0) return ok(undefined)
      await tableResult.value.delete(buildLanceIdFilter(ids))
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async search(query: VectorQuery): Promise<Result<VectorSearchResults>> {
    const tableResult = await this.getTable()
    if (!tableResult.ok) {
      return tableResult
    }

    try {
      const startTime = process.hrtime.bigint()

      let searchQuery = tableResult.value
        .vectorSearch(query.vector)
        .limit(query.limit ?? 10)

      // Apply metadata filters if provided
      if (query.filter) {
        const filters = buildLanceMetadataFilter(query.filter)

        if (filters) {
          searchQuery = searchQuery.where(filters)
        }
      }

      const results = (await searchQuery.toArray()) as LanceRow[]
      // Never report 0ms: callers treat processingTime as a positive duration.
      const processingTime = Math.max(1, Math.round(Number(process.hrtime.bigint() - startTime) / 1e6))

      // Transform results
      const items = results
        .map((result) => ({
          id: String(result.id),
          score: 1 - (result._distance ?? 0), // Convert distance to similarity
          metadata: parseMetadata(result.metadata),
        }))
        .filter((item) => !query.minScore || item.score >= query.minScore)

      return ok({
        items,
        total: items.length,
        processingTime,
      })
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async getVector(id: string): Promise<Result<VectorEmbedding | null>> {
    const tableResult = await this.getTable()
    if (!tableResult.ok) {
      return tableResult
    }

    try {
      const results = (await tableResult.value
        .query()
        .where(buildLanceIdFilter([id]))
        .limit(1)
        .toArray()) as LanceRow[]

      const result = results[0]
      if (!result) {
        return ok(null)
      }

      return ok({
        id: String(result.id),
        vector: toNumberArray(result.vector),
        metadata: parseMetadata(result.metadata),
      })
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async clear(): Promise<Result<void>> {
    const connResult = await this.getConnection()
    if (!connResult.ok) {
      return connResult
    }

    try {
      const tableNames = await connResult.value.tableNames()
      if (tableNames.includes(this.config.tableName)) {
        await connResult.value.dropTable(this.config.tableName)
      }
      this.table?.close()
      this.table = null
      return ok(undefined)
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async getStats(): Promise<Result<VectorIndexStats>> {
    const tableResult = await this.getTable()
    if (!tableResult.ok) {
      return tableResult
    }

    try {
      const count = await tableResult.value.countRows()

      return ok({
        vectorCount: count,
        dimension: this.config.dimension,
        sizeInBytes: 0, // LanceDB doesn't provide this easily
        lastUpdatedAt: new Date(),
      })
    } catch (error) {
      return err(wrapError(error))
    }
  }

  async health(): Promise<Result<boolean>> {
    try {
      const connResult = await this.getConnection()
      return ok(connResult.ok)
    } catch (error) {
      return ok(false)
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    try {
      this.table?.close()
      this.connection?.close()
    } finally {
      this.table = null
      this.connection = null
    }
  }
}
