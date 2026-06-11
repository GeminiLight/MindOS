// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { messages } from '@/lib/i18n';

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
  useRouter: () => ({ push: mockRouterPush }),
}));

describe('CapturePanel inbox sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/capture');
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [] }),
    }));
  });

  it('uses the shared Inbox files event instead of staying on stale counts', async () => {
    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindos:inbox-files', {
        detail: [
          {
            name: 'first.md',
            path: 'Inbox/first.md',
            size: 10,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
          {
            name: 'second.md',
            path: 'Inbox/second.md',
            size: 20,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
        ],
      }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Pending');
    expect(host.textContent).toContain('first.md');
    expect(host.textContent).toContain('second.md');
    expect(host.textContent).not.toContain('2 items waiting.');
    expect(host.textContent).not.toContain('Loading queue...');
    expect(host.querySelector('[data-inbox-sidebar-new-capture]')?.textContent?.trim()).toBe(messages.en.inbox.viewCapture);

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps locally shelved captures out of the pending preview', async () => {
    localStorage.setItem('mindos-inbox-shelved-paths', JSON.stringify(['Inbox/first.md']));
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindos:inbox-files', {
        detail: [
          {
            name: 'first.md',
            path: 'Inbox/first.md',
            size: 10,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
          {
            name: 'second.md',
            path: 'Inbox/second.md',
            size: 20,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
        ],
      }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('second.md');
    expect(host.textContent).not.toContain('first.md');
    expect(host.textContent).not.toContain('1 item waiting.');
    expect(host.textContent).not.toContain('1 item shelved.');

    await act(async () => {
      root.unmount();
    });
  });

  it('does not let an older panel fetch overwrite a newer shared Inbox files event', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>(resolve => {
      resolveFetch = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(() => fetchPromise));

    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindos:inbox-files', {
        detail: [
          {
            name: 'fresh.md',
            path: 'Inbox/fresh.md',
            size: 12,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
          {
            name: 'newer.md',
            path: 'Inbox/newer.md',
            size: 24,
            modifiedAt: new Date().toISOString(),
            isAging: true,
          },
        ],
      }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('fresh.md');
    expect(host.textContent).toContain('newer.md');
    expect(host.textContent).not.toContain('2 items waiting.');

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ files: [] }),
      } as Response);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('fresh.md');
    expect(host.textContent).toContain('newer.md');
    expect(host.textContent).not.toContain('2 items waiting.');
    expect(host.textContent).not.toContain('Loading queue...');
    expect(host.querySelector('[data-inbox-sidebar-new-capture]')?.closest('section')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('marks the Review panel link active when opened from the review hash', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'queued.md',
            path: 'Inbox/queued.md',
            size: 2048,
            modifiedAt: new Date().toISOString(),
            isAging: true,
          },
        ],
      }),
    }));

    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    const reviewButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Pending'));
    expect(reviewButton?.getAttribute('aria-current')).toBe('page');
    expect(host.textContent).toContain('queued.md');
    expect(host.textContent).not.toContain('1 item waiting.');

    await act(async () => {
      root.unmount();
    });
  });

  it('marks Done active on the full history route', async () => {
    window.history.replaceState(null, '', '/capture/history');

    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    const doneButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Done'));
    expect(doneButton?.getAttribute('aria-current')).toBe('page');
    expect(host.querySelector('a[href="/capture/history"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('switches sidebar buttons and the more preview button through same-route hash navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: Array.from({ length: 6 }, (_, index) => ({
          name: `queued-${index + 1}.md`,
          path: `Inbox/queued-${index + 1}.md`,
          size: 1024 + index,
          modifiedAt: new Date().toISOString(),
          isAging: index < 5,
        })),
      }),
    }));

    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    const pendingButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Pending'));
    expect(pendingButton).not.toBeUndefined();

    await act(async () => {
      pendingButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#queue');
    expect(pendingButton?.getAttribute('aria-current')).toBe('page');

    const shelvedButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Shelved'));
    expect(shelvedButton).not.toBeUndefined();

    await act(async () => {
      shelvedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#shelved');
    expect(shelvedButton?.getAttribute('aria-current')).toBe('page');
    expect(pendingButton?.getAttribute('aria-current')).toBeNull();

    await act(async () => {
      pendingButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#queue');
    expect(pendingButton?.getAttribute('aria-current')).toBe('page');

    const newCaptureButton = host.querySelector('[data-inbox-sidebar-new-capture]') as HTMLButtonElement | null;
    expect(newCaptureButton).not.toBeNull();

    await act(async () => {
      newCaptureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('');
    expect(newCaptureButton?.getAttribute('aria-current')).toBe('page');
    expect(pendingButton?.getAttribute('aria-current')).toBeNull();

    const moreButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('1 more'));
    expect(moreButton).not.toBeUndefined();

    await act(async () => {
      moreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#queue');

    await act(async () => {
      root.unmount();
    });
  });

  it('opens a sidebar pending file directly into Review item details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'first.md',
            path: 'Inbox/first.md',
            size: 1024,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
          {
            name: 'second.md',
            path: 'Inbox/second.md',
            size: 2048,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
        ],
      }),
    }));

    const CapturePanel = (await import('@/components/panels/CapturePanel')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<CapturePanel />);
      await new Promise(r => setTimeout(r, 0));
    });

    const firstFileButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('first.md'));
    expect(firstFileButton).not.toBeUndefined();

    await act(async () => {
      firstFileButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#queue?path=Inbox%2Ffirst.md');

    const pendingButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Pending'));
    expect(pendingButton?.getAttribute('aria-current')).toBe('page');

    await act(async () => {
      root.unmount();
    });
  });
});
