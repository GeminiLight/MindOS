import type { Result } from '../../foundation/shared/index.js'
import { err } from '../../foundation/shared/index.js'
import { createError } from '../../foundation/errors/index.js'
import { resolveSafe, validatePath } from '../../foundation/security/index.js'
import { isAbsolute } from 'node:path'
import type {
  DirectoryEntry,
  FileMetadata,
  FileSystemEvent,
  IFileSystem,
  WatchOptions,
} from './types.js'

/**
 * Root-scoped filesystem wrapper.
 *
 * Public methods accept MindOS-relative paths and validate them before
 * delegating to an underlying filesystem that works with absolute paths.
 */
export class RootedFileSystem implements IFileSystem {
  constructor(
    private readonly rootPath: string,
    private readonly fs: IFileSystem
  ) {}

  async readFile(path: string, encoding?: BufferEncoding): Promise<Result<string>> {
    const resolved = this.resolve(path)
    if (!resolved.ok) return resolved
    return this.fs.readFile(resolved.value, encoding)
  }

  async writeFile(
    path: string,
    content: string,
    encoding?: BufferEncoding
  ): Promise<Result<void>> {
    const resolved = this.resolve(path, 'write')
    if (!resolved.ok) return resolved
    return this.fs.writeFile(resolved.value, content, encoding)
  }

  async exists(path: string): Promise<Result<boolean>> {
    const resolved = this.resolve(path)
    if (!resolved.ok) return resolved
    return this.fs.exists(resolved.value)
  }

  async stat(path: string): Promise<Result<FileMetadata>> {
    const resolved = this.resolve(path)
    if (!resolved.ok) return resolved
    return this.fs.stat(resolved.value)
  }

  async readdir(path: string): Promise<Result<DirectoryEntry[]>> {
    const resolved = this.resolve(path)
    if (!resolved.ok) return resolved
    return this.fs.readdir(resolved.value)
  }

  async mkdir(path: string, recursive = true): Promise<Result<void>> {
    const resolved = this.resolve(path, 'create')
    if (!resolved.ok) return resolved
    return this.fs.mkdir(resolved.value, recursive)
  }

  async remove(path: string, recursive = false): Promise<Result<void>> {
    const resolved = this.resolve(path, 'remove')
    if (!resolved.ok) return resolved
    return this.fs.remove(resolved.value, recursive)
  }

  async copy(src: string, dest: string): Promise<Result<void>> {
    const resolvedSrc = this.resolve(src)
    if (!resolvedSrc.ok) return resolvedSrc
    const resolvedDest = this.resolve(dest, 'copy')
    if (!resolvedDest.ok) return resolvedDest
    return this.fs.copy(resolvedSrc.value, resolvedDest.value)
  }

  async move(src: string, dest: string): Promise<Result<void>> {
    const resolvedSrc = this.resolve(src, 'move')
    if (!resolvedSrc.ok) return resolvedSrc
    const resolvedDest = this.resolve(dest, 'move')
    if (!resolvedDest.ok) return resolvedDest
    return this.fs.move(resolvedSrc.value, resolvedDest.value)
  }

  async watch(
    path: string,
    options: WatchOptions,
    callback: (event: FileSystemEvent) => void
  ): Promise<Result<() => void>> {
    const resolved = this.resolve(path)
    if (!resolved.ok) return resolved
    return this.fs.watch(resolved.value, options, callback)
  }

  private resolve(path: string, operation?: string): Result<string> {
    try {
      if (isAbsolute(path)) {
        return err(
          createError('VALIDATION_ERROR', 'Access denied: absolute paths are not allowed', {
            context: { root: this.rootPath, path, operation },
          })
        )
      }

      if (operation) {
        return validatePath(this.rootPath, path, operation)
      }
      return { ok: true, value: resolveSafe(this.rootPath, path) }
    } catch (error) {
      return err(
        createError('VALIDATION_ERROR', 'Path validation failed', {
          context: { root: this.rootPath, path, operation },
          cause: error as Error,
        })
      )
    }
  }
}
