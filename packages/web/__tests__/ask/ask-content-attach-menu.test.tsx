// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChatContent from '@/components/chat/ChatContent';

const mockUploadInputRef = { current: null as HTMLInputElement | null };
const mockImageInputRef = { current: null as HTMLInputElement | null };
const { mockSubmit } = vi.hoisted(() => ({
  mockSubmit: vi.fn((e: Event) => e.preventDefault()),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      ask: {
        placeholder: 'Ask a question...',
        send: 'Send',
        providerNotConfigured: 'Connect a model provider before sending.',
        configureProvider: 'Configure',
        newlineHint: 'New line',
        stopped: 'Stopped',
        errorNoResponse: 'No response',
        concurrentLimit: 'too many conversations are running',
        emptyPrompt: 'Empty',
        emptyHint: 'Hint',
        suggestions: [],
        connecting: 'Connecting',
        thinking: 'Thinking',
        generating: 'Generating',
        attachFileLabel: 'Document',
        attachImageLabel: 'Image',
        stopTitle: 'Stop',
        cancelReconnect: 'Cancel reconnect',
        copyMessage: 'Copy',
        modeChat: 'Chat',
        modeAgent: 'Agent',
        modeChatHint: 'Chat hint',
        modeAgentHint: 'Agent hint',
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
      hints: {
        attachFile: 'Attach local file',
      },
      fileImport: {
        unsupported: 'Unsupported file type',
      },
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
    uploadInputRef: mockUploadInputRef,
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
    imageInputRef: mockImageInputRef,
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
    installedAgents: [],
    loading: false,
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
    submit: mockSubmit,
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
vi.mock('@/components/ask/AgentSelectorCapsule', () => ({ default: () => null }));
vi.mock('@/components/ask/ProviderModelCapsule', () => ({
  default: () => null,
  getPersistedProviderModel: () => ({ provider: null, model: null }),
}));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => null,
  getPersistedPermissionMode: () => 'ask',
}));
vi.mock('@/lib/utils', () => ({ cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ') }));

describe('ChatContent attach menu', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ai: {
          activeProvider: 'p_openai01',
          providers: [
            { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-test', model: 'gpt-5.4', baseUrl: '' },
          ],
        },
        envOverrides: {},
        envValues: {},
      }),
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('keeps attach menu open on mousedown inside the portal and triggers file input click', async () => {
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => {
      root.render(<ChatContent visible variant="panel" />);
    });

    const attachButton = host.querySelector('button[title="Attach local file"]') as HTMLButtonElement;
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton.click();
    });

    const menuButton = Array.from(document.body.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === 'Document',
    ) as HTMLButtonElement | undefined;

    expect(menuButton).toBeTruthy();

    await act(async () => {
      menuButton!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(document.body.contains(menuButton!)).toBe(true);

    await act(async () => {
      menuButton!.click();
    });

    expect(inputClickSpy).toHaveBeenCalled();
    inputClickSpy.mockRestore();
  });

  it('blocks MindOS submit and opens AI settings when no model provider is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ai: { activeProvider: undefined, providers: [] },
        envOverrides: {},
        envValues: {},
      }),
    }));
    const settingsEvents: Array<{ tab?: string }> = [];
    const onOpenSettings = (event: Event) => {
      settingsEvents.push((event as CustomEvent).detail ?? {});
    };
    window.addEventListener('mindos:open-settings', onOpenSettings);

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="summarize my notes" />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const submitButton = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe('Connect a model provider before sending.');
    expect(host.textContent).toContain('Connect a model provider before sending.');

    await act(async () => {
      Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Configure')
        ?.click();
    });

    expect(settingsEvents).toEqual([{ tab: 'ai' }]);

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(mockSubmit).not.toHaveBeenCalled();

    window.removeEventListener('mindos:open-settings', onOpenSettings);
  });
});
