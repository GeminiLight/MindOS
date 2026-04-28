/**
 * Local file system implementation
 */

import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  stat as fsStat,
  readdir as fsReaddir,
  mkdir as fsMkdir,
  rm as fsRm,
  copyFile as fsCopyFile,
  rename as fsRename,
  access,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import type { Result } from '../../foundation/shared/index.js'
import { ok, err } from '../../foundation/shared/index.js'
import { createError } from '../../foundation/errors/index.js'
import type { Logger } from '../../foundation/logger/index.js'
import type {
  IFileSystem,
  FileMetadata,
  DirectoryEntry,
  FileSystemEvent,
  WatchOptions,
} from './types.js'

/**
 * Local file system implementation using Node.js fs
 */
export class LocalFileSystem implements IFileSystem {
  constructor(private readonly logger?: Logger) {}

  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<Result<string>> {
    try {
      const content = await fsReadFile(path, encoding)
      this.logger?.debug(`Read file: ${path}`)
      return ok(content)
    } catch (error) {
      this.logger?.error(`Failed to read file: ${path}`, error as Error)
      return err(
        createError('FILE_READ_ERROR', `Failed to read file: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async writeFile(
    path: string,
    content: string,
    encoding: BufferEncoding = 'utf-8'
  ): Promise<Result<void>> {
    try {
      // Ensure directory exists
      const dir = dirname(path)
      await fsMkdir(dir, { recursive: true })

      await fsWriteFile(path, content, encoding)
      this.logger?.debug(`Wrote file: ${path}`)
      return ok(undefined)
    } catch (error) {
      this.logger?.error(`Failed to write file: ${path}`, error as Error)
      return err(
        createError('FILE_WRITE_ERROR', `Failed to write file: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async exists(path: string): Promise<Result<boolean>> {
    try {
      await access(path, constants.F_OK)
      return ok(true)
    } catch {
      return ok(false)
    }
  }

  async stat(path: string): Promise<Result<FileMetadata>> {
    try {
      const stats = await fsStat(path)
      const metadata: FileMetadata = {
        path,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      }
      return ok(metadata)
    } catch (error) {
      this.logger?.error(`Failed to stat file: ${path}`, error as Error)
      return err(
        createError('FILE_STAT_ERROR', `Failed to stat file: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async readdir(path: string): Promise<Result<DirectoryEntry[]>> {
    try {
      const entries = await fsReaddir(path, { withFileTypes: true })
      const result: DirectoryEntry[] = entries.map((entry) => ({
        name: entry.name,
        path: join(path, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }))
      return ok(result)
    } catch (error) {
      this.logger?.error(`Failed to read directory: ${path}`, error as Error)
      return err(
        createError('DIRECTORY_READ_ERROR', `Failed to read directory: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async mkdir(path: string, recursive = true): Promise<Result<void>> {
    try {
      await fsMkdir(path, { recursive })
      this.logger?.debug(`Created directory: ${path}`)
      return ok(undefined)
    } catch (error) {
      this.logger?.error(`Failed to create directory: ${path}`, error as Error)
      return err(
        createError('DIRECTORY_CREATE_ERROR', `Failed to create directory: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async remove(path: string, recursive = false): Promise<Result<void>> {
    try {
      await fsRm(path, { recursive, force: true })
      this.logger?.debug(`Removed: ${path}`)
      return ok(undefined)
    } catch (error) {
      this.logger?.error(`Failed to remove: ${path}`, error as Error)
      return err(
        createError('FILE_REMOVE_ERROR', `Failed to remove: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }

  async copy(src: string, dest: string): Promise<Result<void>> {
    try {
      // Ensure destination directory exists
      const destDir = dirname(dest)
      await fsMkdir(destDir, { recursive: true })

      await fsCopyFile(src, dest)
      this.logger?.debug(`Copied: ${src} -> ${dest}`)
      return ok(undefined)
    } catch (error) {
      this.logger?.error(`Failed to copy: ${src} -> ${dest}`, error as Error)
      return err(
        createError('FILE_COPY_ERROR', `Failed to copy: ${src} -> ${dest}`, {
          cause: error as Error,
        })
      )
    }
  }

  async move(src: string, dest: string): Promise<Result<void>> {
    try {
      // Ensure destination directory exists
      const destDir = dirname(dest)
      await fsMkdir(destDir, { recursive: true })

      await fsRename(src, dest)
      this.logger?.debug(`Moved: ${src} -> ${dest}`)
      return ok(undefined)
    } catch (error) {
      this.logger?.error(`Failed to move: ${src} -> ${dest}`, error as Error)
      return err(
        createError('FILE_MOVE_ERROR', `Failed to move: ${src} -> ${dest}`, {
          cause: error as Error,
        })
      )
    }
  }

  async watch(
    path: string,
    options: WatchOptions,
    callback: (event: FileSystemEvent) => void
  ): Promise<Result<() => void>> {
    try {
      const watcher = chokidarWatch(path, {
        ignored: options.ignored,
        persistent: options.persistent ?? true,
        ignoreInitial: options.ignoreInitial ?? true,
        depth: options.depth,
      })

      watcher
        .on('add', (filePath, stats) => {
          callback({
            type: 'add',
            path: filePath,
            stats: stats
              ? {
                  path: filePath,
                  size: stats.size,
                  createdAt: stats.birthtime,
                  modifiedAt: stats.mtime,
                  isDirectory: false,
                  isFile: true,
                }
              : undefined,
          })
        })
        .on('change', (filePath, stats) => {
          callback({
            type: 'change',
            path: filePath,
            stats: stats
              ? {
                  path: filePath,
                  size: stats.size,
                  createdAt: stats.birthtime,
                  modifiedAt: stats.mtime,
                  isDirectory: false,
                  isFile: true,
                }
              : undefined,
          })
        })
        .on('unlink', (filePath) => {
          callback({ type: 'unlink', path: filePath })
        })
        .on('addDir', (dirPath) => {
          callback({ type: 'addDir', path: dirPath })
        })
        .on('unlinkDir', (dirPath) => {
          callback({ type: 'unlinkDir', path: dirPath })
        })

      this.logger?.info(`Started watching: ${path}`)

      // Return cleanup function
      const cleanup = () => {
        watcher.close()
        this.logger?.info(`Stopped watching: ${path}`)
      }

      return ok(cleanup)
    } catch (error) {
      this.logger?.error(`Failed to watch: ${path}`, error as Error)
      return err(
        createError('FILE_WATCH_ERROR', `Failed to watch: ${path}`, {
          cause: error as Error,
        })
      )
    }
  }
}
