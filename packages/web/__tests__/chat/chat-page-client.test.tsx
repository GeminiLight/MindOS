// @vitest-environment jsdom
/**
 * /chat/[sessionId] route client (spec-titlebar-row.md Phase 2):
 * creation flow ('new' → store create → router.replace), alive-session
 * resolution (metadata list OR run-store survivors), URL decoding, and the
 * missing-session fallback page with both actions wired.
 *
 * Real ask-session-store / ask-run-store / workspace-tabs modules are used
 * (setup.ts resets them after each test); AskContent is mocked to observe the
 * props the route passes down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ChatPageClient from '@/app/chat/[sessionId]/ChatPageClient';
import {
  getActiveSessionId,
  getSessions,
  resetSession,
} from '@/lib/ask-session-store';
import { setMessages } from '@/lib/ask-run-store';
import { getTabs, openTab } from '@/lib/workspace-tabs';
import type { ChatSession } from '@/lib/types';

const { routerPush, routerReplace, mockAskContentProps, mockSearchParams } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  mockAskContentProps: vi.fn(),
  mockSearchParams: { value: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/chat/xyz',
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('@/lib/stores/locale-store', async () => {
  const { messages } = await import('@/lib/i18n');
  return {
    useLocale: () => ({ locale: 'en' as const, setLocale: vi.fn(), t: messages.en }),
  };
});

vi.mock('@/components/ask/AskContent', () => ({
  default: (props: Record<string, unknown>) => {
    mockAskContentProps(props);
    return <div data-testid="ask-content" />;
  },
}));

let serverSessions: ChatSession[] = [];

function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/ask-sessions')) {
      return Promise.resolve({
        ok: true,
        json: async () => serverSessions,
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}), body: null } as unknown as Response);
  });
}

async function renderPage(sessionId: string, opts: { strict?: boolean } = {}): Promise<{ host: HTMLElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const page = <ChatPageClient sessionId={sessionId} />;
  await act(async () => {
    root.render(opts.strict ? <StrictMode>{page}</StrictMode> : page);
  });
  // Flush the refreshSessions promise chain (fetch → json → re-check).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.value = new URLSearchParams();
  document.body.innerHTML = '';
  serverSessions = [];
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', stubFetch());
});

describe('/chat/new creation flow', () => {
  it('creates a fresh session and replaces the URL exactly once under double-invoked effects', async () => {
    const { host } = await renderPage('new', { strict: true });

    const id = getActiveSessionId();
    expect(id).toBeTruthy();
    expect(getSessions().some((s) => s.id === id)).toBe(true);
    expect(routerReplace).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith(`/chat/${encodeURIComponent(id!)}`);
    // No flash of the fallback UI while creating.
    expect(host.textContent).not.toContain('This conversation no longer exists');
    expect(mockAskContentProps).not.toHaveBeenCalled();
  });

  it('creates a Project-scoped session from the projectId query param', async () => {
    mockSearchParams.value = new URLSearchParams('projectId=launch-practice');

    await renderPage('new');

    const id = getActiveSessionId();
    const session = getSessions().find((item) => item.id === id);
    expect(session).toMatchObject({
      source: 'project',
      projectId: 'launch-practice',
    });
    expect(routerReplace).toHaveBeenCalledWith(`/chat/${encodeURIComponent(id!)}`);
  });
});

describe('/chat/<id> with an alive session', () => {
  it('selects an existing session via loadSession and renders AskContent with initialSessionId', async () => {
    // Seed session A (has messages) then B (fresh empty, active).
    resetSession();
    const idA = getActiveSessionId()!;
    setMessages(idA, [{ role: 'user', content: 'hello' }], { skipPersist: true });
    resetSession();
    const idB = getActiveSessionId()!;
    expect(idB).not.toBe(idA);

    await renderPage(idA);

    // loadSession ran: A is active and the abandoned empty B was dropped.
    expect(getActiveSessionId()).toBe(idA);
    expect(getSessions().some((s) => s.id === idB)).toBe(false);
    expect(mockAskContentProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: idA, visible: true, variant: 'home', onDockToPanel: expect.any(Function) }),
    );
  });

  it('docks a full-page chat back to the right panel on the wiki surface by default', async () => {
    resetSession();
    const id = getActiveSessionId()!;
    setMessages(id, [{ role: 'user', content: 'hello' }], { skipPersist: true });

    await renderPage(id);

    const props = mockAskContentProps.mock.calls.at(-1)?.[0] as { onDockToPanel?: () => void };
    expect(props.onDockToPanel).toEqual(expect.any(Function));

    await act(async () => {
      props.onDockToPanel?.();
    });

    expect(routerPush).toHaveBeenCalledWith('/wiki');
  });

  it('docks a file-scoped full-page chat back to its current file', async () => {
    resetSession({ currentFile: 'Notes/example.md' });
    const id = getActiveSessionId()!;
    setMessages(id, [{ role: 'user', content: 'hello' }], { skipPersist: true });

    await renderPage(id);

    const props = mockAskContentProps.mock.calls.at(-1)?.[0] as { onDockToPanel?: () => void };
    await act(async () => {
      props.onDockToPanel?.();
    });

    expect(routerPush).toHaveBeenCalledWith('/view/Notes/example.md');
  });

  it('renders chat (not fallback) for a session alive only in the run store (evicted from server list)', async () => {
    setMessages('evicted-1', [{ role: 'user', content: 'still here' }], { skipPersist: true });
    expect(getSessions().some((s) => s.id === 'evicted-1')).toBe(false);

    const { host } = await renderPage('evicted-1');

    expect(host.querySelector('[data-testid="ask-content"]')).toBeTruthy();
    expect(host.textContent).not.toContain('This conversation no longer exists');
    expect(getActiveSessionId()).toBe('evicted-1');
    expect(mockAskContentProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: 'evicted-1' }),
    );
  });

  it('URL-decodes the session id route param', async () => {
    setMessages('id with space', [{ role: 'user', content: 'hi' }], { skipPersist: true });

    await renderPage('id%20with%20space');

    expect(getActiveSessionId()).toBe('id with space');
    expect(mockAskContentProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: 'id with space' }),
    );
  });

  it('resolves a session that only exists on the server after refreshSessions', async () => {
    serverSessions = [{
      id: 'srv-1',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'from server' }],
    }];

    const { host } = await renderPage('srv-1');

    expect(getActiveSessionId()).toBe('srv-1');
    expect(host.querySelector('[data-testid="ask-content"]')).toBeTruthy();
  });

  it('passes Project scope to AskContent for Project-scoped chat routes', async () => {
    serverSessions = [{
      id: 'project-chat-1',
      source: 'project',
      projectId: 'launch-practice',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'from project' }],
    }];

    await renderPage('project-chat-1');

    expect(mockAskContentProps).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSessionId: 'project-chat-1',
        projectId: 'launch-practice',
        onDockToPanel: expect.any(Function),
      }),
    );

    const props = mockAskContentProps.mock.calls.at(-1)?.[0] as { onDockToPanel?: () => void };
    await act(async () => {
      props.onDockToPanel?.();
    });

    expect(routerPush).toHaveBeenCalledWith('/studio/launch-practice');
  });
});

describe('/chat/<id> missing-session fallback', () => {
  it('shows the fallback after refresh and wires both actions', async () => {
    openTab('chat', 'ghost-1', 'Ghost chat');
    expect(getTabs()).toHaveLength(1);

    const { host } = await renderPage('ghost-1');

    // refreshSessions was attempted before declaring the session missing.
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/ask-sessions'))).toBe(true);
    expect(host.textContent).toContain('This conversation no longer exists');
    expect(host.textContent).toContain('30-session history limit');
    expect(host.querySelector('[data-testid="ask-content"]')).toBeNull();

    const buttons = Array.from(host.querySelectorAll('button'));
    const closeButton = buttons.find((b) => b.textContent === 'Close this tab')!;
    const homeButton = buttons.find((b) => b.textContent === 'Back to home')!;
    expect(closeButton).toBeTruthy();
    expect(homeButton).toBeTruthy();

    await act(async () => { closeButton.click(); });
    expect(getTabs()).toHaveLength(0); // closeByKey('chat', id)
    expect(routerPush).toHaveBeenCalledWith('/');

    await act(async () => { homeButton.click(); });
    expect(routerPush).toHaveBeenCalledTimes(2);
    expect(routerPush).toHaveBeenLastCalledWith('/');
  });

  it('does not crash on a malformed percent-encoded id and falls back calmly', async () => {
    const { host } = await renderPage('%E0%A4%A');

    expect(host.textContent).toContain('This conversation no longer exists');
  });
});
