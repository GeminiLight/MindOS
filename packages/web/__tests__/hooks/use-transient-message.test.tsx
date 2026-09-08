// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTransientMessage } from '@/hooks/useTransientMessage';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: { message: string | null; show: (m: string | null, ms: number) => void } | null = null;

function Probe() {
  const [message, setMessage, clearAfter] = useTransientMessage<string | null>(null);
  latest = { message, show: (m, ms) => { setMessage(m); clearAfter(ms); } };
  return <output>{message ?? ''}</output>;
}

describe('useTransientMessage', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root.render(<Probe />); });
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.useRealTimers();
    latest = null;
  });

  it('replaces a pending clear timer when a new message is shown', () => {
    act(() => { latest!.show('first', 4000); });
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { latest!.show('second', 4000); });
    // The first timer would have fired here; it must have been cancelled.
    act(() => { vi.advanceTimersByTime(1500); });
    expect(host.textContent).toBe('second');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(host.textContent).toBe('');
  });

  it('clears its timer on unmount', () => {
    act(() => { latest!.show('bye', 4000); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => { root.unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    // Re-create so afterEach can unmount safely.
    root = createRoot(host);
    act(() => { root.render(<Probe />); });
  });
});

describe('hint-message timer contract', () => {
  const files = [
    'components/agents/AgentsSkillsSection.tsx',
    'components/agents/AgentDetailContent.tsx',
    'components/agents/AgentsMcpSection.tsx',
    'components/agents/AcpRegistrySection.tsx',
  ];

  it('does not schedule bare setTimeout resets for transient UI messages', () => {
    const webRoot = path.resolve(__dirname, '../..');
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(webRoot, file), 'utf-8');
      const pattern = /setTimeout\(\(\) => set\w+\((?:null|false|'idle')\)/g;
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
