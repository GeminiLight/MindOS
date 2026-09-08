/**
 * Recursive directory watcher on top of Node's `fs.watch({ recursive: true })`
 * (stable on macOS, Windows and Linux with Node >= 22). Replaces the chokidar
 * dependency for the knowledge storage layer while keeping the chokidar-style
 * add / change / unlink / addDir / unlinkDir event vocabulary.
 *
 * `fs.watch` only reports "something happened at <path>"; the watcher keeps a
 * map of known entries and stats the reported path to classify the event.
 */

import { watch, type Dirent, type FSWatcher, type Stats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { FileMetadata, FileSystemEvent, WatchOptions } from './types.js'

type KnownKind = 'file' | 'dir'

export type LocalWatchHandle = {
  close(): void
}

export type LocalWatchCallbacks = {
  onEvent(event: FileSystemEvent): void
  onError?(error: Error): void
}

type IgnoreRule = string | RegExp

function ignoreRules(ignored: WatchOptions['ignored']): IgnoreRule[] {
  if (ignored === undefined) return []
  return Array.isArray(ignored) ? ignored : [ignored]
}

function toMetadata(path: string, stats: Stats): FileMetadata {
  return {
    path,
    size: stats.size,
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
  }
}

export async function startLocalWatch(
  root: string,
  options: WatchOptions,
  callbacks: LocalWatchCallbacks,
): Promise<LocalWatchHandle> {
  const absRoot = resolve(root)
  const rules = ignoreRules(options.ignored)
  const maxDepth = options.depth
  const known = new Map<string, KnownKind>()
  let closed = false
  // fs.watch events are processed strictly in order so a create followed by a
  // delete cannot be reported as delete-then-add.
  let queue: Promise<void> = Promise.resolve()

  function isIgnored(abs: string): boolean {
    if (rules.length === 0) return false
    const rel = relative(absRoot, abs).split(sep).join('/')
    const name = basename(abs)
    return rules.some((rule) => {
      if (typeof rule === 'string') return rule === abs || rule === rel || rule === name
      rule.lastIndex = 0
      return rule.test(abs) || rule.test(rel)
    })
  }

  /** Nesting level of an entry: 0 for direct children of the root. */
  function levelOf(abs: string): number {
    const rel = relative(absRoot, abs)
    if (!rel) return -1
    return rel.split(sep).length - 1
  }

  function withinDepth(abs: string): boolean {
    return maxDepth === undefined || levelOf(abs) <= maxDepth
  }

  function emit(event: FileSystemEvent): void {
    if (closed) return
    try {
      callbacks.onEvent(event)
    } catch (error) {
      callbacks.onError?.(error as Error)
    }
  }

  async function scan(dir: string, level: number, announce: boolean): Promise<void> {
    if (maxDepth !== undefined && level > maxDepth) return
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (closed) return
      const abs = join(dir, entry.name)
      if (isIgnored(abs)) continue
      if (entry.isDirectory()) {
        if (!known.has(abs)) {
          known.set(abs, 'dir')
          if (announce) emit({ type: 'addDir', path: abs })
        }
        await scan(abs, level + 1, announce)
      } else if (entry.isFile()) {
        if (known.has(abs)) continue
        known.set(abs, 'file')
        if (announce) {
          let stats: FileMetadata | undefined
          try {
            stats = toMetadata(abs, await stat(abs))
          } catch {
            stats = undefined
          }
          emit({ type: 'add', path: abs, stats })
        }
      }
    }
  }

  function forgetSubtree(dirAbs: string): void {
    const prefix = `${dirAbs}${sep}`
    for (const [path, kind] of [...known.entries()]) {
      if (!path.startsWith(prefix)) continue
      known.delete(path)
      emit({ type: kind === 'dir' ? 'unlinkDir' : 'unlink', path })
    }
  }

  async function inspect(abs: string): Promise<void> {
    if (closed || abs === absRoot) return
    if (!withinDepth(abs) || isIgnored(abs)) return
    let stats: Stats | null
    try {
      stats = await stat(abs)
    } catch {
      stats = null
    }
    const previous = known.get(abs)
    if (!stats) {
      if (!previous) return
      known.delete(abs)
      if (previous === 'dir') forgetSubtree(abs)
      emit({ type: previous === 'dir' ? 'unlinkDir' : 'unlink', path: abs })
      return
    }
    if (stats.isDirectory()) {
      if (previous === 'dir') return
      if (previous === 'file') {
        known.delete(abs)
        emit({ type: 'unlink', path: abs })
      }
      known.set(abs, 'dir')
      emit({ type: 'addDir', path: abs })
      // A directory moved into place may already contain files.
      await scan(abs, levelOf(abs) + 1, true)
      return
    }
    if (!stats.isFile()) return
    if (previous === 'dir') {
      forgetSubtree(abs)
      known.delete(abs)
      emit({ type: 'unlinkDir', path: abs })
    }
    const metadata = toMetadata(abs, stats)
    if (previous === 'file') {
      emit({ type: 'change', path: abs, stats: metadata })
      return
    }
    known.set(abs, 'file')
    emit({ type: 'add', path: abs, stats: metadata })
  }

  /** Platform reported an event without a filename: diff the whole tree. */
  async function rescan(): Promise<void> {
    if (closed) return
    const before = new Map(known)
    known.clear()
    await scan(absRoot, 0, false)
    for (const [path, kind] of before) {
      if (known.has(path)) continue
      emit({ type: kind === 'dir' ? 'unlinkDir' : 'unlink', path })
    }
    for (const [path, kind] of known) {
      if (before.has(path)) continue
      if (kind === 'dir') {
        emit({ type: 'addDir', path })
      } else {
        let stats: FileMetadata | undefined
        try {
          stats = toMetadata(path, await stat(path))
        } catch {
          stats = undefined
        }
        emit({ type: 'add', path, stats })
      }
    }
  }

  function enqueue(task: () => Promise<void>): void {
    queue = queue.then(task).catch((error: unknown) => {
      callbacks.onError?.(error as Error)
    })
  }

  let watcher: FSWatcher
  try {
    watcher = watch(absRoot, { recursive: true, persistent: options.persistent ?? true })
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  const handle: LocalWatchHandle = {
    close() {
      if (closed) return
      closed = true
      try {
        watcher.close()
      } catch {
        // Closing a dead watcher must never throw into the caller.
      }
      known.clear()
    },
  }

  watcher.on('error', (error) => {
    callbacks.onError?.(error)
    handle.close()
  })
  watcher.on('change', (_eventType, filename) => {
    if (closed) return
    if (filename === null || filename === undefined) {
      enqueue(rescan)
      return
    }
    const abs = join(absRoot, String(filename))
    enqueue(() => inspect(abs))
  })

  // Seed the known map (and emit the initial listing when requested) after the
  // watcher is armed so nothing created during the scan is missed.
  await scan(absRoot, 0, options.ignoreInitial === false)
  return handle
}
