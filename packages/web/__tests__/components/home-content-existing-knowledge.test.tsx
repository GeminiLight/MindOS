// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n';

const push = vi.fn();
const chatProps = vi.fn();

vi.mock('@/hooks/useSmoothRouterPush', () => ({
  useSmoothRouterPush: () => push,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    t: messages.en,
  }),
}));

vi.mock('@/components/chat/ChatContent', () => ({
  default: (props: { onDockToPanel?: () => void }) => {
    chatProps(props);
    return (
      <button type="button" data-testid="chat-content" onClick={props.onDockToPanel}>
        Chat
      </button>
    );
  },
}));

vi.mock('@/components/GuideCard', () => ({
  default: ({ hasExistingFiles }: { hasExistingFiles: boolean }) => (
    <div data-testid="guide-card" data-has-existing-files={hasExistingFiles ? 'true' : 'false'} />
  ),
}));

vi.mock('@/components/OnboardingView', () => ({
  default: () => <div data-testid="onboarding-view">Onboarding</div>,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('HomeContent existing knowledge state', () => {
  beforeEach(() => {
    push.mockClear();
    chatProps.mockClear();
  });

  it('keeps the workbench visible when recent files are empty but knowledge exists', async () => {
    const HomeContent = (await import('@/components/HomeContent')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const openAskPanel = vi.fn();
    window.addEventListener('mindos:open-ask-panel', openAskPanel);

    await act(async () => {
      root.render(<HomeContent recent={[]} existingFiles={['Notes/A.md']} spaces={[]} />);
    });

    expect(host.querySelector('[data-testid="onboarding-view"]')).toBeNull();
    expect(host.querySelector('[data-testid="chat-content"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="guide-card"]')?.getAttribute('data-has-existing-files')).toBe('true');
    expect(host.querySelector('a[href="/capture"]')).not.toBeNull();
    expect(host.querySelector('a[href="/wiki"]')).not.toBeNull();
    expect(host.textContent).not.toContain(messages.en.app.footer);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="chat-content"]')!.click();
    });

    expect(openAskPanel).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/view/Notes/A.md');

    window.removeEventListener('mindos:open-ask-panel', openAskPanel);
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps homepage suggestion tabs horizontally scrollable on narrow viewports', async () => {
    const HomeContent = (await import('@/components/HomeContent')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<HomeContent recent={[]} existingFiles={['Notes/A.md']} spaces={[]} />);
    });

    const tablist = host.querySelector('[role="tablist"]');
    expect(tablist?.className).toContain('overflow-x-auto');
    expect(tablist?.getAttribute('aria-label')).toBe('MindOS');
    expect(tablist?.firstElementChild?.className).toContain('w-max');
    expect(tablist?.firstElementChild?.className).toContain('justify-start');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('lets the keyboard select suggestions with a single tab stop and labelled panel', async () => {
    const HomeContent = (await import('@/components/HomeContent')).default;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<HomeContent recent={[]} existingFiles={['Notes/A.md']} />));
      const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      expect(tabs.filter(tab => tab.tabIndex === 0)).toHaveLength(1);
      tabs[0].focus();
      await act(async () => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
      expect(document.activeElement).toBe(tabs.at(-1));
      expect(tabs.at(-1)?.getAttribute('aria-selected')).toBe('true');
      expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs.at(-1)?.id);
      await act(async () => tabs.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
      expect(document.activeElement).toBe(tabs[0]);
      await act(async () => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
      expect(document.activeElement).toBe(tabs.at(-1));
      expect(tabs[0].getAttribute('aria-controls')).toBe(host.querySelector('[role="tabpanel"]')?.id);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
