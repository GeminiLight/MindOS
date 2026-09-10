/**
 * Staged directory swap: the stage → validate → backup → rename → rollback
 * pattern shared by plugin-shaped installs.
 *
 * Both install paths used to hand-roll it: the agent runtime extension
 * handler (`server/handlers/runtime-extensions.ts`) and the Obsidian
 * community plugin installer/updater (`web/lib/obsidian-compat/
 * community-install.ts`). This primitive keeps the rollback semantics that
 * their tests pin down:
 *
 * - populate/validate failures never touch the target;
 * - a failed publish rename restores the backup and removes the stage;
 * - after a successful swap, backup cleanup failure is either tolerated
 *   (community update: a stale hidden backup beats reporting a failed update)
 *   or rethrown without rolling back the published target (runtime
 *   extension semantics).
 *
 * The swap is synchronous on purpose: both call sites live inside sync
 * handler flows (the community update awaits its async `beforeSwap` hook
 * before entering the staged section). `fs` is imported as the default
 * binding because the community-install tests intercept
 * `vi.spyOn(fs, 'renameSync')`, which only works through the same binding.
 */

import fs from 'fs';
import path from 'path';

export interface StagedDirectorySwapOptions<TPayload> {
  /** Directory the stage (and backup) dirs are created in. Default: parent of targetDir. */
  stageParentDir?: string;
  /** Prefix passed to mkdtempSync for the stage dir. Default `.staging-`. */
  stagePrefix?: string;
  /** Prefix for the unique backup dir name. Default `.backup-`. */
  backupPrefix?: string;
  /** When false (default) an existing target aborts before staging; when true it is backed up and replaced. */
  replace?: boolean;
  /** Error message for the `replace: false` + existing target abort. */
  existsMessage?: string;
  /** Sync check on the staged content, run after populate and before beforeSwap. Throws to abort. */
  validate?: (stageDir: string) => void;
  /** Sync hook after populate+validate and before any rename. Throws to abort. */
  beforeSwap?: () => void;
  /** Hook after the stage→target rename succeeded, before backup cleanup. May return a result payload. */
  onSwapped?: (targetDir: string) => TPayload;
  /**
   * After a *successful* swap, swallow backup cleanup errors (the community
   * update keeps a stale hidden backup instead of failing the update).
   * Pre-swap failures always roll back regardless. Default false.
   */
  tolerateBackupCleanupFailure?: boolean;
}

export interface StagedDirectorySwapResult<TPayload> {
  targetDir: string;
  /** True when an existing target was backed up and replaced. */
  replaced: boolean;
  /** Whatever `onSwapped` returned (undefined when the hook is absent). */
  payload?: TPayload;
}

export function stagedDirectorySwap<TPayload = undefined>(
  targetDir: string,
  populate: (stageDir: string) => void,
  options: StagedDirectorySwapOptions<TPayload> = {},
): StagedDirectorySwapResult<TPayload> {
  const stageParentDir = options.stageParentDir ?? path.dirname(targetDir);
  const stagePrefix = options.stagePrefix ?? '.staging-';
  const backupPrefix = options.backupPrefix ?? '.backup-';
  const replace = options.replace === true;

  if (!replace && pathExists(targetDir)) {
    throw new Error(options.existsMessage ?? `Target directory already exists: ${targetDir}`);
  }

  fs.mkdirSync(stageParentDir, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(stageParentDir, stagePrefix));
  let backupDir: string | undefined;
  let backedUp = false;
  let swapped = false;
  try {
    populate(stageDir);
    options.validate?.(stageDir);
    options.beforeSwap?.();

    if (replace && pathExists(targetDir)) {
      backupDir = allocateBackupDir(stageParentDir, backupPrefix);
      fs.renameSync(targetDir, backupDir);
      backedUp = true;
    } else if (pathExists(targetDir)) {
      // Lost a race with a concurrent install between the pre-check and here.
      throw new Error(options.existsMessage ?? `Target directory already exists: ${targetDir}`);
    }

    fs.renameSync(stageDir, targetDir);
    swapped = true;

    const payload = options.onSwapped ? options.onSwapped(targetDir) : undefined;

    if (backupDir) {
      const finishedBackup = backupDir;
      backupDir = undefined;
      try {
        fs.rmSync(finishedBackup, { recursive: true, force: true });
      } catch (error) {
        if (!options.tolerateBackupCleanupFailure) throw error;
        // The new content is already published; a stale hidden backup is safer
        // than reporting a failed swap after the fact.
      }
    }

    return { targetDir, replaced: backedUp, ...(payload !== undefined ? { payload } : {}) };
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    if (backupDir) {
      const pendingBackup = backupDir;
      backupDir = undefined;
      if (!swapped && !pathExists(targetDir) && pathExists(pendingBackup)) {
        fs.renameSync(pendingBackup, targetDir);
      } else {
        fs.rmSync(pendingBackup, { recursive: true, force: true });
      }
    }
    throw error;
  }
}

function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Non-existent unique backup path (rename requires the destination to be
 * free). Mirrors the community installer's `uniqueHiddenDirPath` loop.
 */
function allocateBackupDir(parentDir: string, prefix: string): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(parentDir, `${prefix}${Date.now()}-${process.pid}-${attempt}`);
    if (!pathExists(candidate)) return candidate;
  }
  throw new Error(`Could not allocate staged backup directory under: ${parentDir}`);
}
