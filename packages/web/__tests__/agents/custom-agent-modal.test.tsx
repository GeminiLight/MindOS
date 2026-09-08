// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CustomAgentModal from '@/components/agents/CustomAgentModal';
import type { AgentInfo } from '@/components/settings/types';

vi.mock('@/lib/stores/locale-store', async () => {
  const { messages } = await import('@/lib/i18n');
  return { useLocale: () => ({ locale: 'en', t: messages.en }) };
});
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCustomAgent(): AgentInfo {
  return {
    key: 'my-agent',
    name: 'My Agent',
    present: true,
    installed: false,
    hasProjectScope: false,
    hasGlobalScope: true,
    preferredTransport: 'stdio',
    format: 'json',
    configKey: 'mcpServers',
    globalPath: '~/my-agent/mcp.json',
    customBaseDir: '~/my-agent',
    isCustom: true,
  } as unknown as AgentInfo;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter(el: Element) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function inputs(host: HTMLElement) {
  const all = [...host.querySelectorAll<HTMLInputElement>('input')];
  return { name: all[0]!, baseDir: all[1]! };
}

describe('CustomAgentModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps in-progress edits when the edited agent object is replaced with the same key', () => {
    const first = makeCustomAgent();
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[first]} editAgent={first} />);
    });
    const { name } = inputs(host);
    expect(name.value).toBe('My Agent');
    act(() => { setInputValue(name, 'Renamed Agent'); });
    expect(name.value).toBe('Renamed Agent');

    // Simulates the mcp store poll replacing the agents array (new object, same key).
    const second = makeCustomAgent();
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[second]} editAgent={second} />);
    });
    expect(inputs(host).name.value).toBe('Renamed Agent');
  });

  it('resets the form when the modal is reopened for a different agent', () => {
    const first = makeCustomAgent();
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[first]} editAgent={first} />);
    });
    act(() => { setInputValue(inputs(host).name, 'Renamed Agent'); });

    const other = { ...makeCustomAgent(), key: 'other-agent', name: 'Other Agent' } as AgentInfo;
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[first, other]} editAgent={other} />);
    });
    expect(inputs(host).name.value).toBe('Other Agent');
  });

  it('ignores a slow detection response for a directory the user has since replaced', async () => {
    const slow = deferred<ReturnType<typeof jsonResponse>>();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { baseDir?: string };
      if (body.baseDir === '~/alpha') return slow.promise;
      return Promise.resolve(jsonResponse({
        exists: true, hasSkillsDir: false,
        detectedConfig: '~/beta/config.json', detectedFormat: 'json',
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[]} />);
    });
    const { name, baseDir } = inputs(host);
    act(() => { setInputValue(name, 'Alpha'); });
    act(() => { setInputValue(baseDir, '~/alpha'); });
    await act(async () => { pressEnter(baseDir); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // User changes the directory while detection for ~/alpha is still pending.
    act(() => { setInputValue(baseDir, '~/beta'); });
    await act(async () => { pressEnter(baseDir); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('~/beta/config.json');

    // The stale ~/alpha response finally lands and must not touch the form.
    slow.resolve(jsonResponse({
      exists: true, hasSkillsDir: false,
      detectedConfig: '~/alpha/old.json', detectedFormat: 'toml',
    }));
    await flush();
    expect(host.textContent).toContain('~/beta/config.json');
    expect(host.textContent).not.toContain('~/alpha/old.json');
  });

  it('shows a generic error for non-timeout detection failures instead of the timeout hint', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[]} />);
    });
    const { name, baseDir } = inputs(host);
    act(() => { setInputValue(name, 'Alpha'); });
    act(() => { setInputValue(baseDir, '~/alpha'); });
    await act(async () => { pressEnter(baseDir); });
    await flush();

    expect(host.textContent).toContain('Network error. Please try again.');
    expect(host.textContent).not.toContain('Detection timed out, using defaults');
  });

  it('falls back to defaults with the timeout hint when detection actually times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    act(() => {
      root.render(<CustomAgentModal open onClose={vi.fn()} onSuccess={vi.fn()} existingAgents={[]} />);
    });
    const { name, baseDir } = inputs(host);
    act(() => { setInputValue(name, 'Alpha'); });
    act(() => { setInputValue(baseDir, '~/alpha'); });
    await act(async () => { pressEnter(baseDir); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });

    expect(host.textContent).toContain('Detection timed out, using defaults');
    expect(host.textContent).toContain('~/alpha/mcp.json');
  });
});
