/**
 * In-memory file system implementation for testing
 */

import type { Result } from '../../foundation/shared/index.js'
import { ok, err } from '../../foundation/shared/index.js'
import { createError } from '../../foundation/errors/index.js'
import type {
  IFileSystem,
  FileMetadata,
  DirectoryEntry,
  FileSystemEvent,
  WatchOptions,
} from './types.js'

interface MemoryNode {
  type: 'file' | 'directory'
  content?: string
  children?: Map<string, MemoryNode>
  createdAt: Date
  modifiedAt: Date
}

/**
 * In-memory file system for testing
 */
export class MemoryFileSystem implements IFileSystem {
  private root: MemoryNode = {
    type: 'directory',
    children: new Map(),
    createdAt: new Date(),
    modifiedAt: new Date(),
  }

  private watchers: Map<string, Set<(event: FileSystemEvent) => void>> = new Map()

  async readFile(path: string): Promise<Result<string>> {
    const node = this.getNode(path)
    if (!node) {
      return err(createError('NOT_FOUND', `File not found: ${path}`))
    }
    if (node.type !== 'file') {
      return err(createError('VALIDATION_ERROR', `Not a file: ${path}`))
    }
    return ok(node.content ?? '')
  }

  async writeFile(path: string, content: string): Promise<Result<void>> {
    const parts = path.split('/').filter(Boolean)
    const fileName = parts.pop()
    if (!fileName) {
      return err(createError('VALIDATION_ERROR', 'Invalid path'))
    }

    // Ensure parent directory exists
    const parentPath = '/' + parts.join('/')
    const mkdirResult = await this.mkdir(parentPath, true)
    if (!mkdirResult.ok) {
      return mkdirResult
    }

    const parent = this.getNode(parentPath)
    if (!parent || parent.type !== 'directory') {
      return err(createError('VALIDATION_ERROR', `Parent is not a directory: ${parentPath}`))
    }

    const existingNode = parent.children?.get(fileName)
    const now = new Date()

    if (existingNode) {
      existingNode.content = content
      existingNode.modifiedAt = now
      this.emitEvent({ type: 'change', path })
    } else {
      parent.children?.set(fileName, {
        type: 'file',
        content,
        createdAt: now,
        modifiedAt: now,
      })
      this.emitEvent({ type: 'add', path })
    }

    return ok(undefined)
  }

  async exists(path: string): Promise<Result<boolean>> {
    return ok(this.getNode(path) !== null)
  }

  async stat(path: string): Promise<Result<FileMetadata>> {
    const node = this.getNode(path)
    if (!node) {
      return err(createError('NOT_FOUND', `Path not found: ${path}`))
    }

    const metadata: FileMetadata = {
      path,
      size: node.type === 'file' ? (node.content?.length ?? 0) : 0,
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      isDirectory: node.type === 'directory',
      isFile: node.type === 'file',
    }

    return ok(metadata)
  }

  async readdir(path: string): Promise<Result<DirectoryEntry[]>> {
    const node = this.getNode(path)
    if (!node) {
      return err(createError('NOT_FOUND', `Directory not found: ${path}`))
    }
    if (node.type !== 'directory') {
      return err(createError('VALIDATION_ERROR', `Not a directory: ${path}`))
    }

    const entries: DirectoryEntry[] = []
    for (const [name, child] of node.children ?? []) {
      entries.push({
        name,
        path: `${path}/${name}`.replace(/\/+/g, '/'),
        isDirectory: child.type === 'directory',
        isFile: child.type === 'file',
      })
    }

    return ok(entries)
  }

  async mkdir(path: string, recursive = true): Promise<Result<void>> {
    if (path === '/' || path === '') {
      return ok(undefined)
    }

    const parts = path.split('/').filter(Boolean)
    let current = this.root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const existing = current.children?.get(part)

      if (existing) {
        if (existing.type !== 'directory') {
          return err(createError('VALIDATION_ERROR', `Not a directory: ${part}`))
        }
        current = existing
      } else {
        if (!recursive && i < parts.length - 1) {
          return err(createError('NOT_FOUND', `Parent directory not found`))
        }

        const newDir: MemoryNode = {
          type: 'directory',
          children: new Map(),
          createdAt: new Date(),
          modifiedAt: new Date(),
        }
        current.children?.set(part, newDir)
        current = newDir

        const dirPath = '/' + parts.slice(0, i + 1).join('/')
        this.emitEvent({ type: 'addDir', path: dirPath })
      }
    }

    return ok(undefined)
  }

  async remove(path: string, recursive = false): Promise<Result<void>> {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) {
      return err(createError('VALIDATION_ERROR', 'Cannot remove root'))
    }

    const parentPath = '/' + parts.join('/')
    const parent = this.getNode(parentPath)
    if (!parent || parent.type !== 'directory') {
      return err(createError('NOT_FOUND', `Parent not found: ${parentPath}`))
    }

    const node = parent.children?.get(name)
    if (!node) {
      return err(createError('NOT_FOUND', `Path not found: ${path}`))
    }

    if (node.type === 'directory' && !recursive && node.children?.size) {
      return err(createError('VALIDATION_ERROR', 'Directory not empty'))
    }

    parent.children?.delete(name)
    this.emitEvent({
      type: node.type === 'directory' ? 'unlinkDir' : 'unlink',
      path,
    })

    return ok(undefined)
  }

  async copy(src: string, dest: string): Promise<Result<void>> {
    const srcNode = this.getNode(src)
    if (!srcNode) {
      return err(createError('NOT_FOUND', `Source not found: ${src}`))
    }

    if (srcNode.type === 'file') {
      return this.writeFile(dest, srcNode.content ?? '')
    }

    // Copy directory recursively
    const mkdirResult = await this.mkdir(dest, true)
    if (!mkdirResult.ok) {
      return mkdirResult
    }

    for (const [name, child] of srcNode.children ?? []) {
      const childSrc = `${src}/${name}`.replace(/\/+/g, '/')
      const childDest = `${dest}/${name}`.replace(/\/+/g, '/')
      const copyResult = await this.copy(childSrc, childDest)
      if (!copyResult.ok) {
        return copyResult
      }
    }

    return ok(undefined)
  }

  async move(src: string, dest: string): Promise<Result<void>> {
    const copyResult = await this.copy(src, dest)
    if (!copyResult.ok) {
      return copyResult
    }

    return this.remove(src, true)
  }

  async watch(
    path: string,
    _options: WatchOptions,
    callback: (event: FileSystemEvent) => void
  ): Promise<Result<() => void>> {
    const callbacks = this.watchers.get(path) ?? new Set()
    callbacks.add(callback)
    this.watchers.set(path, callbacks)

    const cleanup = () => {
      const callbacks = this.watchers.get(path)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.watchers.delete(path)
        }
      }
    }

    return ok(cleanup)
  }

  private getNode(path: string): MemoryNode | null {
    if (path === '/' || path === '') {
      return this.root
    }

    const parts = path.split('/').filter(Boolean)
    let current = this.root

    for (const part of parts) {
      const next = current.children?.get(part)
      if (!next) {
        return null
      }
      current = next
    }

    return current
  }

  private emitEvent(event: FileSystemEvent): void {
    for (const [watchPath, callbacks] of this.watchers) {
      if (event.path.startsWith(watchPath)) {
        for (const callback of callbacks) {
          callback(event)
        }
      }
    }
  }
}
