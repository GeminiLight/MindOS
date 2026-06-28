// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChatContent from '@/components/chat/ChatContent';

const mockInstalledAgents: Array<{ id: string; name: string; binaryPath: string }> = [];

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'zh' as const,
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
        concurrentLimit: 'too many conversations are running',
        emptyPrompt: 'empty',
        suggestions: [],
        copyMessage: 'Copy',
        sessionContext: {
          title: 'Context',
          workDir: 'WorkDir',
          spaces: 'Spaces',
          assistants: 'Assistants',
          mindRoot: 'Mind root',
          none: 'None',
          locked: 'Locked after first message',
          editWorkDir: 'Set work directory',
          workDirPlaceholder: '/path/to/project',
          addSpace: 'Add Space',
          addAssistant: 'Add Assistant',
          newSession: 'New',
          removeItem: (label: string) => `Remove ${label}`,
          spacePlaceholder: 'Space path',
          assistantPlaceholder: 'assistant-id',
          applyNextTurn: 'Changes apply to the next message.',
          spacesCount: (n: number) => `${n} space${n === 1 ? '' : 's'}`,
          assistantsCount: (n: number) => `${n} assistant${n === 1 ? '' : 's'}`,
        },
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
    setSessionWorkDir: vi.fn(() => true),
    setSessionContextSelection: vi.fn(() => true),
    setSessionModelSelection: vi.fn(() => true),
    resetSession: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    forkSession: vi.fn(),
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

vi.mock('@/hooks/useAgentChat', () => ({
  useAgentChat: () => ({
    isLoading: false,
    isLoadingRef: { current: false },
    loadingPhase: 'connecting',
    reconnectAttempt: 0,
    reconnectMaxRef: { current: 3 },
    abortRef: { current: null },
    firstMessageFired: { current: false },
    contextUsage: {
      runtime: 'mindos',
      phase: 'preflight',
      action: 'history_pruned',
      percent: 73,
      usedTokens: 36_000,
      contextWindow: 128_000,
      budgetTokens: 112_000,
      reserveTokens: 16_000,
      keepRecentTokens: 20_000,
      systemPromptTokens: 8_000,
      turnPromptTokens: 12_000,
      historyTokens: 16_000,
    },
    submit: (e: Event) => e.preventDefault(),
    stop: vi.fn(),
  }),
}));

vi.mock('@/components/ask/MessageList', () => ({ default: () => <div /> }));
vi.mock('@/components/ask/MentionPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SlashCommandPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistory', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistoryPanel', () => ({ default: () => null }));
vi.mock('@/components/ask/AskHeader', () => ({
  default: ({ selectedAgentRuntime }: { selectedAgentRuntime: { name: string } | null }) => (
    <div data-testid="runtime-switcher">{selectedAgentRuntime?.name ?? 'MindOS'}</div>
  ),
}));
vi.mock('@/components/ask/FileChip', () => ({ default: () => null }));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => <div data-testid="permission-capsule">permission</div>,
  getPersistedPermissionMode: () => 'ask',
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

describe('ChatContent runtime selector placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstalledAgents.length = 0;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('keeps runtime selection in the header and provider controls in the MindOS composer row', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ChatContent visible variant="panel" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="permission-capsule"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="provider-capsule"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label*="索引中 73%"]')).toBeTruthy();
    expect(host.textContent).toContain('上下文窗口: 128K tokens');
    expect(host.textContent).toContain('已占用: 36K · 可用: 92K');
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('MindOS');
    expect(host.querySelector('[data-testid="agent-selector"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
