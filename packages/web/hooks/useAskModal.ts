'use client';

import { useSyncExternalStore, useCallback } from 'react';
import type { AgentIdentity, AgentRuntimeIdentity } from '@/lib/types';

/**
 * Lightweight pub/sub store for cross-component AskModal control.
 * Replaces KeyboardEvent dispatch pattern with typed, testable API.
 * No external dependencies (no zustand needed).
 */

export type AcpAgentSelection = AgentIdentity;
export type AskAgentRuntimeSelection = AgentRuntimeIdentity;

interface AskModalState {
  open: boolean;
  initialMessage: string;
  source: 'user' | 'guide' | 'guide-next';  // who triggered the open
  acpAgent: AcpAgentSelection | null;
  agentRuntime: AskAgentRuntimeSelection | null;
  newSession: boolean;
  requestId: number;
}

let requestId = 0;
let state: AskModalState = {
  open: false,
  initialMessage: '',
  source: 'user',
  acpAgent: null,
  agentRuntime: null,
  newSession: false,
  requestId,
};
const listeners = new Set<() => void>();

function emit() { listeners.forEach(l => l()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function getSnapshot() { return state; }

function toRuntimeSelection(agent: AcpAgentSelection | AskAgentRuntimeSelection | null): AskAgentRuntimeSelection | null {
  if (!agent) return null;
  return 'kind' in agent ? agent : { ...agent, kind: 'acp' };
}

export function openAskModal(
  message = '',
  source: AskModalState['source'] = 'user',
  agent: AcpAgentSelection | AskAgentRuntimeSelection | null = null,
  options: { newSession?: boolean } = {},
) {
  const agentRuntime = toRuntimeSelection(agent);
  const acpAgent = agentRuntime?.kind === 'acp'
    ? { id: agentRuntime.id, name: agentRuntime.name }
    : null;
  state = {
    open: true,
    initialMessage: message,
    source,
    acpAgent,
    agentRuntime,
    newSession: Boolean(options.newSession),
    requestId: ++requestId,
  };
  emit();
}

export function closeAskModal() {
  state = {
    open: false,
    initialMessage: '',
    source: 'user',
    acpAgent: null,
    agentRuntime: null,
    newSession: false,
    requestId,
  };
  emit();
}

export function useAskModal() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    open: snap.open,
    initialMessage: snap.initialMessage,
    source: snap.source,
    acpAgent: snap.acpAgent,
    agentRuntime: snap.agentRuntime,
    newSession: snap.newSession,
    requestId: snap.requestId,
    openWith: useCallback((
      message: string,
      source: AskModalState['source'] = 'user',
      agent: AcpAgentSelection | AskAgentRuntimeSelection | null = null,
      options: { newSession?: boolean } = {},
    ) => openAskModal(message, source, agent, options), []),
    close: useCallback(() => closeAskModal(), []),
  };
}
