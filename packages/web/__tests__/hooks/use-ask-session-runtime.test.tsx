/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAskSession } from '@/hooks/useAskSession';
import { getSessionAgentRuntime, isSessionInRuntimeLane } from '@/lib/ask-agent';
import type { AgentRuntimeIdentity } from '@/lib/types';

const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };
const claudeRuntime: AgentRuntimeIdentity = { id: 'claude', name: 'Claude Code', kind: 'claude' };

type AskSessionState = ReturnType<typeof useAskSession>;

function renderUseAskSession(): {
  getLatest: () => AskSessionState;
  root: Root;
} {
  let latest: AskSessionState | null = null;

  function Probe() {
    latest = useAskSession();
    return null;
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(React.createElement(Probe));
  });

  return {
    getLatest: () => {
      if (!latest) throw new Error('useAskSession did not render');
      return latest;
    },
    root,
  };
}

describe('useAskSession native runtime lane', () => {
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates new empty sessions in the selected Codex runtime lane', () => {
    const { getLatest, root } = renderUseAskSession();

    act(() => {
      getLatest().resetSession(codexRuntime);
    });

    const active = getLatest().activeSession;
    expect(active).not.toBeNull();
    expect(getSessionAgentRuntime(active)).toEqual(codexRuntime);
    expect(isSessionInRuntimeLane(active!, codexRuntime)).toBe(true);
    expect(isSessionInRuntimeLane(active!, null)).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it('keeps the active Claude Code runtime when deleting the active session', () => {
    const { getLatest, root } = renderUseAskSession();

    act(() => {
      getLatest().resetSession(claudeRuntime);
    });

    const claudeSessionId = getLatest().activeSessionId;
    expect(claudeSessionId).toBeTruthy();

    act(() => {
      getLatest().deleteSession(claudeSessionId!, claudeRuntime);
    });

    const replacement = getLatest().activeSession;
    expect(replacement).not.toBeNull();
    expect(replacement?.id).not.toBe(claudeSessionId);
    expect(getSessionAgentRuntime(replacement)).toEqual(claudeRuntime);
    expect(isSessionInRuntimeLane(replacement!, claudeRuntime)).toBe(true);
    expect(isSessionInRuntimeLane(replacement!, null)).toBe(false);

    act(() => {
      root.unmount();
    });
  });
});
