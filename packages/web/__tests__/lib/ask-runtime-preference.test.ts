// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAST_AGENT_RUNTIME_STORAGE_KEY,
  loadLastSelectedAgentRuntime,
  persistLastSelectedAgentRuntime,
} from '@/lib/ask-runtime-preference';

describe('ask runtime preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists a selected native runtime', () => {
    persistLastSelectedAgentRuntime({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    });

    expect(loadLastSelectedAgentRuntime()).toEqual({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    });
  });

  it('clears the preference when MindOS is selected', () => {
    localStorage.setItem(LAST_AGENT_RUNTIME_STORAGE_KEY, JSON.stringify({
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
    }));

    persistLastSelectedAgentRuntime(null);

    expect(localStorage.getItem(LAST_AGENT_RUNTIME_STORAGE_KEY)).toBeNull();
    expect(loadLastSelectedAgentRuntime()).toBeNull();
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(LAST_AGENT_RUNTIME_STORAGE_KEY, '{bad json');
    expect(loadLastSelectedAgentRuntime()).toBeNull();

    localStorage.setItem(LAST_AGENT_RUNTIME_STORAGE_KEY, JSON.stringify({
      id: 'codex',
      name: 'Codex',
      kind: 'unknown',
    }));
    expect(loadLastSelectedAgentRuntime()).toBeNull();
  });
});
