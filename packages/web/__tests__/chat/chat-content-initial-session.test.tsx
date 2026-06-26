// @vitest-environment jsdom
/**
 * ChatContent initialSessionId prop (spec-titlebar-row.md Phase 2, /chat route):
 * when the route already selected a session via loadSession, the init effect
 * must NOT run initSessions (its selection phase would clobber the route's
 * choice) — it refreshes session metadata instead. The default path (no
 * initialSessionId) keeps calling initSessions unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ChatContent from '@/components/chat/ChatContent';
import {
  requestAskPanelNewSessionActivation,
  requestAskPanelSessionActivation,
} from '@/lib/ask-panel-session-activation';
import type { ChatSession } from '@/lib/types';

const {
  mockInitSessions,
  mockRefreshSessions,
  mockLoadSession,
  mockResetSession,
  mockStoreGetActiveSessionId,
  mockStoreRenameSession,
  mockStoreResetSession,
} = vi.hoisted(() => ({
  mockInitSessions: vi.fn(),
  mockRefreshSessions: vi.fn(() => Promise.resolve()),
  mockLoadSession: vi.fn(),
  mockResetSession: vi.fn(),
  mockStoreGetActiveSessionId: vi.fn(() => 'fresh-project-session'),
  mockStoreRenameSession: vi.fn(),
  mockStoreResetSession: vi.fn(),
}));

const { mockSubmit, mockStop, mockFirstMessageFired, mockIsLoadingRef, mockAbortRef } = vi.hoisted(() => ({
  mockSubmit: vi.fn((event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();
  }),
  mockStop: vi.fn(),
  mockFirstMessageFired: { current: false },
  mockIsLoadingRef: { current: false },
  mockAbortRef: { current: null as AbortController | null },
}));

const emptySession: ChatSession = {
  id: 's1',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
};

vi.mock('@/lib/agent-session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-session-store')>();
  return {
    ...actual,
    getActiveSessionId: mockStoreGetActiveSessionId,
    refreshSessions: mockRefreshSessions,
    renameSession: mockStoreRenameSession,
    resetSession: mockStoreResetSession,
  };
});

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    setLocale: vi.fn(),
    t: {
      ask: {
        placeholder: 'Ask a question...',
        send: 'Send',
        newlineHint: 'new line',
        attachFileLabel: 'Document',
        attachImageLabel: 'Image',
        stopTitle: 'Stop',
        cancelReconnect: 'Cancel reconnect',
        connecting: 'connecting',
        thinking: 'thinking',
        generating: 'generating',
        reconnecting: (attempt: number, max: number) => `retry ${attempt}/${max}`,
        stopped: 'stopped',
        errorNoResponse: 'no response',
        concurrentLimit: 'Another run is still active.',
        emptyPrompt: 'empty',
        emptyHint: 'empty hint',
        suggestions: [],
        copyMessage: 'Copy',
        editMessage: 'Edit',
        regenerateMessage: 'Regenerate',
        sessionRunningRetry: 'That session is still running. Try again after it finishes.',
      },
      hints: { attachFile: 'Attach local file' },
      fileImport: { unsupported: 'Unsupported file type' },
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [emptySession],
    activeSession: emptySession,
    activeSessionId: 's1',
    initSessions: mockInitSessions,
    persistSession: vi.fn(),
    clearPersistTimer: vi.fn(),
    setMessages: vi.fn(),
    setSessionDefaultAcpAgent: vi.fn(),
    setSessionAgentRuntimeBinding: vi.fn(),
    attachRuntimeSession: vi.fn(() => true),
    resetSession: mockResetSession,
    loadSession: mockLoadSession,
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    togglePinSession: vi.fn(),
    clearSessions: vi.fn(),
    clearAllSessions: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    localAttachments: [],
    uploadError: '',
    uploadInputRef: { current: null },
    clearAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pickFiles: vi.fn(),
    injectFiles: vi.fn(),
  }),
}));

vi.mock('@/hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    images: [],
    imageError: '',
    clearImages: vi.fn(),
    removeImage: vi.fn(),
    handlePaste: vi.fn(),
    handleDrop: vi.fn(),
    handleFileSelect: vi.fn(),
    addImages: vi.fn(),
  }),
}));

vi.mock('@/hooks/useMention', () => ({
  useMention: () => ({
    mentionQuery: null,
    mentionResults: [],
    mentionIndex: 0,
    resetMention: vi.fn(),
    updateMentionFromInput: vi.fn(),
    navigateMention: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSlashCommand', () => ({
  useSlashCommand: () => ({
    slashQuery: null,
    slashResults: [],
    slashIndex: 0,
    resetSlash: vi.fn(),
    updateSlashFromInput: vi.fn(),
    navigateSlash: vi.fn(),
  }),
}));

vi.mock('@/hooks/useNativeRuntimeDetection', () => ({
  useNativeRuntimeDetection: () => ({
    runtimes: [],
    loadingByKind: {},
    errorByKind: {},
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAgentChat', () => ({
  useAgentChat: () => ({
    isLoading: false,
    loadingPhase: 'connecting',
    reconnectAttempt: 0,
    reconnectMax: 3,
    agentRunContext: null,
    submit: mockSubmit,
    stop: mockStop,
    firstMessageFired: mockFirstMessageFired,
    isLoadingRef: mockIsLoadingRef,
    abortRef: mockAbortRef,
  }),
}));

vi.mock('@/hooks/useAgentRunTimeline', () => ({
  useAgentRunTimeline: vi.fn(),
}));

vi.mock('@/components/ask/MessageList', () => ({ default: () => <div data-testid="message-list" /> }));
vi.mock('@/components/ask/MentionPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SlashCommandPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistoryPanel', () => ({ default: () => null }));
vi.mock('@/components/ask/AskHeader', () => ({ default: () => null }));
vi.mock('@/components/ask/FileChip', () => ({ default: () => null }));
vi.mock('@/components/ask/AskComposerInput', async () => {
  const React = await import('react');
  return {
    default: function MockAskComposerInput(props: {
      inputRef: React.MutableRefObject<HTMLTextAreaElement | null>;
      valueRef: React.MutableRefObject<string>;
      setterRef: React.MutableRefObject<((value: string) => void) | null>;
      onValueChange: (value: string, cursorPos?: number) => void;
      onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
      onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
      placeholder: string;
    }) {
      const [value, setValue] = React.useState(() => props.valueRef.current);

      React.useLayoutEffect(() => {
        const setter = (next: string) => {
          props.valueRef.current = next;
          setValue(next);
        };
        props.setterRef.current = setter;
        return () => {
          if (props.setterRef.current === setter) props.setterRef.current = null;
        };
      }, [props.setterRef, props.valueRef]);

      return (
        <textarea
          ref={(el) => {
            props.inputRef.current = el;
          }}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            props.valueRef.current = next;
            setValue(next);
            props.onValueChange(next, event.target.selectionStart ?? undefined);
          }}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          placeholder={props.placeholder}
        />
      );
    },
  };
});
vi.mock('@/components/ask/ProviderModelCapsule', () => ({
  default: () => null,
  getPersistedProviderModel: () => ({ provider: null, model: null }),
}));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => null,
  getPersistedPermissionMode: () => 'ask',
}));
vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: () => new Promise(() => {}),
}));

const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];

async function renderChatContent(props: Partial<React.ComponentProps<typeof ChatContent>> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mountedRoots.push({ root, host });
  flushSync(() => {
    root.render(<ChatContent visible variant="home" {...props} />);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { host, root };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFirstMessageFired.current = false;
  mockIsLoadingRef.current = false;
  mockAbortRef.current = null;
  localStorage.clear();
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: async () => ([]),
    body: new ReadableStream(),
  } as unknown as Response)));
});

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    flushSync(() => {
      root.unmount();
    });
    host.remove();
  }
  vi.unstubAllGlobals();
});

describe('ChatContent initialSessionId', () => {
  it('skips initSessions and refreshes metadata when initialSessionId is provided', async () => {
    await renderChatContent({ initialSessionId: 's1', maximized: true });

    expect(mockInitSessions).not.toHaveBeenCalled();
    expect(mockRefreshSessions).toHaveBeenCalledTimes(1);
  });

  it('still calls initSessions on open without initialSessionId', async () => {
    await renderChatContent();

    expect(mockInitSessions).toHaveBeenCalledTimes(1);
    expect(mockRefreshSessions).not.toHaveBeenCalled();
  });

  it('keeps the rest of the open path working with initialSessionId (initialMessage applied)', async () => {
    const { host } = await renderChatContent({ initialSessionId: 's1', initialMessage: 'hello from route' });

    const textarea = host.querySelector('textarea');
    expect(textarea?.value).toBe('hello from route');
  });

  it('consumes titlebar session activation when rendered as a visible side panel', async () => {
    await renderChatContent({ variant: 'panel' });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelSessionActivation('s1');
    });

    expect(consumed).toBe(true);
    expect(mockLoadSession).toHaveBeenCalledWith('s1');
  });

  it('consumes titlebar new-session activation when rendered as a visible side panel', async () => {
    await renderChatContent({ variant: 'panel' });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelNewSessionActivation();
    });

    expect(consumed).toBe(true);
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockStoreResetSession).not.toHaveBeenCalled();
  });

  it('consumes Project-scoped new-session activation without routing away from the Ask surface', async () => {
    await renderChatContent({ variant: 'panel' });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelNewSessionActivation({
        projectId: ' launch-practice ',
        title: ' Launch brief review ',
        source: 'studio-project',
      });
    });

    expect(consumed).toBe(true);
    expect(mockStoreResetSession).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'launch-practice',
      runtime: null,
    }));
    expect(mockStoreRenameSession).toHaveBeenCalledWith('fresh-project-session', 'Launch brief review');
    expect(mockResetSession).not.toHaveBeenCalled();
  });

  it('lets the Ask modal consume session activation too', async () => {
    await renderChatContent({ variant: 'modal' });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelSessionActivation('s1');
    });

    expect(consumed).toBe(true);
    expect(mockLoadSession).toHaveBeenCalledWith('s1');
  });

  it('does not consume titlebar session activation while panel mode is maximized', async () => {
    await renderChatContent({ variant: 'panel', maximized: true });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelSessionActivation('s1');
    });

    expect(consumed).toBe(false);
    expect(mockLoadSession).not.toHaveBeenCalled();
  });

  it('does not consume new-session activation while panel mode is maximized', async () => {
    await renderChatContent({ variant: 'panel', maximized: true });

    let consumed = false;
    flushSync(() => {
      consumed = requestAskPanelNewSessionActivation();
    });

    expect(consumed).toBe(false);
    expect(mockResetSession).not.toHaveBeenCalled();
    expect(mockStoreResetSession).not.toHaveBeenCalled();
  });
});
