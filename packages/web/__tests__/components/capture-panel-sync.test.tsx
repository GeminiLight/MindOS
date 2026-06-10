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

    expect(host.textContent).toContain('2 items waiting.');
    expect(host.textContent).toContain('Next up');
    expect(host.textContent).toContain('first.md');
    expect(host.textContent).toContain('second.md');
    expect(host.textContent).not.toContain('Loading queue...');

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

    expect(host.textContent).toContain('2 items waiting.');
    expect(host.textContent).toContain('fresh.md');
    expect(host.textContent).toContain('newer.md');

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ files: [] }),
      } as Response);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('2 items waiting.');
    expect(host.textContent).toContain('fresh.md');
    expect(host.textContent).toContain('newer.md');
    expect(host.textContent).not.toContain('Loading queue...');

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

    const reviewLink = host.querySelector('a[href="/capture#queue"]');
    expect(reviewLink?.getAttribute('aria-current')).toBe('page');
    expect(host.textContent).toContain('queued.md');
    expect(host.textContent).toContain('1 item waiting.');

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

    const doneLink = host.querySelector('a[href="/capture#history"]');
    expect(doneLink?.getAttribute('aria-current')).toBe('page');
    expect(host.querySelector('a[href="/capture/history"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
