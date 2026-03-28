// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AskContent from '@/components/ask/AskContent';

const mockSetMessages = vi.fn();
const mockPersistSession = vi.fn();
const mockClearPersistTimer = vi.fn();
const mockInitSessions = vi.fn();

vi.mock('@/lib/LocaleContext', () => ({
  useLocale: () => ({
    t: {
      ask: {
        title: 'MindOS Agent',
        placeholder: 'Ask a question...',
        send: 'send',
        newlineHint: 'new line',
        panelComposerResize: 'Resize input',
        panelComposerResetHint: 'Double click reset',
        panelComposerKeyboard: 'Arrow keys',
        attachFile: 'attach file',
        stopTitle: 'Stop',
        cancelReconnect: 'Cancel reconnect',
        connecting: 'connecting',
        thinking: 'thinking',
        generating: 'generating',
        stopped: 'stopped',
        errorNoResponse: 'no response',
        emptyPrompt: 'empty',
        suggestions: [],
      },
      search: { close: 'close' },
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [],
    activeSessionId: 's1',
    initSessions: mockInitSessions,
    persistSession: mockPersistSession,
    clearPersistTimer: mockClearPersistTimer,
    setMessages: mockSetMessages,
    resetSession: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
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

vi.mock('@/hooks/useComposerVerticalResize', () => ({
  useComposerVerticalResize: () => vi.fn(),
}));

vi.mock('@/components/ask/MessageList', () => ({
  default: () => <div data-testid="message-list" />,
}));
vi.mock('@/components/ask/MentionPopover', () => ({
  default: () => null,
}));
vi.mock('@/components/ask/SessionHistory', () => ({
  default: () => null,
}));
vi.mock('@/components/ask/FileChip', () => ({
  default: () => null,
}));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: () => new Promise(() => {}),
}));

describe('AskContent input behavior while running', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
    }));
  });

  it('keeps panel textarea enabled while request is in-flight', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="run a task" />);
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const textareaAfterSubmit = host.querySelector('textarea') as HTMLTextAreaElement;
    const stopButton = host.querySelector('button[title="Stop"]');
    expect(stopButton).toBeTruthy();
    expect(textareaAfterSubmit.disabled).toBe(false);
    expect(textareaAfterSubmit.value).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('clears textarea value after submit in modal variant', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="modal" initialMessage="hello world" onClose={() => {}} />);
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('hello world');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const textareaAfterSubmit = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textareaAfterSubmit.value).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
