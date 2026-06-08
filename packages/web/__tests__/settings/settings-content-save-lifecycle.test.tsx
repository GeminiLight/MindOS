// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { SettingsData } from '@/components/settings/types';

const mockApiFetch = vi.hoisted(() => vi.fn());
const mockAiTab = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  apiFetch: mockApiFetch,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    setLocale: vi.fn(),
    t: {
      sidebar: { help: 'Help' },
      settings: {
        title: 'Settings',
        saved: 'Saved',
        saveFailed: 'Save failed',
        save: 'Save',
        reconfigure: 'Reconfigure',
        tabs: {
          ai: 'AI',
          mcp: 'Connections',
          plugins: 'Plugins',
          knowledge: 'General',
          appearance: 'Appearance',
          sync: 'Sync',
          update: 'Update',
          uninstall: 'Uninstall',
        },
        ai: { restoreFromEnv: 'Restore from env' },
      },
    },
  }),
}));

vi.mock('@/components/settings/AiTab', () => ({
  AiTab: (props: any) => mockAiTab(props),
}));
vi.mock('@/components/settings/AppearanceTab', () => ({ AppearanceTab: () => null }));
vi.mock('@/components/settings/KnowledgeTab', () => ({ KnowledgeTab: () => null }));
vi.mock('@/components/settings/SyncTab', () => ({ SyncTab: () => null }));
vi.mock('@/components/settings/McpTab', () => ({ McpTab: () => null }));
vi.mock('@/components/settings/PluginsTab', () => ({ PluginsTab: () => null }));
vi.mock('@/components/settings/UpdateTab', () => ({ UpdateTab: () => null }));
vi.mock('@/components/settings/UninstallTab', () => ({ UninstallTab: () => null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSettings(activeProvider: string): SettingsData {
  return {
    ai: {
      activeProvider,
      providers: [
        { id: 'p_initial', name: 'Initial', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        { id: 'p_first', name: 'First', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
        { id: 'p_second', name: 'Second', protocol: 'google', apiKey: '', model: 'gemini-2.5-flash', baseUrl: '' },
      ],
    },
    agent: {},
    mindRoot: '/tmp/mind',
    envOverrides: {},
  };
}

describe('SettingsContent save lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    mockAiTab.mockImplementation(({ data, updateAi }: any) => (
      <div>
        <span data-testid="active-provider">{data.ai.activeProvider}</span>
        <button type="button" onClick={() => updateAi({ activeProvider: 'p_first' })}>first</button>
        <button type="button" onClick={() => updateAi({ activeProvider: 'p_second' })}>second</button>
      </div>
    ));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores stale settings GET responses after the panel hides and reopens', async () => {
    const SettingsContent = (await import('@/components/settings/SettingsContent')).default;
    const firstGet = deferred<SettingsData>();
    const secondGet = deferred<SettingsData>();
    mockApiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/settings' && !opts?.method) {
        return mockApiFetch.mock.calls.filter(([calledUrl, calledOpts]) => (
          calledUrl === '/api/settings' && !(calledOpts as RequestInit | undefined)?.method
        )).length === 1
          ? firstGet.promise
          : secondGet.promise;
      }
      if (url === '/api/settings' && opts?.method === 'POST') return Promise.resolve({});
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SettingsContent visible initialTab="ai" variant="panel" />);
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<SettingsContent visible={false} initialTab="ai" variant="panel" />);
      firstGet.resolve(makeSettings('p_first'));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(<SettingsContent visible initialTab="ai" variant="panel" />);
      secondGet.resolve(makeSettings('p_second'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="active-provider"]')?.textContent).toBe('p_second');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('serializes autosaves and writes the latest settings after an in-flight save', async () => {
    const SettingsContent = (await import('@/components/settings/SettingsContent')).default;
    const firstPost = deferred<Record<string, never>>();
    const postBodies: Array<Record<string, any>> = [];
    mockApiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/settings' && !opts?.method) return Promise.resolve(makeSettings('p_initial'));
      if (url === '/api/settings' && opts?.method === 'POST') {
        postBodies.push(JSON.parse(String(opts.body)));
        return postBodies.length === 1 ? firstPost.promise : Promise.resolve({});
      }
      throw new Error(`Unexpected apiFetch call: ${url}`);
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SettingsContent visible initialTab="ai" variant="panel" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.clearAllTimers();
    postBodies.length = 0;

    const [firstButton, secondButton] = Array.from(host.querySelectorAll('button'))
      .filter((button) => button.textContent === 'first' || button.textContent === 'second');

    await act(async () => {
      firstButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(postBodies.map((body) => body.ai.activeProvider)).toEqual(['p_first']);

    await act(async () => {
      secondButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(postBodies.map((body) => body.ai.activeProvider)).toEqual(['p_first']);

    await act(async () => {
      firstPost.resolve({});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(postBodies.map((body) => body.ai.activeProvider)).toEqual(['p_first', 'p_second']);

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
