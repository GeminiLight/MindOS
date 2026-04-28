/**
 * File system types
 */

import type { Result } from '../../foundation/shared/index.js'

/**
 * File metadata
 */
export interface FileMetadata {
  path: string
  size: number
  createdAt: Date
  modifiedAt: Date
  isDirectory: boolean
  isFile: boolean
}

/**
 * Directory entry
 */
export interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

/**
 * File system watch event
 */
export interface FileSystemEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  stats?: FileMetadata
}

/**
 * File system watch options
 */
export interface WatchOptions {
  ignored?: string | RegExp | Array<string | RegExp>
  persistent?: boolean
  ignoreInitial?: boolean
  depth?: number
}

/**
 * File system interface
 */
export interface IFileSystem {
  /**
   * Read file content
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<Result<string>>

  /**
   * Write file content
   */
  writeFile(path: string, content: string, encoding?: BufferEncoding): Promise<Result<void>>

  /**
   * Check if file exists
   */
  exists(path: string): Promise<Result<boolean>>

  /**
   * Get file metadata
   */
  stat(path: string): Promise<Result<FileMetadata>>

  /**
   * List directory contents
   */
  readdir(path: string): Promise<Result<DirectoryEntry[]>>

  /**
   * Create directory
   */
  mkdir(path: string, recursive?: boolean): Promise<Result<void>>

  /**
   * Remove file or directory
   */
  remove(path: string, recursive?: boolean): Promise<Result<void>>

  /**
   * Copy file or directory
   */
  copy(src: string, dest: string): Promise<Result<void>>

  /**
   * Move/rename file or directory
   */
  move(src: string, dest: string): Promise<Result<void>>

  /**
   * Watch file system changes
   */
  watch(
    path: string,
    options: WatchOptions,
    callback: (event: FileSystemEvent) => void
  ): Promise<Result<() => void>>
}
