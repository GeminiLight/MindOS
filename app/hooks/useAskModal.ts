'use client';

import { useSyncExternalStore, useCallback } from 'react';

/**
 * Lightweight pub/sub store for cross-component AskModal control.
 * Replaces KeyboardEvent dispatch pattern with typed, testable API.
 * No external dependencies (no zustand needed).
 */

export interface AcpAgentSelection {
  id: string;
  name: string;
}

interface AskModalState {
  open: boolean;
  initialMessage: string;
  source: 'user' | 'guide' | 'guide-next';  // who triggered the open
  acpAgent: AcpAgentSelection | null;
}

let state: AskModalState = { open: false, initialMessage: '', source: 'user', acpAgent: null };
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getSnapshot() { return state; }

export function openAskModal(message = '', source: AskModalState['source'] = 'user', acpAgent: AcpAgentSelection | null = null) {
  state = { open: true, initialMessage: message, source, acpAgent };
  emit();
}

export function closeAskModal() {
  state = { open: false, initialMessage: '', source: 'user', acpAgent: null };
  emit();
}

export function useAskModal() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    open: snap.open,
    initialMessage: snap.initialMessage,
    source: snap.source,
    acpAgent: snap.acpAgent,
    openWith: useCallback((message: string, source: AskModalState['source'] = 'user', acpAgent: AcpAgentSelection | null = null) => openAskModal(message, source, acpAgent), []),
    close: useCallback(() => closeAskModal(), []),
  };
}
