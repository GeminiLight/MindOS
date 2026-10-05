// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
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

it('opens a recent note directly and reveals suggestions without remounting the conversation', async () => {
  const HomeContent = (await import('@/components/HomeContent')).default;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<HomeContent recent={[{path:'研究/想法.md',mtime:1}]} />));
    expect(host.querySelector('a[href="/view/%E7%A0%94%E7%A9%B6/%E6%83%B3%E6%B3%95.md"]')).not.toBeNull();
    expect(host.querySelector('[role=tablist]')).toBeNull();
    const chat = host.querySelector('[data-testid=chat-content]');
    const toggle = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(messages.en.home.promptIdeas))!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role=tablist]')).not.toBeNull();
    expect(host.querySelector('[data-testid=chat-content]')).toBe(chat);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('shows the location and modification date of a recent note without losing the direct link', async () => {
  const HomeContent = (await import('@/components/HomeContent')).default;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    const modified = Date.UTC(2026, 8, 24, 12);
    await act(async () => root.render(<HomeContent recent={[{ path: 'Projects/Research-plan.md', mtime: modified }]} />));
    const link = host.querySelector<HTMLAnchorElement>('a[href="/view/Projects/Research-plan.md"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Research-plan.md');
    expect(link?.textContent).toContain('Projects');
    expect(link?.querySelector('time')?.getAttribute('datetime')).toBe(new Date(modified).toISOString());
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('shows prioritized notes while leaving the chronological list available for other Home actions', async () => {
  const HomeContent = (await import('@/components/HomeContent')).default;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    const recent = [{ path: 'Inbox/README.md', mtime: 2 }, { path: 'Notes/Research.md', mtime: 1 }];
    await act(async () => root.render(<HomeContent recent={recent} recentNotes={[recent[1]]} />));
    const section = host.querySelector(`section[aria-label="${messages.en.home.recentNotes}"]`);
    expect(section?.querySelector('a[href="/view/Notes/Research.md"]')).not.toBeNull();
    expect(section?.querySelector('a[href="/view/Inbox/README.md"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it.each([Number.NaN, 0, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])('omits a misleading modification date for invalid mtime %s', async mtime => {
  const HomeContent = (await import('@/components/HomeContent')).default;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<HomeContent recent={[{ path: 'Notes/Untitled.md', mtime }]} />));
    expect(host.querySelector('a[href="/view/Notes/Untitled.md"]')).not.toBeNull();
    expect(host.querySelector('time')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
