// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' as const }),
}));

async function settleEffects() {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('AppsContent experiment gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('redirects to experiments settings when Apps is disabled', async () => {
    const AppsContent = (await import('@/components/apps/AppsContent')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AppsContent />);
    });
    await settleEffects();

    expect(mockReplace).toHaveBeenCalledWith('/settings?tab=navigation');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('renders the Apps hub when the experiment is enabled', async () => {
    localStorage.setItem('mindos:labs-apps', '1');
    const AppsContent = (await import('@/components/apps/AppsContent')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AppsContent />);
    });
    await settleEffects();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(host.querySelector('[data-content-page-shell="apps"]')).not.toBeNull();
    expect(host.textContent).toContain('Apps');
    expect(host.textContent).toContain('Research Radar');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
