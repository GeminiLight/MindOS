// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let mockSearch = '';
const mockReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('LoginPage', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearch = '';
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('shows a re-auth state and preserves the return target when the session expired', async () => {
    mockSearch = 'reason=expired&redirect=/agents?tab=mcp';
    const LoginPage = (await import('@/app/login/page')).default;

    await act(async () => {
      root.render(<LoginPage />);
    });

    expect(host.textContent).toContain('Re-enter your password');
    expect(host.textContent).toContain('Your browser session expired');
    expect(host.textContent).toContain('Returning to /agents?tab=mcp');
    expect(host.textContent).toContain('mindos config set webPassword');
    expect(host.textContent).toContain('mindos config unset webPassword');
  });

  it('uses re-auth copy when this browser has authenticated before even without an expired cookie reason', async () => {
    mockSearch = 'redirect=/wiki';
    localStorage.setItem('mindos:had-web-session', '1');
    const LoginPage = (await import('@/app/login/page')).default;

    await act(async () => {
      root.render(<LoginPage />);
    });

    expect(host.textContent).toContain('Re-enter your password');
    expect(host.textContent).toContain('Returning to /wiki');
  });
});
