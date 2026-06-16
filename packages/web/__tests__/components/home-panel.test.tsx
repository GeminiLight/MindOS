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

  it('defaults to agent sessions and shows runtime plus running status per item', async () => {
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
    expect(host.textContent).toContain('Codex');
    expect(host.textContent).toContain('Running');
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
