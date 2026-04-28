// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AskContent from '@/components/ask/AskContent';

const mockInstalledAgents: Array<{ id: string; name: string; binaryPath: string }> = [];

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
      panels: { agents: { acpDefaultAgent: 'MindOS' } },
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [],
    activeSession: null,
    activeSessionId: 's1',
    initSessions: vi.fn(),
    persistSession: vi.fn(),
    clearPersistTimer: vi.fn(),
    setMessages: vi.fn(),
    setSessionDefaultAcpAgent: vi.fn(),
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
    installedAgents: mockInstalledAgents,
    notInstalledAgents: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAskChat', () => ({
  useAskChat: () => ({
    isLoading: false,
    isLoadingRef: { current: false },
    loadingPhase: 'connecting',
    reconnectAttempt: 0,
    reconnectMaxRef: { current: 3 },
    abortRef: { current: null },
    firstMessageFired: { current: false },
    submit: (e: Event) => e.preventDefault(),
    stop: vi.fn(),
  }),
}));

vi.mock('@/components/ask/MessageList', () => ({ default: () => <div /> }));
vi.mock('@/components/ask/MentionPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SlashCommandPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistory', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistoryPanel', () => ({ default: () => null }));
vi.mock('@/components/ask/AskHeader', () => ({ default: () => <div /> }));
vi.mock('@/components/ask/FileChip', () => ({ default: () => null }));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => <div data-testid="mode-capsule">mode</div>,
  getPersistedMode: () => 'agent',
}));
vi.mock('@/components/ask/ProviderModelCapsule', () => ({
  default: () => <div data-testid="provider-capsule">provider</div>,
  getPersistedProviderModel: () => ({ provider: null, model: null }),
}));
vi.mock('@/components/ask/AgentSelectorCapsule', () => ({
  default: ({ selectedAgent }: { selectedAgent: { id: string; name: string } | null }) => (
    <div data-testid="agent-selector">{selectedAgent?.name ?? 'MindOS'}</div>
  ),
}));
vi.mock('@/lib/utils', () => ({ cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ') }));

describe('AskContent agent selector capsule visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstalledAgents.length = 0;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps the agent selector capsule visible in panel mode even with no detected ACP agents', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="mode-capsule"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="provider-capsule"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="agent-selector"]')?.textContent).toBe('MindOS');

    await act(async () => {
      root.unmount();
    });
  });
});
