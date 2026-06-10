// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { messages } from '@/lib/i18n';
import { CAPTURE_ACCEPT } from '@/lib/capture-formats';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    setLocale: vi.fn(),
    t: messages.en,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

describe('InboxSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    }));
  });

  it('uses the shared capture accept list for the home Inbox file input', async () => {
    const { InboxSection } = await import('@/components/home/InboxSection');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxSection />);
      await new Promise(r => setTimeout(r, 0));
    });

    const input = host.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toBe(CAPTURE_ACCEPT);
    expect(input?.getAttribute('accept')).toContain('.xlsx');
    expect(input?.getAttribute('accept')).toContain('.pptx');
    expect(input?.getAttribute('accept')).toContain('.webp');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the URL input after a failed home clip request', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/inbox/clip') {
        return { ok: false, status: 422, json: async () => ({ error: 'Clip failed' }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { InboxSection } = await import('@/components/home/InboxSection');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxSection />);
      await new Promise(r => setTimeout(r, 0));
    });

    const input = host.querySelector('input[type="url"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(input, 'https://example.com/fail');
      input!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    const clipButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Clip'));
    expect(clipButton).not.toBeNull();

    await act(async () => {
      clipButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox/clip', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.com/fail'),
    }));
    expect(input?.value).toBe('https://example.com/fail');

    await act(async () => {
      root.unmount();
    });
  });

  it('supports keyboard row navigation and accessible remove actions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'capture.md',
            path: 'Inbox/capture.md',
            size: 120,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
        ],
      }),
    }));

    const { InboxSection } = await import('@/components/home/InboxSection');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxSection />);
      await new Promise(r => setTimeout(r, 0));
    });

    const row = Array.from(host.querySelectorAll('[role="button"]'))
      .find(item => item.textContent?.includes('capture.md')) as HTMLElement | undefined;
    expect(row).not.toBeUndefined();

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    await act(async () => {
      row!.dispatchEvent(spaceEvent);
    });

    expect(spaceEvent.defaultPrevented).toBe(true);
    expect(mockRouterPush).toHaveBeenCalledWith('/view/Inbox/capture.md');

    const removeButton = host.querySelector('button[aria-label="Remove from Inbox"]') as HTMLButtonElement | null;
    expect(removeButton).not.toBeNull();
    expect(removeButton?.className).toContain('group-focus-within:flex');
    expect(removeButton?.className).toContain('max-sm:flex');
    expect(removeButton?.className).toContain('focus-visible:ring-2');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders source icons for social web clips in the home Inbox list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'Video Notes.md',
            path: 'Inbox/Video Notes.md',
            size: 120,
            modifiedAt: new Date().toISOString(),
            isAging: false,
            source: {
              kind: 'web',
              url: 'https://www.youtube.com/watch?v=abc',
              domain: 'youtube.com',
              siteName: 'YouTube',
              platform: 'youtube',
              platformLabel: 'YouTube',
            },
          },
        ],
      }),
    }));

    const { InboxSection } = await import('@/components/home/InboxSection');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxSection />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('YouTube');
    expect(host.querySelector('img[src="/source-icons/youtube.ico"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
