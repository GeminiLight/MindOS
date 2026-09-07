import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OWNER = /^owner-(\d+)-[a-f0-9-]+$/;
const BUSY = new Set(['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR', 'EPERM']);

export function withConnectionRegistryLock<T>(lock: string, operation: () => T): T {
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  const owner = `owner-${process.pid}-${randomUUID()}`;
  const pending = `${lock}.${owner}.pending`;
  mkdirSync(pending, { mode: 0o700 });
  try {
    writeFileSync(join(pending, owner), '', { flag: 'wx', mode: 0o600 });
    recoverOrphan(lock);
    // Publish a NONEMPTY directory atomically: there is no ownerless acquisition window.
    // rename cannot replace another nonempty directory, including a new owner's lock.
    renameSync(pending, lock);
  } catch (error) {
    releaseOwner(pending, owner);
    if (BUSY.has((error as NodeJS.ErrnoException).code ?? '')) {
      throw new Error('Connection registry is busy; retry the operation.');
    }
    throw error;
  }
  try { return operation(); } finally { releaseOwner(lock, owner); }
}

function releaseOwner(lock: string, owner: string): void {
  // Never recursively delete a lock: another process may already own this path.
  try { unlinkSync(join(lock, owner)); } catch { /* removed already, or preserve on failure */ }
  try { rmdirSync(lock); } catch { /* a replacement owner makes the directory nonempty */ }
}

function processIsGone(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

function recoverOrphan(lock: string): void {
  try {
    const before = lstatSync(lock);
    if (Date.now() - before.mtimeMs < 30_000) return;
    if (before.isDirectory()) {
      const entries = readdirSync(lock);
      if (entries.length === 0) { try { rmdirSync(lock); } catch { /* another owner won */ } return; }
      if (entries.length !== 1) return;
      const owner = entries[0]!;
      const match = OWNER.exec(owner);
      if (match && processIsGone(Number(match[1]))) releaseOwner(lock, owner);
      return;
    }
    // One-time compatibility with the old file lock. New versions never create it.
    if (!before.isFile() || before.size > 256) return;
    const content = readFileSync(lock, 'utf8');
    if (content.length > 0) {
      let pid: unknown;
      try { pid = JSON.parse(content).pid; } catch { return; }
      if (!processIsGone(pid)) return;
    }
    const current = lstatSync(lock);
    if (current.isFile() && current.ino === before.ino && current.mtimeMs === before.mtimeMs) unlinkSync(lock);
  } catch (error) {
    // A concurrent reaper/owner won. Acquisition below remains authoritative.
    if (!['ENOENT', 'ENOTDIR', 'EISDIR', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}
