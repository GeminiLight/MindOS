import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { MINDOS_DIR } from './constants.js';

const STATUS_PATH = resolve(MINDOS_DIR, 'update-status.json');

const STAGE_ORDER = ['downloading', 'skills', 'rebuilding', 'restarting'];

/**
 * Write update progress to ~/.mindos/update-status.json.
 *
 * @param {'downloading'|'skills'|'rebuilding'|'restarting'|'done'|'failed'} stage
 * @param {{ error?: string, fromVersion?: string, toVersion?: string }} [opts]
 */
export function writeUpdateStatus(stage, opts = {}) {
  const stages = STAGE_ORDER.map((id) => {
    const idx = STAGE_ORDER.indexOf(id);
    const currentIdx = STAGE_ORDER.indexOf(stage);
    let status = 'pending';
    if (stage === 'done' || stage === 'failed') {
      // done: all stages done; failed: stages up to current are done, current is failed
      if (stage === 'done') {
        status = 'done';
      } else {
        // For 'failed', we don't know which stage failed from just 'failed'
        // So we keep whatever was last written — this function is called per-stage
        status = 'pending';
      }
    } else if (idx < currentIdx) {
      status = 'done';
    } else if (idx === currentIdx) {
      status = 'running';
    }
    return { id, status };
  });

  // For 'done', mark all as done
  if (stage === 'done') {
    stages.forEach((s) => { s.status = 'done'; });
  }

  const data = {
    stage,
    stages,
    error: opts.error || null,
    version: {
      from: opts.fromVersion || null,
      to: opts.toVersion || null,
    },
    startedAt: stage === 'downloading'
      ? new Date().toISOString()
      : readCurrentStartedAt(),
  };

  try {
    writeFileSync(STATUS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* best-effort — directory may not exist yet */ }
}

/**
 * Mark a specific stage as failed. Preserves progress of prior stages.
 */
export function writeUpdateFailed(failedStage, errorMessage, opts = {}) {
  const stages = STAGE_ORDER.map((id) => {
    const idx = STAGE_ORDER.indexOf(id);
    const failedIdx = STAGE_ORDER.indexOf(failedStage);
    if (idx < failedIdx) return { id, status: 'done' };
    if (idx === failedIdx) return { id, status: 'failed' };
    return { id, status: 'pending' };
  });

  const data = {
    stage: 'failed',
    stages,
    error: errorMessage,
    version: {
      from: opts.fromVersion || null,
      to: opts.toVersion || null,
    },
    startedAt: readCurrentStartedAt(),
  };

  try {
    writeFileSync(STATUS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Read the current update status. Returns null if no status file.
 */
export function readUpdateStatus() {
  try {
    return JSON.parse(readFileSync(STATUS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Remove the status file (called on startup to clear stale state).
 */
export function clearUpdateStatus() {
  try {
    if (existsSync(STATUS_PATH)) unlinkSync(STATUS_PATH);
  } catch { /* best-effort */ }
}

function readCurrentStartedAt() {
  try {
    const existing = JSON.parse(readFileSync(STATUS_PATH, 'utf-8'));
    return existing.startedAt || new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}
