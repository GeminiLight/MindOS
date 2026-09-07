import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveExistingSafe } from '../foundation/security/index.js';
import { LearningError } from './learning/model.js';

function directory(root: string) {
  const canonical = fs.realpathSync(root);
  const base = path.join(os.homedir(), '.mindos', 'private-learning');
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const physical = fs.realpathSync(base);
  const relative = path.relative(canonical, physical);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  )
    throw new LearningError(
      'storage',
      'Private learning storage must be outside the knowledge root.',
    );
  const dir = resolveExistingSafe(
    physical,
    createHash('sha256').update(canonical).digest('hex').slice(0, 24),
  );
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function file(root: string, name: string) {
  if (!/^(transfer|methodcheck|study|cohort|inquiry|comparison)-[a-f0-9]{24}\.json$/.test(name))
    throw new LearningError('invalid', 'Invalid private record id.');
  return resolveExistingSafe(directory(root), name);
}
export function privateRecordNames(root: string): string[] {
  return fs.readdirSync(directory(root));
}
export function readPrivateRecord(
  root: string,
  name: string,
  maxBytes: number,
): unknown | null {
  try {
    const target = file(root, name);
    if (fs.statSync(target).size > maxBytes)
      throw new Error('Private record exceeds size bound');
    const value: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (value === null) throw new Error('Private record is null');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof LearningError) throw error;
    throw new LearningError(
      'storage',
      'Could not read this private record. Existing data was preserved.',
    );
  }
}
export function writePrivateRecord(
  root: string,
  name: string,
  value: unknown,
  maxBytes = Infinity,
) {
  const serialized = JSON.stringify(value, null, 2);
  // Match the reader's byte budget before publishing, including multibyte text.
  if (Buffer.byteLength(serialized) > maxBytes)
    throw new LearningError(
      'storage',
      'This record has reached its storage limit. Existing data was preserved.',
    );
  const target = file(root, name);
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, serialized, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temp, target);
  } catch {
    throw new LearningError(
      'storage',
      'Could not save this private record. Please retry.',
    );
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* Successful rename removed the temporary file. */
    }
  }
}
export function withPrivateRecordLock<T>(root: string, action: () => T): T {
  const lock = resolveExistingSafe(directory(root), '.lock');
  let acquired = false;
  try {
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 30_000)
      fs.unlinkSync(lock);
    try {
      fs.writeFileSync(lock, '', { mode: 0o600, flag: 'wx' });
      acquired = true;
    } catch {
      throw new LearningError(
        'conflict',
        'A private record is being saved. Please retry.',
      );
    }
    return action();
  } finally {
    if (acquired) fs.unlinkSync(lock);
  }
}
