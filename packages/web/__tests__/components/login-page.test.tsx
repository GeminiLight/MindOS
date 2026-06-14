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

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('LoginPage', () => {
  let host: HTMLDivElement;
  let root: Root;

  async function renderLoginPage() {
    const LoginPage = (await import('@/app/login/page')).default;

    await act(async () => {
      root.render(<LoginPage />);
    });
  }

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

  it('keeps the lock screen compact while preserving reset guidance', async () => {
    mockSearch = 'reason=expired&redirect=/agents?tab=mcp';
    await renderLoginPage();

    expect(host.textContent).toContain('Session locked');
    expect(host.textContent).not.toContain('Re-enter your password');
    expect(host.textContent).not.toContain('Your browser session expired');
    expect(host.textContent).not.toContain('Returning to /agents?tab=mcp');
    expect(host.textContent).toContain('mindos auth reset-web-password');
    expect(host.textContent).toContain('mindos config unset webPassword');
    expect(host.textContent).toContain('Existing signed-in browser sessions are kept');
  });

  it('does not render a return-path reminder for previous browser sessions', async () => {
    mockSearch = 'redirect=/wiki';
    localStorage.setItem('mindos:had-web-session', '1');
    await renderLoginPage();

    expect(host.textContent).toContain('Session locked');
    expect(host.textContent).not.toContain('Returning to /wiki');
  });

  it('enables the sign-in button only after a password is entered', async () => {
    mockSearch = 'redirect=/wiki';
    await renderLoginPage();

    const passwordInput = host.querySelector<HTMLInputElement>('#password');
    const submitButton = host.querySelector<HTMLButtonElement>('button[type="submit"]');

    expect(passwordInput).not.toBeNull();
    expect(submitButton).not.toBeNull();
    expect(submitButton?.disabled).toBe(true);
    expect(submitButton?.style.backgroundColor).toBe('var(--muted)');

    await act(async () => {
      setInputValue(passwordInput!, 'secret');
    });

    expect(submitButton?.disabled).toBe(false);
    expect(submitButton?.style.backgroundColor).toBe('var(--amber)');
  });

  it('removes the default explanatory login copy', async () => {
    mockSearch = 'redirect=/wiki';
    await renderLoginPage();

    expect(host.textContent).not.toContain('Enter your Web password');
    expect(host.textContent).not.toContain('Enter your password to continue');
    expect(host.textContent).not.toContain('Returning to /wiki');
  });
});
