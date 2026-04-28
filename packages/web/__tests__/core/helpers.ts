import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Creates a temporary directory to use as MIND_ROOT for testing.
 * Returns the absolute path.
 */
export function mkTempMindRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-test-'));
}

/**
 * Removes a temporary MIND_ROOT directory and all its contents.
 */
export function cleanupMindRoot(mindRoot: string): void {
  fs.rmSync(mindRoot, { recursive: true, force: true });
}

/**
 * Creates a file within the temporary mindRoot with the given content.
 * Creates parent directories as needed.
 */
export function seedFile(mindRoot: string, relativePath: string, content: string): void {
  const abs = path.join(mindRoot, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/**
 * Reads a file from the temporary mindRoot.
 */
export function readSeeded(mindRoot: string, relativePath: string): string {
  return fs.readFileSync(path.join(mindRoot, relativePath), 'utf-8');
}
