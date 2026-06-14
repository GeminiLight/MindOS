// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import IMChannelsView from '@/components/panels/IMChannelsView';
import { clearChannelCache } from '@/components/agents/channel-detail/cache';
import { messages } from '@/lib/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('platform=feishu'),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en',
    setLocale: vi.fn(),
    t: messages.en,
  }),
}));

describe('IMChannelsView', () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearChannelCache();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        platforms: [
          {
            platform: 'feishu',
            connected: true,
            botName: 'MindOS Feishu Bot',
            capabilities: ['text'],
            webhook: { state: 'ready', transport: 'long_connection' },
          },
          {
            platform: 'discord',
            connected: false,
            capabilities: [],
          },
        ],
      }),
    })) as typeof fetch;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.fetch = originalFetch;
    clearChannelCache();
    vi.clearAllMocks();
  });

  it('renders compact channel rows with active and connected state', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <IMChannelsView />
        </React.StrictMode>,
      );
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/im/status');
    expect(host.textContent).toContain('CHANNELS');
    expect(host.textContent).toContain('1/8');
    expect(host.textContent).not.toContain('2 connected');
    expect(host.textContent).toContain('Feishu');
    expect(host.textContent).not.toContain('MindOS Feishu Bot');
    expect(host.textContent).not.toContain('Set up');
    expect(host.textContent).not.toContain('Receive MindOS notifications');

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a'));
    const feishuLink = links.find(link => link.getAttribute('href')?.includes('platform=feishu'));
    expect(feishuLink).not.toBeNull();
    expect(feishuLink?.getAttribute('aria-current')).toBe('page');
    expect(feishuLink?.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]');
    expect(host.innerHTML).not.toContain('rounded-r-full');
    expect(feishuLink?.textContent).not.toContain('Connected');
    expect(feishuLink?.querySelector('[aria-label="Running"]')).toBeTruthy();

    const telegramLink = links.find(link => link.getAttribute('href')?.includes('platform=telegram'));
    expect(telegramLink).not.toBeNull();
    expect(telegramLink?.getAttribute('aria-current')).toBeNull();
    expect(telegramLink?.textContent).not.toContain('Set up');
    expect(telegramLink?.textContent).not.toContain('Receive MindOS notifications');
    expect(telegramLink?.querySelector('[aria-label="Not configured"]')).toBeTruthy();

    const discordLink = links.find(link => link.getAttribute('href')?.includes('platform=discord'));
    expect(discordLink?.querySelector('[aria-label="Needs attention"]')).toBeTruthy();
  });

  it('renders cached statuses without showing the loading placeholder again', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <IMChannelsView />
        </React.StrictMode>,
      );
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <React.StrictMode>
          <IMChannelsView />
        </React.StrictMode>,
      );
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Loading');
    expect(host.textContent).toContain('1/8');
  });
});
