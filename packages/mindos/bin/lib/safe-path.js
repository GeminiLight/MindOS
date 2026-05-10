import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';

export function normalizeCliPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function nearestExistingPath(resolved) {
  let current = resolved;
  while (!existsSync(current)) {
    const parent = resolve(current, '..');
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function assertInsideRoot(resolved, root) {
  const rel = relative(root, resolved);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('Access denied: path outside knowledge base');
  }
}

export function resolveInsideRoot(root, filePath = '') {
  const rootResolved = resolve(root);
  const normalizedFilePath = normalizeCliPath(filePath);

  if (
    normalizedFilePath
    && (
      isAbsolute(normalizedFilePath)
      || win32.isAbsolute(String(filePath))
      || win32.isAbsolute(normalizedFilePath)
    )
  ) {
    throw new Error('Access denied: path outside knowledge base');
  }

  const resolved = normalizedFilePath ? resolve(rootResolved, normalizedFilePath) : rootResolved;
  try {
    assertInsideRoot(resolved, rootResolved);
  } catch {
    throw new Error('Access denied: path outside knowledge base');
  }

  const existing = nearestExistingPath(resolved);
  try {
    const rootReal = realpathSync(rootResolved);
    const existingReal = realpathSync(existing);
    assertInsideRoot(existingReal, rootReal);
  } catch {
    throw new Error('Access denied: path outside knowledge base');
  }

  return resolved;
}
