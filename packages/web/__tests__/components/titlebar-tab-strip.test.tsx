// @vitest-environment jsdom
/**
 * TitlebarTabStrip + useWorkspaceTabSync (spec-titlebar-row Phase 2).
 *
 * jsdom has no layout, so overflow tests drive the measurement seam directly:
 * a local ResizeObserver stub fires the component's callback with a chosen
 * contentRect width (the component skips observing when ResizeObserver is
 * undefined and renders every tab — which is also what the unmeasured first
 * paint does).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import TitlebarTabStrip, { computeVisibleCount, computeVisibleRange, TAB_MIN_W } from '@/components/TitlebarTabStrip';
import { parseActiveTab, tabHref } from '@/hooks/useWorkspaceTabSync';
import { getTabs, initWorkspaceTabs, keepTab, openTab, MAX_TABS } from '@/lib/workspace-tabs';
import { getSessionsLoaded, renameSession } from '@/lib/agent-session-store';
import { endRun, startRun } from '@/lib/agent-run-store';
import { ASK_PANEL_SESSION_ACTIVATE_EVENT } from '@/lib/ask-panel-session-activation';
import type { ChatSession } from '@/lib/types';

const h = vi.hoisted(() => ({
  pathname: { current: '/' as string },
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname.current,
  useRouter: () => ({ push: h.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/toast', () => {
  const toastFn = Object.assign((..._args: unknown[]) => {}, {
    error: h.toastError,
    success: vi.fn(),
    copy: vi.fn(),
    undo: vi.fn(),
  });
  return { toast: toastFn };
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- fetch control -----------------------------------------------------------
// GET /api/agent/sessions (no method in init) returns the seeded session list;
// POST/DELETE persistence calls get an empty OK response.
let fetchResponder: (url: string, init?: RequestInit) => Promise<unknown>;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const data = await fetchResponder(url, init);
  return { ok: true, json: async () => data } as unknown as Response;
});

function setServerSessions(sessions: unknown[]) {
  fetchResponder = async (_url, init) => (init?.method ? {} : sessions);
}

/** Returns a resolver: the session fetch stays pending until the test fires it. */
function deferServerSessions(): (sessions: unknown[]) => void {
  let resolve: (v: unknown) => void = () => {};
  const pending = new Promise((res) => { resolve = res; });
  fetchResponder = async (_url, init) => (init?.method ? {} : pending);
  return (sessions) => resolve(sessions);
}

function makeSession(id: string, title?: string, content = 'hello there', overrides: Partial<ChatSession> = {}): ChatSession {
  const ts = Date.now();
  return { id, title, createdAt: ts, updatedAt: ts, messages: [{ role: 'user', content, timestamp: ts }], ...overrides };
}

// --- ResizeObserver stub -------------------------------------------------------
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  private cb: (entries: unknown[]) => void;
  constructor(cb: (entries: unknown[]) => void) {
    this.cb = cb;
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(width: number) {
    this.cb([{ contentRect: { width } }]);
  }
}

// --- render harness ------------------------------------------------------------
let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function navigateTo(pathname: string) {
  h.pathname.current = pathname;
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(React.createElement(TitlebarTabStrip));
  });
}

const tabEls = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const tabTitles = () => tabEls().map((el) => el.getAttribute('title'));
const findTab = (title: string) => tabEls().find((el) => el.getAttribute('title') === title);
const closeButtonOf = (tabEl: HTMLElement) => tabEl.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]')!;
const click = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const rightClick = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 40 }));
});
const flushSmoothNavigation = () => act(async () => {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
});
function seedKeptDocTabs(keys: string[]) {
  initWorkspaceTabs('default');
  for (const key of keys) openTab('doc', key, key.split('/').pop() || key);
}

beforeEach(() => {
  h.pathname.current = '/';
  h.push.mockClear();
  h.toastError.mockClear();
  setServerSessions([]);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  ResizeObserverStub.instances = [];
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

// =============================================================================

describe('parseActiveTab', () => {
  it('keeps / as the product Home launcher route, not a workspace tab', () => {
    expect(parseActiveTab('/')).toBeNull();
  });

  it('maps /view/<segments> to a decoded doc key', () => {
    expect(parseActiveTab('/view/a/b.md')).toEqual({ kind: 'doc', key: 'a/b.md' });
    expect(parseActiveTab(`/view/${encodeURIComponent('笔记')}/${encodeURIComponent('日记😀.md')}`))
      .toEqual({ kind: 'doc', key: '笔记/日记😀.md' });
  });

  it('maps /chat/<id> to a chat key but treats /chat/new as no tab', () => {
    expect(parseActiveTab('/chat/abc')).toEqual({ kind: 'chat', key: 'abc' });
    expect(parseActiveTab('/chat/new')).toBeNull();
  });

  it('returns null for place routes and degenerate paths', () => {
    for (const p of ['/capture', '/echo', '/echo/foo', '/agents', '/discover', '/inbox', '/view/', '/chat/a/b', null, undefined]) {
      expect(parseActiveTab(p)).toBeNull();
    }
  });

  it('survives malformed percent-encoding without throwing', () => {
    expect(parseActiveTab('/view/%E0%A4%A')).toEqual({ kind: 'doc', key: '%E0%A4%A' });
  });
});

describe('computeVisibleCount', () => {
  it('shows everything while unmeasured (null width)', () => {
    expect(computeVisibleCount(null, 7)).toBe(7);
  });

  it('shows all tabs when they fit without the overflow trigger', () => {
    expect(computeVisibleCount(3 * TAB_MIN_W + 64, 3)).toBe(3);
  });

  it('reserves room for the overflow trigger when tabs do not fit', () => {
    // 300px: 300-64 = 236 < 5*76 → (236-48)/76 → 2 visible
    expect(computeVisibleCount(300, 5)).toBe(2);
  });

  it('never goes negative on tiny widths', () => {
    expect(computeVisibleCount(10, 5)).toBe(0);
    expect(computeVisibleCount(0, 0)).toBe(0);
  });
});

describe('computeVisibleRange', () => {
  it('keeps the latest tabs visible when no tab is active', () => {
    expect(computeVisibleRange(300, 5, null)).toEqual({ start: 3, end: 5 });
  });

  it('keeps the active tab visible while favoring nearby context', () => {
    expect(computeVisibleRange(300, 5, 4)).toEqual({ start: 3, end: 5 });
    expect(computeVisibleRange(300, 5, 0)).toEqual({ start: 0, end: 2 });
  });
});

// =============================================================================

describe('TitlebarTabStrip (spec-titlebar-row Phase 2)', () => {
  it('highlights the Home launcher on the product root route without creating a tab', async () => {
    await navigateTo('/');
    expect(tabTitles()).toEqual([]);
    expect(getTabs()).toEqual([]);
    const homeButton = document.querySelector<HTMLButtonElement>('[data-titlebar-home-button]');
    expect(homeButton).not.toBeNull();
    expect(homeButton!.className).toContain('text-[var(--amber)]');
  });

  it('opens a doc route as a replaceable preview tab', async () => {
    await navigateTo('/view/a/b.md');
    expect(tabTitles()).toEqual(['b.md']);
    const tab = findTab('b.md')!;
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('data-titlebar-tab-preview')).toBe('true');
    expect(getTabs()[0]).toMatchObject({ kind: 'doc', key: 'a/b.md', pinned: false });
    // interactive elements opt out of the window drag region
    expect((tab.style as unknown as Record<string, string>).WebkitAppRegion).toBe('no-drag');
  });

  it('opens a chat tab when visiting /chat/<id> and does not duplicate on revisit', async () => {
    deferServerSessions(); // keep reconcile out of this test
    await navigateTo('/chat/abc');
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0]).toMatchObject({ kind: 'chat', key: 'abc', pinned: false });
    expect(tabEls()[0].getAttribute('data-titlebar-tab-preview')).toBe('true');

    await navigateTo('/');
    await navigateTo('/chat/abc');
    expect(getTabs().filter((tab) => tab.kind === 'chat' && tab.key === 'abc')).toHaveLength(1);
  });

  it('reuses a single doc preview across casual file browsing', async () => {
    await navigateTo('/view/a/b.md');
    await navigateTo('/capture');
    await navigateTo('/view/a/c.md');
    expect(tabTitles()).toEqual(['c.md']);
    expect(getTabs()).toHaveLength(1);
    expect(getTabs()[0]).toMatchObject({ kind: 'doc', key: 'a/c.md', pinned: false });
  });

  it('keeps a preview tab when the user pins it', async () => {
    await navigateTo('/view/a/b.md');
    const tab = findTab('b.md')!;
    const keepButton = tab.querySelector<HTMLButtonElement>('button[aria-label="Keep tab"]')!;

    await click(keepButton);

    expect(getTabs()[0]).toMatchObject({ kind: 'doc', key: 'a/b.md' });
    expect(getTabs()[0].pinned).toBeUndefined();
    expect(tabEls()[0].getAttribute('data-titlebar-tab-preview')).toBeNull();
  });

  it('keeps a chat preview when the user pins it', async () => {
    deferServerSessions();
    await navigateTo('/chat/s-pin');
    const tab = findTab('Chat session')!;
    const keepButton = tab.querySelector<HTMLButtonElement>('button[aria-label="Keep tab"]')!;

    await click(keepButton);

    expect(getTabs()[0]).toMatchObject({ kind: 'chat', key: 's-pin' });
    expect(getTabs()[0].pinned).toBeUndefined();
    expect(tabEls()[0].getAttribute('data-titlebar-tab-preview')).toBeNull();
  });

  it('clicking a tab navigates to its route (Chinese/emoji keys round-trip)', async () => {
    const encoded = `/view/${encodeURIComponent('笔记')}/${encodeURIComponent('日记😀.md')}`;
    await navigateTo(encoded);
    expect(tabTitles()).toEqual(['日记😀.md']);

    await navigateTo('/');
    h.push.mockClear();
    await click(findTab('日记😀.md')!);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith(encoded);
  });

  it('lets an open Ask side panel consume chat tab clicks without full-page navigation', async () => {
    deferServerSessions();
    await navigateTo('/chat/s-side-panel');
    await navigateTo('/wiki');
    const handler = vi.fn((event: Event) => {
      expect((event as CustomEvent<{ sessionId: string }>).detail.sessionId).toBe('s-side-panel');
      event.preventDefault();
    });
    window.addEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handler);

    try {
      h.push.mockClear();
      await click(findTab('Chat session')!);
      await flushSmoothNavigation();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(h.push).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handler);
    }
  });

  it('keeps chat tab clicks routed to full-page chat when the side panel does not consume them', async () => {
    deferServerSessions();
    await navigateTo('/chat/s-full-page');
    await navigateTo('/wiki');

    h.push.mockClear();
    await click(findTab('Chat session')!);
    await flushSmoothNavigation();

    expect(h.push).toHaveBeenCalledWith('/chat/s-full-page');
  });

  it('marks no tab selected on non-home place routes but keeps them open (dim state)', async () => {
    await navigateTo('/view/a.md');
    await navigateTo('/capture');
    expect(tabTitles()).toEqual(['a.md']);
    expect(document.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it('draws a subtle separator only between flat inactive tabs', async () => {
    seedKeptDocTabs(['a.md', 'b.md']);
    await navigateTo('/view/c.md'); // active preview = c

    const tabs = tabEls();
    expect(tabTitles()).toEqual(['a.md', 'b.md', 'c.md']);
    expect(tabs[1].getAttribute('data-titlebar-tab-separator')).toBe('true');
    expect(tabs[1].className).toContain('before:bg-border/60');
    expect(tabs[2].getAttribute('data-titlebar-tab-separator')).toBeNull();
  });

  it('closing the active tab navigates to the right neighbor', async () => {
    seedKeptDocTabs(['a.md', 'b.md', 'c.md']);
    await navigateTo('/view/b.md'); // active = b
    h.push.mockClear();

    await click(closeButtonOf(findTab('b.md')!));
    expect(tabTitles()).toEqual(['a.md', 'c.md']);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/view/c.md');
  });

  it('closing the active tab falls back to the left neighbor, then home', async () => {
    seedKeptDocTabs(['a.md', 'c.md']);
    await navigateTo('/view/c.md'); // active = c (rightmost)
    h.push.mockClear();
    await click(closeButtonOf(findTab('c.md')!));
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/view/a.md');

    // pathname is still /view/c.md (router mock), so a.md is inactive: closing
    // it must not navigate. Re-activate it first to test the home fallback.
    await navigateTo('/view/a.md');
    h.push.mockClear();
    await click(closeButtonOf(findTab('a.md')!));
    expect(tabTitles()).toEqual([]);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/');
  });

  it('closing an inactive tab does not navigate', async () => {
    seedKeptDocTabs(['a.md']);
    await navigateTo('/view/b.md'); // active = b
    h.push.mockClear();

    await click(closeButtonOf(findTab('a.md')!));
    expect(tabTitles()).toEqual(['b.md']);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('middle-click closes a tab', async () => {
    seedKeptDocTabs(['a.md', 'b.md']);
    await navigateTo('/view/b.md');
    await act(async () => {
      findTab('a.md')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    });
    expect(tabTitles()).toEqual(['b.md']);
  });

  it('the new-chat button pushes /chat/new', async () => {
    await navigateTo('/');
    h.push.mockClear();
    await click(document.querySelector('button[aria-label="New chat"]')!);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/chat/new');
  });

  it('lets an open Ask surface consume the new-chat button without full-page navigation', async () => {
    await navigateTo('/');
    const handler = vi.fn((event: Event) => {
      expect((event as CustomEvent<{ action: string; source: string }>).detail).toMatchObject({
        action: 'new',
        source: 'titlebar-new',
      });
      event.preventDefault();
    });
    window.addEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handler);

    try {
      h.push.mockClear();
      await click(document.querySelector('button[aria-label="New chat"]')!);
      await flushSmoothNavigation();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(h.push).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ASK_PANEL_SESSION_ACTIVATE_EVENT, handler);
    }
  });

  it('keeps a Home launcher visible on place routes without creating a tab', async () => {
    initWorkspaceTabs('default');
    await navigateTo('/capture');
    const homeButton = document.querySelector<HTMLButtonElement>('[data-titlebar-home-button]');

    expect(homeButton).not.toBeNull();
    expect(homeButton!.getAttribute('aria-label')).toBe('Home');
    expect(tabEls()).toHaveLength(0);

    await click(homeButton!);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/');
    expect(tabEls()).toHaveLength(0);
  });

  it('syncs chat tab titles from the session list (renameByKey path)', async () => {
    const resolveSessions = deferServerSessions();
    await navigateTo('/chat/s1');
    expect(tabTitles()).toEqual(['Chat session']); // fallback before the list arrives
    expect(tabEls()[0].getAttribute('data-titlebar-tab-preview')).toBe('true');

    await act(async () => {
      resolveSessions([makeSession('s1', 'Hello world')]);
    });
    expect(tabTitles()).toEqual(['Hello world']);

    await act(async () => {
      renameSession('s1', 'Renamed');
    });
    expect(tabTitles()).toEqual(['Renamed']);
  });

  it('reconciles a dead chat tab away only once sessions are loaded', async () => {
    const resolveSessions = deferServerSessions();
    await navigateTo('/chat/dead');
    expect(getTabs()).toHaveLength(1);
    expect(getSessionsLoaded()).toBe(false); // fetch pending → no reconcile yet

    await act(async () => {
      resolveSessions([makeSession('other')]);
    });
    expect(getSessionsLoaded()).toBe(true);
    expect(getTabs().some((t) => t.key === 'dead')).toBe(false);
  });

  it('keeps tabs intact when the sessions fetch never resolves', async () => {
    fetchResponder = () => new Promise(() => {}); // hangs forever
    await navigateTo('/chat/abc');
    await act(async () => {
      keepTab('chat:abc');
    });
    await navigateTo('/view/a.md');
    await act(async () => {}); // extra flush — nothing should change
    expect(getTabs()).toHaveLength(2);
    expect(getSessionsLoaded()).toBe(false);
  });

  it('a running session evicted from the server list survives reconcile until its run ends', async () => {
    const resolveSessions = deferServerSessions();
    await navigateTo('/chat/run1');
    expect(getTabs()[0]).toMatchObject({ kind: 'chat', key: 'run1', pinned: false });
    await act(async () => {
      startRun('run1', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 0 });
    });
    expect(getTabs()[0]).toMatchObject({ kind: 'chat', key: 'run1' });
    expect(getTabs()[0].pinned).toBeUndefined();

    await act(async () => {
      resolveSessions([]); // evicted server-side, but the run keeps the tab alive
    });
    expect(getTabs().some((t) => t.key === 'run1')).toBe(true);

    await act(async () => {
      endRun('run1'); // run gone + still not in the list → tab closes
    });
    expect(getTabs().some((t) => t.key === 'run1')).toBe(false);
  });

  it('shows a spinner for running chats and an amber dot for unread ones', async () => {
    deferServerSessions();
    await navigateTo('/chat/c1');
    expect(document.querySelector('[data-indicator]')).toBeNull();

    await act(async () => {
      startRun('c1', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 0 });
    });
    expect(document.querySelector('[data-indicator="running"]')).not.toBeNull();
    expect(document.querySelector('[data-indicator="unread"]')).toBeNull();

    await act(async () => {
      endRun('c1'); // finishes in the background (no active session) → unread
    });
    expect(document.querySelector('[data-indicator="running"]')).toBeNull();
    expect(document.querySelector('[data-indicator="unread"]')).not.toBeNull();
  });

  it('fires the limit toast once per attempted key at the 50-tab cap', async () => {
    initWorkspaceTabs('default');
    for (let i = 0; i < MAX_TABS; i += 1) openTab('doc', `f${i}.md`, `f${i}.md`);

    await navigateTo('/view/one-more.md');
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(getTabs()).toHaveLength(MAX_TABS);

    // Same key re-attempted → no spam
    await navigateTo('/');
    await navigateTo('/view/one-more.md');
    expect(h.toastError).toHaveBeenCalledTimes(1);
  });

  it('collapses overflowing tabs into a ⌄N menu with running/unread first', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    deferServerSessions();
    seedKeptDocTabs(['d1.md', 'd2.md', 'd3.md', 'd4.md']);
    openTab('chat', 'c1', 'Chat session');
    await act(async () => {
      startRun('c1', { controller: new AbortController(), runtimeSnapshot: null, reconnectMax: 0 });
    });
    await navigateTo('/view/d1.md');

    // 332px: fixed Home/New Chat actions leave room for 2 tabs and an overflow menu.
    await act(async () => {
      ResizeObserverStub.instances.forEach((ro) => ro.trigger(332));
    });
    expect(tabTitles()).toEqual(['d1.md', 'd2.md']);

    const trigger = document.querySelector<HTMLButtonElement>('[data-overflow-trigger]')!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('3 more tabs');
    expect(trigger.textContent).toContain('3');

    await click(trigger);
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    const rows = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"] button[title]'));
    // running chat first, then the remaining docs in order
    expect(rows.map((r) => r.getAttribute('title'))).toEqual(['Chat session', 'd3.md', 'd4.md']);
    expect(menu.querySelector('[data-indicator="running"]')).not.toBeNull();

    // clicking a non-current hidden tab navigates and closes the menu
    h.push.mockClear();
    await click(rows[1]);
    await flushSmoothNavigation();
    expect(h.push).toHaveBeenCalledWith('/view/d3.md');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps the active latest tab visible instead of always reserving the oldest tabs', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    seedKeptDocTabs(['d1.md', 'd2.md', 'd3.md', 'd4.md']);
    await navigateTo('/view/d4.md');

    await act(async () => {
      ResizeObserverStub.instances.forEach((ro) => ro.trigger(332));
    });

    expect(tabTitles()).toEqual(['d3.md', 'd4.md']);
    const trigger = document.querySelector<HTMLButtonElement>('[data-overflow-trigger]')!;
    expect(trigger.getAttribute('aria-label')).toBe('2 more tabs');
  });

  it('shows latest tabs on place routes when no workspace tab is active', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    seedKeptDocTabs(['d1.md', 'd2.md', 'd3.md', 'd4.md']);
    await navigateTo('/capture');

    await act(async () => {
      ResizeObserverStub.instances.forEach((ro) => ro.trigger(332));
    });

    expect(tabTitles()).toEqual(['d3.md', 'd4.md']);
  });

  it('uses the session agent logo in chat tabs when runtime metadata is available', async () => {
    const resolveSessions = deferServerSessions();
    await navigateTo('/chat/codex-1');

    await act(async () => {
      resolveSessions([
        makeSession('codex-1', 'Codex task', 'continue work', {
          defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
        }),
      ]);
    });

    expect(document.querySelector('[data-titlebar-agent-kind="codex"] img[src="/agent-icons/openai.svg"]')).not.toBeNull();
  });

  it('right-click tab actions close tabs to the right', async () => {
    seedKeptDocTabs(['a.md', 'b.md', 'c.md']);
    await navigateTo('/view/b.md');

    await rightClick(findTab('b.md')!);
    const closeRight = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
      .find((button) => button.textContent?.trim() === 'Close tabs to the right')!;
    expect(closeRight).toBeTruthy();

    await click(closeRight);

    expect(getTabs().map((tab) => tab.title)).toEqual(['a.md', 'b.md']);
    expect(tabTitles()).toEqual(['a.md', 'b.md']);
  });

  it('right-click tab actions can close all session tabs without deleting file tabs', async () => {
    seedKeptDocTabs(['a.md']);
    openTab('chat', 's1', 'Session 1');
    openTab('chat', 's2', 'Session 2');
    await navigateTo('/view/a.md');

    await rightClick(findTab('a.md')!);
    const closeSessions = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] button'))
      .find((button) => button.textContent?.trim() === 'Close session tabs')!;
    expect(closeSessions).toBeTruthy();

    await click(closeSessions);

    expect(getTabs()).toEqual([{ id: 'doc:a.md', kind: 'doc', key: 'a.md', title: 'a.md' }]);
  });

  it('closing a hidden tab from the overflow menu works without navigating', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    seedKeptDocTabs(['d1.md', 'd2.md', 'd3.md']);
    await navigateTo('/view/d1.md'); // active = d1 (visible)
    await act(async () => {
      ResizeObserverStub.instances.forEach((ro) => ro.trigger(240)); // 1 visible, 2 hidden
    });
    expect(tabTitles()).toEqual(['d1.md']);

    await click(document.querySelector('[data-overflow-trigger]')!);
    h.push.mockClear();
    const closeButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="menu"] button[aria-label="Close tab"]'),
    );
    await click(closeButtons[0]); // d2.md
    expect(getTabs().map((t) => t.title)).toEqual(['d1.md', 'd3.md']);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('aligns utility actions to the tab baseline with compact rounded controls', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    seedKeptDocTabs(['d1.md', 'd2.md', 'd3.md']);
    await navigateTo('/view/d1.md');
    await act(async () => {
      ResizeObserverStub.instances.forEach((ro) => ro.trigger(240));
    });

    const newChatButton = document.querySelector<HTMLButtonElement>('button[aria-label="New chat"]');
    const homeButton = document.querySelector<HTMLButtonElement>('[data-titlebar-home-button]');
    const overflowButton = document.querySelector<HTMLButtonElement>('[data-overflow-trigger]');

    for (const button of [homeButton, newChatButton, overflowButton]) {
      expect(button).not.toBeNull();
      expect(button!.className).toContain('self-end');
      expect(button!.className).toContain('mb-1');
      expect(button!.className).toContain('rounded-full');
      expect(button!.className).not.toContain('self-center');
    }
    expect(homeButton!.className).toContain('h-7 w-7');
    expect(newChatButton!.className).toContain('h-7 w-7');
  });

  it('keeps the new-chat button adjacent to the last visible tab instead of after stretched tab space', async () => {
    seedKeptDocTabs(['d1.md', 'd2.md']);
    await navigateTo('/view/d2.md');

    const tablist = document.querySelector<HTMLElement>('[data-titlebar-tablist]');
    const tabs = tabEls();
    const newChatButton = document.querySelector<HTMLButtonElement>('button[aria-label="New chat"]');

    expect(tablist).not.toBeNull();
    expect(newChatButton).not.toBeNull();
    expect(tablist!.className).toContain('shrink');
    expect(tablist!.className).not.toContain('flex-1');
    for (const tab of tabs) {
      expect(tab.className).toContain('shrink-0');
      expect(tab.className).not.toContain('flex-1');
    }
    expect(newChatButton!.className).toContain('ml-1');
  });

  it('tabHref round-trips with parseActiveTab', () => {
    const docKey = '笔记/日记😀.md';
    expect(parseActiveTab(tabHref({ kind: 'home', key: 'root' }))).toBeNull();
    expect(parseActiveTab(tabHref({ kind: 'doc', key: docKey }))).toEqual({ kind: 'doc', key: docKey });
    expect(parseActiveTab(tabHref({ kind: 'chat', key: 'abc-123' }))).toEqual({ kind: 'chat', key: 'abc-123' });
  });
});
