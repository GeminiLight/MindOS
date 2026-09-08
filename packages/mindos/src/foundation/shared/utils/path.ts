/**
 * Path utilities
 */

import os from 'node:os'
import { join, resolve, relative, dirname, basename, extname, normalize, sep } from 'node:path'
import type { FilePath } from '../types/index.js'

/**
 * Normalize path separators to forward slashes
 */
export function normalizePath(path: FilePath): FilePath {
  return path.split(sep).join('/')
}

/**
 * Join path segments
 */
export function joinPath(...segments: string[]): FilePath {
  return normalizePath(join(...segments))
}

/**
 * Resolve absolute path
 */
export function resolvePath(...segments: string[]): FilePath {
  return normalizePath(resolve(...segments))
}

/**
 * Get relative path
 */
export function relativePath(from: FilePath, to: FilePath): FilePath {
  return normalizePath(relative(from, to))
}

/**
 * Get directory name
 */
export function getDirname(path: FilePath): FilePath {
  return normalizePath(dirname(path))
}

/**
 * Get base name
 */
export function getBasename(path: FilePath, ext?: string): string {
  return basename(path, ext)
}

/**
 * Get file extension
 */
export function getExtension(path: FilePath): string {
  return extname(path)
}

/**
 * Check if path is absolute
 */
export function isAbsolutePath(path: FilePath): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:/.test(path)
}

/**
 * Ensure path is absolute
 */
export function ensureAbsolutePath(path: FilePath, base?: FilePath): FilePath {
  if (isAbsolutePath(path)) {
    return normalizePath(path)
  }
  return resolvePath(base ?? process.cwd(), path)
}

/**
 * Expand a leading `~`, `~/` or `~\` to the home directory. Shared by the
 * server handlers, the Web MCP adapters, the ACP detector and the CLI so the
 * "~ means home" rule lives in exactly one place. `os.homedir()` is read at
 * call time (default import) so tests can spy on it.
 */
export function expandHome(input: string, homeDir: string = os.homedir()): string {
  if (input === '~') return homeDir
  if (input.startsWith('~/') || input.startsWith('~\\')) return resolve(homeDir, input.slice(2))
  return input
}

/** Expand Windows-style `%VAR%` references; unknown names are left as-is. */
export function expandWindowsEnvVars(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name: string) => env[name] ?? match)
}
