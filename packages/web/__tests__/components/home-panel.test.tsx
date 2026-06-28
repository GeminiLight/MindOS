// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePanel from '@/components/panels/HomePanel';
import type { ChatSession, Message } from '@/lib/types';
import {
  getActiveSessionId,
  getSessions,
  initSessions,
  loadSession,
  resetAgentSessionStoreForTests,
} from '@/lib/agent-session-store';
import {
  getMessages,
  resetAgentRunStoreForTests,
  startRun,
} from '@/lib/agent-run-store';

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

async function renderHomePanel(overrides: Partial<React.ComponentProps<typeof HomePanel>> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <HomePanel
        active
        fileTree={[{ name: 'Notes', path: 'Notes', type: 'directory', children: [] }]}
        mindSystemSlots={[]}
        {...overrides}
      />,
    );
  });
}

function expectThemeAwareAgentShell(mark: HTMLElement | null) {
  expect(mark).not.toBeNull();
  expect(mark?.className).toContain('bg-background/85');
  expect(mark?.className).toContain('dark:bg-muted/70');
  expect(mark?.className).not.toContain('bg-white');
  expect(mark?.className).toContain('border-border');
}

describe('HomePanel', () => {
  beforeEach(() => {
    resetAgentRunStoreForTests();
    resetAgentSessionStoreForTests();
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
    expect(host.textContent).toContain('Codex');
    expect(host.textContent).toContain('thread_1...abcdef');
    expect(host.textContent).toContain('1 msg');
    expect(host.textContent).not.toContain('Running');
    const codexMark = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-agent="codex"]') as HTMLElement | null;
    expectThemeAwareAgentShell(codexMark);
    const codexLogo = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-agent="codex"] img') as HTMLImageElement | null;
    expect(codexLogo?.getAttribute('src')).toBe('/agent-icons/openai.svg');
    expect(codexLogo?.closest('[data-home-session-row]')?.textContent).toContain('Investigate file tree open latency');
    const title = Array.from(host.querySelectorAll('[data-home-session-row="s-codex"] span')).find((node) => (
      node.textContent === 'Investigate file tree open latency'
    )) as HTMLElement | undefined;
    expect(title?.className).toContain('text-[12px]');
    expect(title?.className).toContain('font-medium');
    expect(host.querySelector('[data-home-session-row="s-codex"] [data-home-session-time]')).not.toBeNull();
    const meta = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-meta]') as HTMLElement | null;
    expect(meta?.textContent).toContain('Codex');
    expect(meta?.textContent).toContain('thread_1...abcdef');
    expect(meta?.textContent).toContain('1 msg');
    expect(meta?.getAttribute('title')).toContain('Session ID: thread_1234567890abcdef');
    expect(host.querySelector('button[aria-label="Pin session"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Rename session"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Fork session"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Archive session"]')).not.toBeNull();
    const status = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-status="running"]') as HTMLElement | null;
    expect(status).not.toBeNull();
    const timeSlot = status?.closest('[data-home-session-time]') as HTMLElement | null;
    expect(timeSlot).not.toBeNull();
    expect(timeSlot?.className).toContain('absolute');
    expect(timeSlot?.className).toContain('right-0');
    expect(timeSlot?.className).toContain('group-hover:opacity-0');
    const actions = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-actions]') as HTMLElement | null;
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain('opacity-0');
    expect(actions?.className).toContain('group-hover:pointer-events-auto');
    expect(actions?.className).toContain('group-hover:opacity-100');
    expect(host.querySelector('[data-home-session-row="s-codex"] [data-stable-row-trailing]')).toBeNull();
    const openButton = host.querySelector('[data-home-session-row="s-codex"] button[data-home-session-open]') as HTMLButtonElement | null;
    expect(openButton?.className).toContain('absolute');
    expect(openButton?.className).toContain('inset-0');
    expect(openButton?.getAttribute('aria-label')).toBe('Investigate file tree open latency');
    const visibleLabel = host.querySelector('[data-home-session-row="s-codex"] [data-home-session-label]') as HTMLElement | null;
    expect(visibleLabel?.closest('.pointer-events-none')).not.toBeNull();
    expect(actions?.className).toContain('pointer-events-none');
    expect(actions?.className).toContain('z-20');
  });

  it('opens Home sessions from the full-row layer without action buttons stealing selection', async () => {
    const sessions = [
      session({
        id: 's-current',
        messages: [userMsg('Current conversation')],
      }),
      session({
        id: 's-target',
        messages: [userMsg('Target conversation')],
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});
    loadSession('s-current');

    await renderHomePanel();

    const targetRow = host.querySelector('[data-home-session-row="s-target"]') as HTMLElement | null;
    expect(targetRow).not.toBeNull();
    const pinButton = targetRow!.querySelector('button[aria-label="Pin session"]') as HTMLButtonElement | null;
    expect(pinButton).not.toBeNull();

    await act(async () => {
      pinButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getActiveSessionId()).toBe('s-current');

    const updatedTargetRow = host.querySelector('[data-home-session-row="s-target"]') as HTMLElement | null;
    const openButton = updatedTargetRow!.querySelector('button[data-home-session-open]') as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    expect(openButton?.className).toContain('absolute');
    expect(openButton?.className).toContain('inset-0');

    await act(async () => {
      openButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(getActiveSessionId()).toBe('s-target');
  });

  it('forks a Home session from the row action without opening the source session', async () => {
    const sessions = [
      session({
        id: 's-source',
        messages: [userMsg('Source conversation')],
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel();

    const sourceRow = host.querySelector('[data-home-session-row="s-source"]') as HTMLElement | null;
    expect(sourceRow).not.toBeNull();
    const forkButton = sourceRow!.querySelector('button[aria-label="Fork session"]') as HTMLButtonElement | null;
    expect(forkButton).not.toBeNull();

    await act(async () => {
      forkButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const activeId = getActiveSessionId();
    expect(activeId).toBeTruthy();
    expect(activeId).not.toBe('s-source');
    const forked = getSessions().find((item) => item.id === activeId);
    expect(forked?.title).toBe('Source conversation copy');
    expect(getMessages(activeId!).map((message) => message.content)).toEqual(['Source conversation']);
  });

  it('imports Codex history when opening a metadata-only Home session', async () => {
    const turnTimestamp = '2026-06-29T01:30:00.000Z';
    const boundCodexSession = session({
      id: 's-codex-empty',
      title: 'Home Codex thread',
      messages: [],
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thread_home',
        cwd: '/tmp/repo',
        status: 'active',
        updatedAt: 123,
      },
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/agent-runtimes/codex/threads/thread_home?includeTurns=1') {
        return {
          ok: true,
          json: async () => ({
            thread: {
              id: 'thread_home',
              name: 'Home Codex thread',
              cwd: '/tmp/repo',
              updatedAt: 123,
              turns: [{
                timestamp: turnTimestamp,
                input: [{ type: 'text', text: 'home previous prompt' }],
                output: [{
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'home previous answer' }],
                }],
              }],
            },
          }),
        };
      }
      if (!init?.method || init.method === 'GET') {
        return { ok: true, json: async () => [boundCodexSession] };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    await initSessions({});

    await renderHomePanel();

    const openButton = host.querySelector('[data-home-session-row="s-codex-empty"] button[data-home-session-open]') as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    await act(async () => {
      openButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.some(([url]) => (
      String(url) === '/api/agent-runtimes/codex/threads/thread_home?includeTurns=1'
    ))).toBe(true);
    expect(getMessages('s-codex-empty')).toEqual([
      {
        role: 'user',
        content: 'home previous prompt',
        timestamp: Date.parse(turnTimestamp),
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
      {
        role: 'assistant',
        content: 'home previous answer',
        timestamp: Date.parse(turnTimestamp),
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
    ]);
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

  it('searches Home sessions locally instead of opening file search', async () => {
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
    const openFileSearch = vi.fn();
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel({ onSearchOpenOrFocus: openFileSearch });

    const searchButton = host.querySelector('button[aria-label="Search sessions"]') as HTMLButtonElement | null;
    expect(searchButton).not.toBeNull();
    await act(async () => {
      searchButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(openFileSearch).not.toHaveBeenCalled();
    const searchInput = host.querySelector('[data-home-session-search-input]') as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    expect(searchInput?.getAttribute('placeholder')).toBe('Search sessions...');

    await act(async () => {
      searchInput!.value = 'prompt';
      searchInput!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'prompt' }));
      searchInput!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(host.querySelector('[data-home-session-row="s-codex"]')).toBeNull();
    expect(host.querySelector('[data-home-session-row="s-claude"]')).not.toBeNull();
    expect(host.textContent).toContain('Review the prompt runtime plan');
    expect(host.textContent).not.toContain('Investigate file tree open latency');
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

    const claudeMark = host.querySelector('[data-home-session-row="s-claude"] [data-home-session-agent="claude"]') as HTMLElement | null;
    expectThemeAwareAgentShell(claudeMark);
    const claudeLogo = host.querySelector('[data-home-session-row="s-claude"] [data-home-session-agent="claude"] img') as HTMLImageElement | null;
    expect(claudeLogo?.getAttribute('src')).toBe('/agent-icons/claude.svg');
  });

  it('uses concrete ACP CLI logos and exposes each ACP runtime as its own sidebar filter', async () => {
    const sessions = [
      session({
        id: 's-kimi',
        updatedAt: 3_000,
        messages: [userMsg('Run Kimi ACP')],
        defaultAgentRuntime: { id: 'kimi', name: 'Kimi CLI', kind: 'acp' },
        defaultAcpAgent: { id: 'kimi', name: 'Kimi CLI' },
      }),
      session({
        id: 's-gemini',
        updatedAt: 2_800,
        messages: [userMsg('Run Gemini ACP')],
        defaultAgentRuntime: { id: 'gemini-cli', name: 'Gemini CLI', kind: 'acp' },
      }),
      session({
        id: 's-opencode',
        updatedAt: 2_500,
        messages: [userMsg('Run OpenCode ACP')],
        defaultAcpAgent: { id: 'opencode', name: 'OpenCode' },
      }),
    ];
    installFetchMock(sessions);
    await initSessions({});

    await renderHomePanel();

    const kimiMark = host.querySelector('[data-home-session-row="s-kimi"] [data-home-session-agent="acp"]') as HTMLElement | null;
    expectThemeAwareAgentShell(kimiMark);
    expect(kimiMark?.getAttribute('data-home-session-agent-runtime')).toBe('kimi');
    const kimiLogo = host.querySelector('[data-home-session-row="s-kimi"] [data-home-session-agent="acp"] img') as HTMLImageElement | null;
    expect(kimiLogo?.getAttribute('src')).toBe('/agent-icons/kimi-cli.png');

    const opencodeLogo = host.querySelector('[data-home-session-row="s-opencode"] [data-home-session-agent="acp"] img') as HTMLImageElement | null;
    expect(opencodeLogo?.getAttribute('src')).toBe('/agent-icons/opencode.svg');

    const geminiLogo = host.querySelector('[data-home-session-row="s-gemini"] [data-home-session-agent="acp"] img') as HTMLImageElement | null;
    expect(geminiLogo?.getAttribute('src')).toBe('/agent-icons/gemini.svg');

    const kimiFilter = host.querySelector('[data-home-agent-filter="acp:kimi"]') as HTMLButtonElement | null;
    expect(kimiFilter?.getAttribute('aria-label')).toBe('ACP agents: Kimi CLI (1)');
    expect(kimiFilter?.querySelector('[data-home-session-agent="acp"] img')?.getAttribute('src')).toBe('/agent-icons/kimi-cli.png');

    const opencodeFilter = host.querySelector('[data-home-agent-filter="acp:opencode"]') as HTMLButtonElement | null;
    expect(opencodeFilter?.getAttribute('aria-label')).toBe('ACP agents: OpenCode (1)');
    expect(opencodeFilter?.querySelector('[data-home-session-agent="acp"] img')?.getAttribute('src')).toBe('/agent-icons/opencode.svg');

    const geminiFilter = host.querySelector('[data-home-agent-filter="acp:gemini-cli"]') as HTMLButtonElement | null;
    expect(geminiFilter?.getAttribute('aria-label')).toBe('ACP agents: Gemini CLI (1)');
    expect(geminiFilter?.querySelector('[data-home-session-agent="acp"] img')?.getAttribute('src')).toBe('/agent-icons/gemini.svg');

    await act(async () => {
      opencodeFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('Run OpenCode ACP');
    expect(host.textContent).not.toContain('Run Kimi ACP');
    expect(host.textContent).not.toContain('Run Gemini ACP');

    await act(async () => {
      geminiFilter!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.textContent).toContain('Run Gemini ACP');
    expect(host.textContent).not.toContain('Run Kimi ACP');
    expect(host.textContent).not.toContain('Run OpenCode ACP');
  });

  it('uses a theme-aware logo shell for MindOS sessions', async () => {
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
    expectThemeAwareAgentShell(mindosMark);
  });

  it('does not force-open the ask panel when creating a Home session', async () => {
    installFetchMock([]);
    const openAskPanel = vi.fn();
    window.addEventListener('mindos:open-ask-panel', openAskPanel);
    await renderHomePanel();

    const newSession = host.querySelector('button[aria-label="New session"]') as HTMLButtonElement | null;
    expect(newSession).not.toBeNull();

    await act(async () => {
      newSession!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(openAskPanel).not.toHaveBeenCalled();
    window.removeEventListener('mindos:open-ask-panel', openAskPanel);
  });

  it('offers Mind Files and New session actions when sessions are empty', async () => {
    installFetchMock([]);
    await renderHomePanel();

    expect(host.textContent).toContain('No sessions yet');
    const emptyFilesButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Mind Files');
    const emptyNewSessionButton = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'New session');

    expect(emptyFilesButton).not.toBeNull();
    expect(emptyNewSessionButton).not.toBeNull();

    await act(async () => {
      emptyFilesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('[data-home-mind-files]')).not.toBeNull();
    expect(host.textContent).toContain('Notes');
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
