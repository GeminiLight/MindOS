import { yellow } from './colors.js';

export function formatSyncDaemonStartupError(error, action = 'start') {
  const message = error instanceof Error ? error.message : String(error);
  return `Warning: sync daemon failed to ${action}: ${message}. Auto-sync will not run; manual "mindos sync now" still works.`;
}

export function startSyncDaemonBestEffort(startSyncDaemon, mindRoot, action = 'start') {
  if (!mindRoot) return;
  void startSyncDaemon(mindRoot).catch((error) => {
    console.warn(yellow(formatSyncDaemonStartupError(error, action)));
  });
}
