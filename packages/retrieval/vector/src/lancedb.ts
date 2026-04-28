/**
 * LanceDB implementation of VectorDatabase
 */

import * as lancedb from 'vectordb'
import type { Connection, Table } from 'vectordb'
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
        // Create table with initial data that has proper metadata structure
        // LanceDB requires at least one row to infer schema
        this.table = await connResult.value.createTable(this.config.tableName, [
          {
            id: '__init__',
            vector: new Array(this.config.dimension).fill(0),
            metadata: '{}',
          },
        ])
        // Delete the initialization row
        await this.table.delete('id = "__init__"')
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
      const records = embeddings.map((e) => ({
        id: e.id,
        vector: e.vector,
        metadata: JSON.stringify(e.metadata),
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
      const filter = ids.map((id) => `id = "${id}"`).join(' OR ')
      await tableResult.value.delete(filter)
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
      const startTime = Date.now()

      let searchQuery = tableResult.value
        .search(query.vector)
        .limit(query.limit ?? 10)

      // Apply metadata filters if provided
      if (query.filter) {
        const filters = Object.entries(query.filter)
          .map(([key, value]) => {
            if (typeof value === 'string') {
              return `metadata LIKE '%"${key}":"${value}"%'`
            }
            return `metadata LIKE '%"${key}":${value}%'`
          })
          .join(' AND ')

        if (filters) {
          searchQuery = searchQuery.where(filters)
        }
      }

      const results = await searchQuery.execute()
      const processingTime = Date.now() - startTime

      // Transform results
      const items = results
        .map((result: any) => ({
          id: result.id,
          score: 1 - (result._distance ?? 0), // Convert distance to similarity
          metadata: JSON.parse(result.metadata ?? '{}'),
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
      const results = await tableResult.value
        .search(new Array(this.config.dimension).fill(0))
        .where(`id = "${id}"`)
        .limit(1)
        .execute()

      if (results.length === 0) {
        return ok(null)
      }

      const result = results[0]
      if (!result) {
        return ok(null)
      }

      return ok({
        id: result.id as string,
        vector: result.vector as number[],
        metadata: JSON.parse((result.metadata as string) ?? '{}'),
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
      await connResult.value.dropTable(this.config.tableName)
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
    this.table = null
    this.connection = null
  }
}
