// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioContent from '@/components/studio/StudioContent';

const push = vi.fn();

vi.mock('@/hooks/useSmoothRouterPush', () => ({
  useSmoothRouterPush: () => push,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function renderStudio() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  await act(async () => {
    root!.render(<StudioContent />);
  });
}

async function setInputValue(selector: string, value: string) {
  const input = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  expect(input).not.toBeNull();
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input!), 'value');
    descriptor?.set?.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    input!.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('StudioContent', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      root = null;
      await act(async () => {
        current.unmount();
      });
    }
    host?.remove();
  });

  it('renders Studio as a Project-first surface', async () => {
    await renderStudio();

    expect(host.textContent).toContain('New Project');
    expect(host.textContent).not.toContain('New session');
    expect(host.querySelector('a[href="/studio/launch-practice"]')).not.toBeNull();
  });

  it('creates a Project and navigates to its detail page', async () => {
    await renderStudio();

    const newProjectButton = Array.from(host.querySelectorAll('button')).find((button) => (
      button.textContent?.includes('New Project')
    ));
    expect(newProjectButton).not.toBeNull();

    await act(async () => {
      newProjectButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await setInputValue('input[placeholder="Launch practice"]', 'Growth Room');
    await setInputValue('textarea[placeholder="Turn product evidence into launch decisions"]', 'Train launch review habits');

    const form = host.querySelector('form[role="dialog"]') as HTMLFormElement | null;
    expect(form).not.toBeNull();

    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(push).toHaveBeenCalledWith('/studio/growth-room');
  });
});
