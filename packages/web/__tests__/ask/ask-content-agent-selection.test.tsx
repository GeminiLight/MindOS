// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AskContent from '@/components/ask/AskContent';
import type { ChatSession } from '@/lib/types';

const mockSetMessages = vi.fn();
const mockPersistSession = vi.fn();
const mockClearPersistTimer = vi.fn();
const mockInitSessions = vi.fn();
const mockSetSessionDefaultAcpAgent = vi.fn();

const sessionWithClaude: ChatSession = {
  id: 's1',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  defaultAcpAgent: { id: 'claude-code', name: 'Claude Code' },
};

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      ask: {
        title: 'MindOS',
        placeholder: 'Ask a question...',
        send: 'send',
        newlineHint: 'new line',
        panelComposerResize: 'Resize input',
        panelComposerResetHint: 'Double click reset',
        panelComposerKeyboard: 'Arrow keys',
        attachFile: 'attach file',
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
        emptyPrompt: 'empty',
        suggestions: [],
        copyMessage: 'Copy',
      },
      search: { close: 'close' },
      hints: {
        typeMessage: 'Type a message',
        mentionInProgress: 'Mention or command in progress',
        sessionHistory: 'Session history',
        newSession: 'New session',
        attachFile: 'Attach local file',
        maximizePanel: 'Maximize panel',
        restorePanel: 'Restore panel',
        dockToSide: 'Dock to side panel',
        openAsPopup: 'Open as popup',
        closePanel: 'Close',
      },
      fileImport: { unsupported: 'Unsupported file type' },
      panels: { agents: {} },
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [sessionWithClaude],
    activeSession: sessionWithClaude,
    activeSessionId: 's1',
    initSessions: mockInitSessions,
    persistSession: mockPersistSession,
    clearPersistTimer: mockClearPersistTimer,
    setMessages: mockSetMessages,
    setSessionDefaultAcpAgent: mockSetSessionDefaultAcpAgent,
    resetSession: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    togglePinSession: vi.fn(),
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

vi.mock('@/hooks/useAcpDetection', () => ({
  useAcpDetection: () => ({
    installedAgents: [{ id: 'claude-code', name: 'Claude Code', binaryPath: '/tmp/claude' }],
    notInstalledAgents: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/ask/MessageList', () => ({
  default: () => <div data-testid="message-list" />,
}));
vi.mock('@/components/ask/MentionPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SlashCommandPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistory', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistoryPanel', () => ({ default: () => null }));
vi.mock('@/components/ask/AskHeader', () => ({ default: () => <div /> }));
vi.mock('@/components/ask/FileChip', () => ({
  default: ({ path, variant }: { path: string; variant?: string }) => <div data-testid={`chip-${variant ?? 'kb'}`}>{path}</div>,
}));
vi.mock('@/components/ask/AgentSelectorCapsule', () => ({
  default: ({ selectedAgent, onSelect }: { selectedAgent: { id: string; name: string } | null; onSelect: (agent: { id: string; name: string } | null) => void }) => (
    <div>
      <div data-testid="agent-selector">{selectedAgent?.name ?? 'MindOS'}</div>
      <button type="button" onClick={() => onSelect({ id: 'claude-code', name: 'Claude Code' })}>Select Claude</button>
    </div>
  ),
}));
vi.mock('@/components/ask/ProviderModelCapsule', () => ({
  default: () => null,
  getPersistedProviderModel: () => ({ provider: null, model: null }),
}));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => null,
  getPersistedMode: () => 'agent',
}));
vi.mock('@/lib/utils', () => ({ cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ') }));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: () => new Promise(() => {}),
}));

describe('AskContent ACP session binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
    }));
  });

  it('restores the bound session agent when the panel opens', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="agent-selector"]')?.textContent).toBe('Claude Code');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the selected ACP agent with the agent chip variant', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="review this diff" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(host.querySelector('[data-testid="chip-agent"]')?.textContent).toBe('Claude Code');
    expect(host.querySelector('[data-testid="chip-skill"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('does not clear the selected agent after submit', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="review this diff" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    expect(host.querySelector('[data-testid="agent-selector"]')?.textContent).toBe('Claude Code');

    await act(async () => {
      root.unmount();
    });
  });
});
