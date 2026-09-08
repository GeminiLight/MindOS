/**
 * Hidden-files visibility store (localStorage-backed, reactive via useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react';
import type { FileNode } from '@/lib/types';
import { SYSTEM_FILES } from '@/lib/types';

const HIDDEN_FILES_KEY = 'show-hidden-files';

function subscribeHiddenFiles(cb: () => void) {
  const handler = (e: StorageEvent) => { if (e.key === HIDDEN_FILES_KEY) cb(); };
  const custom = () => cb();
  window.addEventListener('storage', handler);
  window.addEventListener('mindos:hidden-files-changed', custom);
  return () => {
    window.removeEventListener('storage', handler);
    window.removeEventListener('mindos:hidden-files-changed', custom);
  };
}

// In-memory fallback when storage is unavailable (Safari "block all cookies"
// throws SecurityError on every localStorage access).
let memoryValue = false;

function getShowHiddenFiles() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(HIDDEN_FILES_KEY) === 'true';
  } catch {
    return memoryValue;
  }
}

export function setShowHiddenFiles(value: boolean) {
  memoryValue = value;
  try {
    localStorage.setItem(HIDDEN_FILES_KEY, String(value));
  } catch {
    // Storage blocked; the in-memory value still drives this session.
  }
  window.dispatchEvent(new Event('mindos:hidden-files-changed'));
}

export function useShowHiddenFiles() {
  return useSyncExternalStore(subscribeHiddenFiles, getShowHiddenFiles, () => false);
}

/** Filter out hidden entries (dot-files at root, system files) when show-hidden is off. */
export function filterHiddenNodes(nodes: FileNode[], isRoot: boolean): FileNode[] {
  return nodes.filter(node => {
    if (isRoot && node.name.startsWith('.')) return false;
    if (node.type === 'file' && SYSTEM_FILES.has(node.name)) return false;
    if (node.type === 'directory' && node.name.startsWith('.')) return false;
    return true;
  });
}
