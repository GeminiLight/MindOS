/**
 * Service tokens for dependency injection
 */

/**
 * Create a service token
 */
export function createToken<T>(description: string): symbol {
  return Symbol(description)
}

/**
 * Common service tokens
 */
export const TOKENS = {
  // Core services
  Logger: createToken<any>('Logger'),
  Config: createToken<any>('ConfigProvider'),
  FileSystem: createToken<any>('IFileSystem'),

  // Infrastructure services
  Database: createToken<any>('Database'),
  Cache: createToken<any>('Cache'),
  EventBus: createToken<any>('EventBus'),

  // Domain services
  DocumentRepository: createToken<any>('DocumentRepository'),
  WorkspaceRepository: createToken<any>('WorkspaceRepository'),
  SearchService: createToken<any>('SearchService'),
  VectorService: createToken<any>('VectorService'),

  // Application services
  DocumentService: createToken<any>('DocumentService'),
  WorkspaceService: createToken<any>('WorkspaceService'),
  SearchEngine: createToken<any>('SearchEngine'),
} as const
