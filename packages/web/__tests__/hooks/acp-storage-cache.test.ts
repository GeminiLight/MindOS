/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readAcpDetectionCacheFromStorage, useAcpDetection } from '@/hooks/useAcpDetection';
import { readAcpRegistryCacheFromStorage } from '@/hooks/useAcpRegistry';

const DETECTION_STORAGE_KEY = 'mindos:acp-detection:v3';
const LEGACY_DETECTION_STORAGE_KEY_V2 = 'mindos:acp-detection:v2';
const LEGACY_DETECTION_STORAGE_KEY = 'mindos:acp-detection';

describe('ACP hook storage caches', () => {
  beforeEach(() => {
    sessionStorage.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores malformed ACP detection cache shapes', () => {
    sessionStorage.setItem(DETECTION_STORAGE_KEY, JSON.stringify({
      installed: { id: 'not-an-array' },
      notInstalled: [],
      ts: Date.now(),
    }));

    expect(readAcpDetectionCacheFromStorage()).toBeNull();
  });

  it('reads valid ACP detection cache shapes', () => {
    const cache = {
      installed: [{ id: 'codex', name: 'Codex', binaryPath: '/usr/bin/codex' }],
      notInstalled: [{ id: 'claude', name: 'Claude', installCmd: 'npm i -g claude' }],
      runtimes: [
        { id: 'codex', name: 'Codex', kind: 'codex', status: 'available', capabilities: {} },
        { id: 'gemini', name: 'Gemini CLI', kind: 'acp', status: 'available', capabilities: {} },
      ],
      ts: Date.now(),
    };
    sessionStorage.setItem(DETECTION_STORAGE_KEY, JSON.stringify(cache));

    expect(readAcpDetectionCacheFromStorage()).toEqual({
      ...cache,
      runtimes: [
        { id: 'gemini', name: 'Gemini CLI', kind: 'acp', status: 'available', capabilities: {} },
      ],
    });
  });

  it('ignores legacy ACP detection cache keys', () => {
    sessionStorage.setItem(LEGACY_DETECTION_STORAGE_KEY_V2, JSON.stringify({
      installed: [{ id: 'codex', name: 'Codex', binaryPath: '/usr/bin/codex' }],
      notInstalled: [],
      runtimes: [{ id: 'codex', name: 'Codex', kind: 'codex', status: 'missing', capabilities: {} }],
      ts: Date.now(),
    }));
    sessionStorage.setItem(LEGACY_DETECTION_STORAGE_KEY, JSON.stringify({
      installed: [{ id: 'claude', name: 'Claude Code', binaryPath: '/usr/bin/claude' }],
      notInstalled: [],
      runtimes: [{ id: 'claude', name: 'Claude Code', kind: 'claude', status: 'missing', capabilities: {} }],
      ts: Date.now(),
    }));

    expect(readAcpDetectionCacheFromStorage()).toBeNull();
  });

  it('ignores malformed ACP registry cache shapes', () => {
    sessionStorage.setItem('mindos:acp-registry', JSON.stringify({
      agents: { codex: true },
      ts: Date.now(),
    }));

    expect(readAcpRegistryCacheFromStorage()).toBeNull();
  });

  it('ignores corrupted JSON caches', () => {
    sessionStorage.setItem(DETECTION_STORAGE_KEY, '{bad json');
    sessionStorage.setItem('mindos:acp-registry', '{bad json');

    expect(readAcpDetectionCacheFromStorage()).toBeNull();
    expect(readAcpRegistryCacheFromStorage()).toBeNull();
  });

  it('stops loading when ACP/runtime detection request times out', async () => {
    vi.useFakeTimers();
    const states: Array<ReturnType<typeof useAcpDetection>> = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The request was aborted.', 'AbortError'));
      }, { once: true });
    })));

    function Probe() {
      states.push(useAcpDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
    });
    expect(states.at(-1)?.loading).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/agent-runtimes?scope=acp', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));

    await act(async () => {
      vi.advanceTimersByTime(30000);
      await Promise.resolve();
    });

    expect(states.at(-1)?.loading).toBe(false);
    expect(states.at(-1)?.error).toBe('Agent runtime detection timed out after 30000ms.');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not revalidate ACP cache because of cached unavailable native runtime status', async () => {
    sessionStorage.setItem(DETECTION_STORAGE_KEY, JSON.stringify({
      installed: [],
      notInstalled: [],
      runtimes: [{
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
        status: 'error',
        capabilities: {},
        availability: {
          checkedAt: '2026-06-09T00:00:00.000Z',
          sources: ['native-health'],
          reason: 'Codex app-server health check timed out after 3000ms.',
        },
      }],
      ts: Date.now(),
    }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const states: Array<ReturnType<typeof useAcpDetection>> = [];
    function Probe() {
      states.push(useAcpDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states.at(-1)?.loading).toBe(false);
    expect(states.at(-1)?.runtimes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('loads ACP scope without waiting for native runtime health', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' }],
        notInstalled: [],
        runtimes: [{
          id: 'gemini',
          name: 'Gemini CLI',
          kind: 'acp',
          status: 'available',
          capabilities: {},
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    function Probe() {
      useAcpDetection();
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?scope=acp', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));

    await act(async () => {
      root.unmount();
    });
  });
});
