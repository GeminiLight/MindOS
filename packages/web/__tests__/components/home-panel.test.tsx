// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePanel from '@/components/panels/HomePanel';
import type { ChatSession, Message } from '@/lib/types';
import {
  initSessions,
  resetAskSessionStoreForTests,
} from '@/lib/ask-session-store';
import {
  resetAskRunStoreForTests,
  startRun,
} from '@/lib/ask-run-store';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

function userMsg(content: string): Message {
  return { role: 'user', content } as Message;
}

function installFetchMock(sessions: ChatSession[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => sessions,
  })));
}

function session(partial: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    id: partial.id,
    createdAt: 1_000,
    updatedAt: 2_000,
    messages: [userMsg('Investigate file tree open latency')],
    ...partial,
  };
}

async function renderHomePanel() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <HomePanel
        active
        fileTree={[{ name: 'Notes', path: 'Notes', type: 'directory', children: [] }]}
        mindSystemSlots={[]}
      />,
    );
  });
}

describe('HomePanel', () => {
  beforeEach(() => {
    resetAskRunStoreForTests();
    resetAskSessionStoreForTests();
    push.mockClear();
  });

  afterEach(async () => {
    if (root) {
      const r = root;
      root = null;
      await act(async () => { r.unmount(); });
    }
    host?.remove();
    vi.unstubAllGlobals();
  });

  it('defaults to agent sessions and renders compact agent/status markers', async () => {
    const sessions = [
      session({
        id: 's-codex',
        runtimeSessionBinding: {
          kind: 'codex-thread',
          runtime: 'codex',
          runtimeId: 'codex',
          externalSessionId: 'thread_1234567890abcdef',
          status: 'active',
          updatedAt: 2_000,
        },
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});
    startRun('s-codex', {
      controller: new AbortController(),
      runtimeSnapshot: { id: 'codex', name: 'Codex', kind: 'codex' },
      reconnectMax: 0,
    });

    await renderHomePanel();

    expect(host.querySelector('[data-home-session-list]')).not.toBeNull();
    expect(host.textContent).toContain('Investigate file tree open latency');
    expect(host.textContent).not.toContain('Codex');
    expect(host.textContent).not.toContain('Running');
    expect(host.querySelector('[data-home-session-row="s-codex"] [data-home-session-agent="codex"]')).not.toBeNull();
    const codexLogo = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-agent="codex"] img') as HTMLImageElement | null;
    expect(codexLogo?.getAttribute('src')).toBe('/agent-icons/openai.svg');
    expect(codexLogo?.closest('[data-home-session-row]')?.textContent).toContain('Investigate file tree open latency');
    const title = Array.from(host.querySelectorAll('[data-home-session-row="s-codex"] span')).find((node) => (
      node.textContent === 'Investigate file tree open latency'
    )) as HTMLElement | undefined;
    expect(title?.className).toContain('text-[13px]');
    expect(title?.className).not.toContain('font-medium');
    expect(host.querySelector('[data-home-session-row="s-codex"] [data-home-session-status="running"]')).not.toBeNull();
  });

  it('filters Home sessions by agent runtime', async () => {
    const sessions = [
      session({
        id: 's-codex',
        messages: [userMsg('Investigate file tree open latency')],
        runtimeSessionBinding: {
          kind: 'codex-thread',
          runtime: 'codex',
          runtimeId: 'codex',
          externalSessionId: 'thread_1234567890abcdef',
          status: 'active',
          updatedAt: 2_000,
        },
      }),
      session({
        id: 's-claude',
        messages: [userMsg('Review the prompt runtime plan')],
        runtimeSessionBinding: {
          kind: 'claude-session',
          runtime: 'claude',
          runtimeId: 'claude',
          externalSessionId: 'claude-session-123',
          status: 'active',
          updatedAt: 2_000,
        },
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel();

    expect(host.textContent).toContain('Investigate file tree open latency');
    expect(host.textContent).toContain('Review the prompt runtime plan');

    const codexFilter = host.querySelector('[data-home-agent-filter="codex"]') as HTMLButtonElement | null;
    expect(codexFilter).not.toBeNull();
    await act(async () => {
      codexFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('Investigate file tree open latency');
    expect(host.textContent).not.toContain('Review the prompt runtime plan');
  });

  it('uses the local Claude Code logo for Claude sessions', async () => {
    const sessions = [
      session({
        id: 's-claude',
        messages: [userMsg('Review the prompt runtime plan')],
        runtimeSessionBinding: {
          kind: 'claude-session',
          runtime: 'claude',
          runtimeId: 'claude',
          externalSessionId: 'claude-session-123',
          status: 'active',
          updatedAt: 2_000,
        },
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel();

    const claudeLogo = host.querySelector('[data-home-session-row="s-claude"] [data-home-session-agent="claude"] img') as HTMLImageElement | null;
    expect(claudeLogo?.getAttribute('src')).toBe('/agent-icons/claude.svg');
  });

  it('uses the same white logo shell for MindOS sessions', async () => {
    const sessions = [
      session({
        id: 's-mindos',
        messages: [userMsg('Open the daily planning note')],
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel();

    const mindosMark = host.querySelector('[data-home-session-row="s-mindos"] [data-home-session-agent="mindos"]') as HTMLElement | null;
    expect(mindosMark).not.toBeNull();
    expect(mindosMark?.className).toContain('bg-background');
    expect(mindosMark?.className).toContain('border-border');
  });

  it('switches the Home sidebar header into Mind Files mode', async () => {
    installFetchMock([]);
    await renderHomePanel();

    const filesButton = host.querySelector('[data-home-sidebar-mode="files"]') as HTMLButtonElement | null;
    expect(filesButton).not.toBeNull();
    expect(filesButton?.getAttribute('aria-label')).toBe('Mind Files');
    expect(filesButton?.className).toContain('w-7');
    expect(filesButton?.textContent?.trim()).toBe('');

    await act(async () => {
      filesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('[data-home-mind-files]')).not.toBeNull();
    expect(host.textContent).toContain('Notes');
  });
});
