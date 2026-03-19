'use client';

import { useSyncExternalStore, useCallback } from 'react';

/**
 * Lightweight pub/sub store for cross-component AskModal control.
 * Replaces KeyboardEvent dispatch pattern with typed, testable API.
 * No external dependencies (no zustand needed).
 */

interface AskModalState {
  open: boolean;
  initialMessage: string;
  source: 'user' | 'guide' | 'guide-next';  // who triggered the open
}

let state: AskModalState = { open: false, initialMessage: '', source: 'user' };
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getSnapshot() { return state; }

export function openAskModal(message = '', source: AskModalState['source'] = 'user') {
  state = { open: true, initialMessage: message, source };
  emit();
}

export function closeAskModal() {
  state = { open: false, initialMessage: '', source: 'user' };
  emit();
}

export function useAskModal() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    open: snap.open,
    initialMessage: snap.initialMessage,
    source: snap.source,
    openWith: useCallback((message: string, source: AskModalState['source'] = 'user') => openAskModal(message, source), []),
    close: useCallback(() => closeAskModal(), []),
  };
}
