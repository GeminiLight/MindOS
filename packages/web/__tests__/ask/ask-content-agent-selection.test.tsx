// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AskContent from '@/components/ask/AskContent';
import { LAST_AGENT_RUNTIME_STORAGE_KEY } from '@/lib/ask-runtime-preference';
import type { ChatSession } from '@/lib/types';

const mockSetMessages = vi.fn();
const mockPersistSession = vi.fn();
const mockClearPersistTimer = vi.fn();
const mockInitSessions = vi.fn();
const mockSetSessionDefaultAcpAgent = vi.fn();
const mockSetSessionAgentRuntimeBinding = vi.fn();
const mockAttachRuntimeSession = vi.fn(() => true);
const mockResetSession = vi.fn();
const mockLoadSession = vi.fn();
const mockDeleteSession = vi.fn();
const mockClearSessions = vi.fn();
const mockAskHeaderProps = vi.fn();
const mockSessionHistoryPanelProps = vi.fn();
let mockPersistedProviderModel: { provider: string | null; model: string | null } = { provider: null, model: null };
let mockRuntimeDescriptors: unknown[] = [];
let mockDetectionLoading = false;
let mockNativeRuntimeDescriptors: unknown[] = [];
let mockNativeLoadingByKind: Partial<Record<'codex' | 'claude', boolean>> = {};
let mockNativeErrorByKind: Partial<Record<'codex' | 'claude', string | null>> = {};

const sessionWithClaude: ChatSession = {
  id: 's1',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
  defaultAcpAgent: { id: 'claude-code', name: 'Claude Code' },
};
const emptySession: ChatSession = {
  id: 's-empty',
  createdAt: 1,
  updatedAt: 1,
  messages: [],
};
let mockSessions: ChatSession[] = [sessionWithClaude];
let mockActiveSession: ChatSession | null = sessionWithClaude;
let mockActiveSessionId: string | null = 's1';

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
        sessionRunningRetry: 'That session is still running. Try again after it finishes.',
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
    sessions: mockSessions,
    activeSession: mockActiveSession,
    activeSessionId: mockActiveSessionId,
    initSessions: mockInitSessions,
    persistSession: mockPersistSession,
    clearPersistTimer: mockClearPersistTimer,
    setMessages: mockSetMessages,
    setSessionDefaultAcpAgent: mockSetSessionDefaultAcpAgent,
    setSessionAgentRuntimeBinding: mockSetSessionAgentRuntimeBinding,
    attachRuntimeSession: mockAttachRuntimeSession,
    resetSession: mockResetSession,
    loadSession: mockLoadSession,
    deleteSession: mockDeleteSession,
    renameSession: vi.fn(),
    togglePinSession: vi.fn(),
    clearSessions: mockClearSessions,
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
    installedAgents: [
      { id: 'claude-code', name: 'Claude Code', binaryPath: '/tmp/claude' },
      { id: 'codex-acp', name: 'Codex', binaryPath: '/tmp/codex' },
    ],
    notInstalledAgents: [],
    runtimes: mockRuntimeDescriptors,
    loading: mockDetectionLoading,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useNativeRuntimeDetection', () => ({
  useNativeRuntimeDetection: () => ({
    runtimes: mockNativeRuntimeDescriptors,
    loadingByKind: mockNativeLoadingByKind,
    errorByKind: mockNativeErrorByKind,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/ask/MessageList', () => ({
  default: () => <div data-testid="message-list" />,
}));
vi.mock('@/components/ask/MentionPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SlashCommandPopover', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistory', () => ({ default: () => null }));
vi.mock('@/components/ask/SessionHistoryPanel', () => ({
  default: (props: {
    sessions?: ChatSession[];
    activeSessionId?: string | null;
    onLoad?: (id: string) => void;
    onClose?: () => void;
    onNewChat?: () => void;
    onDelete?: (id: string) => void;
    codexThreads?: Array<{ id: string; name?: string; preview?: string; cwd?: string; updatedAt?: number }>;
    codexThreadsLoading?: boolean;
    codexThreadsError?: string | null;
    onAttachCodexThread?: (thread: { id: string; name?: string; preview?: string; cwd?: string; updatedAt?: number }) => void;
    onForkCodexThread?: (thread: { id: string; name?: string; preview?: string; cwd?: string; updatedAt?: number }) => void;
    onArchiveCodexThread?: (thread: { id: string; name?: string; preview?: string; cwd?: string; updatedAt?: number }) => void;
  }) => {
    mockSessionHistoryPanelProps(props);
    return (
      <div data-testid="history-session-list">
        {props.sessions?.map((session) => <span key={session.id}>{session.title ?? session.id}</span>)}
        {props.codexThreadsLoading && <span>Loading Codex threads...</span>}
        {props.codexThreadsError && <span>{props.codexThreadsError}</span>}
        {props.codexThreads?.map((thread) => <span key={thread.id}>{thread.name ?? thread.id}</span>)}
        {props.sessions?.map((session) => (
          <button key={`load-${session.id}`} type="button" onClick={() => props.onLoad?.(session.id)}>
            Load {session.title ?? session.id}
          </button>
        ))}
        {props.codexThreads?.map((thread) => (
          <button key={`attach-${thread.id}`} type="button" onClick={() => props.onAttachCodexThread?.(thread)}>
            Attach {thread.name ?? thread.id}
          </button>
        ))}
        {props.codexThreads?.map((thread) => (
          <button key={`fork-${thread.id}`} type="button" onClick={() => props.onForkCodexThread?.(thread)}>
            Fork {thread.name ?? thread.id}
          </button>
        ))}
        {props.codexThreads?.map((thread) => (
          <button key={`archive-${thread.id}`} type="button" onClick={() => props.onArchiveCodexThread?.(thread)}>
            Archive {thread.name ?? thread.id}
          </button>
        ))}
        <button type="button" onClick={() => props.onNewChat?.()}>History New Chat</button>
        {props.sessions?.map((session) => (
          <button key={`delete-${session.id}`} type="button" onClick={() => props.onDelete?.(session.id)}>
            Delete {session.id}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock('@/components/ask/AskHeader', () => ({
  default: ({
    sessions,
    activeSessionId,
    onToggleHistory,
    onReset,
    onDeleteSession,
    selectedAgentRuntime,
    onSelectAgentRuntime,
    nativeRuntimes,
    agentLoading,
    agentLoadingByKind,
  }: {
    sessions?: ChatSession[];
    activeSessionId?: string | null;
    onToggleHistory?: () => void;
    onReset?: () => void;
    onDeleteSession?: (id: string) => void;
    selectedAgentRuntime: { id: string; name: string; kind: 'acp' | 'codex' | 'claude'; binaryPath?: string } | null;
    onSelectAgentRuntime: (agent: { id: string; name: string; kind: 'acp' | 'codex' | 'claude'; binaryPath?: string } | null) => void;
    nativeRuntimes?: unknown[];
    agentLoading?: boolean;
    agentLoadingByKind?: Partial<Record<'codex' | 'claude', boolean>>;
  }) => (
    (() => {
      const codexRuntime = nativeRuntimes?.find((runtime): runtime is { id: string; name: string; kind: 'codex'; binaryPath?: string } => (
        !!runtime
        && typeof runtime === 'object'
        && (runtime as { kind?: unknown }).kind === 'codex'
        && typeof (runtime as { id?: unknown }).id === 'string'
        && typeof (runtime as { name?: unknown }).name === 'string'
      ));
      mockAskHeaderProps({ sessions, activeSessionId, selectedAgentRuntime, nativeRuntimes, agentLoading, agentLoadingByKind });
      return (
        <div>
          <div data-testid="runtime-switcher">{selectedAgentRuntime?.name ?? 'MindOS'}</div>
          <div data-testid="header-session-list">
            {sessions?.map((session) => <span key={session.id}>{session.title ?? session.id}</span>)}
          </div>
          <div data-testid="header-active-session">{activeSessionId ?? 'none'}</div>
          <button type="button" onClick={() => onToggleHistory?.()}>Toggle History</button>
          <button type="button" onClick={() => onReset?.()}>Header New Chat</button>
          <button type="button" onClick={() => onDeleteSession?.(activeSessionId ?? 'missing')}>Header Delete Active</button>
          <button type="button" onClick={() => onSelectAgentRuntime(null)}>Select MindOS</button>
          <button type="button" onClick={() => onSelectAgentRuntime({ id: 'claude-code', name: 'Claude Code', kind: 'acp' })}>Select Claude</button>
          <button type="button" onClick={() => onSelectAgentRuntime({ id: 'claude', name: 'Claude Code', kind: 'claude' })}>Select Claude Native</button>
          <button type="button" onClick={() => onSelectAgentRuntime(codexRuntime ?? { id: 'codex', name: 'Codex', kind: 'codex' })}>Select Codex</button>
        </div>
      );
    })()
  ),
}));
vi.mock('@/components/ask/FileChip', () => ({
  default: ({ path, variant }: { path: string; variant?: string }) => <div data-testid={`chip-${variant ?? 'kb'}`}>{path}</div>,
}));
vi.mock('@/components/ask/AgentSelectorCapsule', () => ({
  default: ({ selectedAgent, onSelect }: { selectedAgent: { id: string; name: string; kind: 'acp' | 'codex' | 'claude' } | null; onSelect: (agent: { id: string; name: string; kind: 'acp' | 'codex' | 'claude' } | null) => void }) => (
    <div>
      <div data-testid="agent-selector">{selectedAgent?.name ?? 'MindOS'}</div>
      <button type="button" onClick={() => onSelect({ id: 'claude-code', name: 'Claude Code', kind: 'acp' })}>Select Claude</button>
      <button type="button" onClick={() => onSelect({ id: 'claude', name: 'Claude Code', kind: 'claude' })}>Select Claude Native</button>
      <button type="button" onClick={() => onSelect({ id: 'codex', name: 'Codex', kind: 'codex' })}>Select Codex</button>
    </div>
  ),
}));
vi.mock('@/components/ask/ProviderModelCapsule', () => ({
  default: () => null,
  getPersistedProviderModel: () => mockPersistedProviderModel,
}));
vi.mock('@/components/ask/ModeCapsule', () => ({
  default: () => null,
  getPersistedMode: () => 'agent',
}));
vi.mock('@/lib/utils', () => ({ cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ') }));
vi.mock('@/lib/agent/reconnect', () => ({
  isRetryableError: () => false,
  retryDelay: () => 0,
  sleep: () => Promise.resolve(),
}));

vi.mock('@/lib/agent/stream-consumer', () => ({
  consumeUIMessageStream: () => new Promise(() => {}),
}));

describe('AskContent ACP session binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPersistedProviderModel = { provider: null, model: null };
    mockRuntimeDescriptors = [];
    mockDetectionLoading = false;
    mockNativeRuntimeDescriptors = [];
    mockNativeLoadingByKind = {};
    mockNativeErrorByKind = {};
    mockSessions = [sessionWithClaude];
    mockActiveSession = sessionWithClaude;
    mockActiveSessionId = 's1';
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn(() => {
      return Promise.resolve({
        ok: true,
        body: new ReadableStream(),
      });
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

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');

    await act(async () => {
      root.unmount();
    });
  });

  it('scopes the header switcher and history panel to the selected native runtime lane', async () => {
    const mindosSession: ChatSession = {
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    };
    const codexSession: ChatSession = {
      id: 's-codex',
      title: 'Codex repo thread',
      createdAt: 2,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'fix code' }],
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thread_123',
        status: 'active',
        updatedAt: 2,
      },
    };
    const claudeSession: ChatSession = {
      id: 's-claude',
      title: 'Claude review',
      createdAt: 3,
      updatedAt: 3,
      messages: [{ role: 'user', content: 'review' }],
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
    };
    mockSessions = [mindosSession, codexSession, claudeSession];
    mockActiveSession = mindosSession;
    mockActiveSessionId = mindosSession.id;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).toContain('MindOS planning');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).not.toContain('Codex repo thread');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).not.toContain('Claude review');

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(mockLoadSession).toHaveBeenCalledWith('s-codex');
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).toContain('Codex repo thread');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).not.toContain('MindOS planning');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).not.toContain('Claude review');
    expect(host.querySelector('[data-testid="header-active-session"]')?.textContent).toBe('none');

    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });

    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).toContain('Codex repo thread');
    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).not.toContain('MindOS planning');
    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).not.toContain('Claude review');
    expect(mockSessionHistoryPanelProps).toHaveBeenLastCalledWith(expect.objectContaining({
      sessions: [codexSession],
      activeSessionId: null,
    }));

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the selected Codex runtime when the header new-chat button is clicked immediately after runtime selection', async () => {
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    const selectCodex = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodex.click();
    });

    const newChat = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Header New Chat') as HTMLButtonElement;
    await act(async () => {
      newChat.click();
    });

    expect(mockResetSession).toHaveBeenLastCalledWith({ id: 'codex', name: 'Codex', kind: 'codex' });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the selected Claude Code runtime when history panel New Chat is clicked', async () => {
    const claudeSession: ChatSession = {
      id: 's-claude',
      title: 'Claude review',
      createdAt: 2,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'review' }],
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
    };
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }, claudeSession];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    const selectClaudeNative = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude Native') as HTMLButtonElement;
    await act(async () => {
      selectClaudeNative.click();
    });

    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });

    const historyNewChat = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'History New Chat') as HTMLButtonElement;
    await act(async () => {
      historyNewChat.click();
    });

    expect(mockResetSession).toHaveBeenLastCalledWith({ id: 'claude', name: 'Claude Code', kind: 'claude' });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');

    await act(async () => {
      root.unmount();
    });
  });

  it('creates the replacement empty session in the active native runtime when deleting the active session', async () => {
    const codexSession: ChatSession = {
      id: 's-codex',
      title: 'Codex repo thread',
      createdAt: 2,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'fix code' }],
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
    };
    mockSessions = [codexSession];
    mockActiveSession = codexSession;
    mockActiveSessionId = 's-codex';

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    const deleteActive = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Header Delete Active') as HTMLButtonElement;
    await act(async () => {
      deleteActive.click();
    });

    expect(mockDeleteSession).toHaveBeenCalledWith('s-codex', { id: 'codex', name: 'Codex', kind: 'codex' });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps selected runtime in the header instead of rendering a composer agent chip', async () => {
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

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');
    expect(host.querySelector('[data-testid="chip-agent"]')).toBeNull();
    expect(host.querySelector('[data-testid="chip-skill"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('does not clear the selected agent after submit and sends its runtime identity', async () => {
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

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.selectedAcpAgent).toEqual({ id: 'claude-code', name: 'Claude Code' });
    expect(requestBody.selectedRuntime).toEqual({ id: 'claude-code', name: 'Claude Code', kind: 'acp' });

    await act(async () => {
      root.unmount();
    });
  });

  it('can switch an opener-selected ACP runtime back to MindOS before submit', async () => {
    mockPersistedProviderModel = { provider: 'openai', model: 'gpt-test' };
    mockActiveSession = {
      id: 's-acp-empty',
      title: 'ACP opener',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAcpAgent: { id: 'claude-code', name: 'Claude Code' },
    };
    mockSessions = [mockActiveSession];
    mockActiveSessionId = mockActiveSession.id;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AskContent
          visible
          variant="panel"
          initialMessage="answer with mindos"
          initialAcpAgent={{ id: 'claude-code', name: 'Claude Code' }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');

    const selectMindos = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select MindOS') as HTMLButtonElement;
    await act(async () => {
      selectMindos.click();
    });

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('MindOS');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.selectedAcpAgent).toBeNull();
    expect(requestBody.selectedRuntime).toBeNull();
    expect(requestBody.providerOverride).toBe('openai');
    expect(requestBody.modelOverride).toBe('gpt-test');
    expect(mockSetSessionDefaultAcpAgent).toHaveBeenLastCalledWith(null);

    await act(async () => {
      root.unmount();
    });
  });

  it('sends a native Codex runtime selection without legacy ACP routing', async () => {
    mockPersistedProviderModel = { provider: 'openai', model: 'gpt-test' };
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
      status: 'available',
      capabilities: {},
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="summarize this repo" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
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

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.selectedAcpAgent).toBeNull();
    expect(requestBody.selectedRuntime).toEqual({ id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' });
    expect(requestBody).not.toHaveProperty('providerOverride');
    expect(requestBody).not.toHaveProperty('modelOverride');
    expect(mockSetSessionAgentRuntimeBinding).toHaveBeenCalledWith({ id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' });

    await act(async () => {
      root.unmount();
    });
  });

  it('preselects a native runtime from an opener and submits it without legacy ACP routing', async () => {
    mockActiveSession = emptySession;
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
      status: 'available',
      capabilities: {},
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AskContent
          visible
          variant="panel"
          initialMessage="continue with codex"
          initialAgentRuntime={{ id: 'codex', name: 'Codex', kind: 'codex' }}
        />,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');
    expect(mockSetSessionAgentRuntimeBinding).toHaveBeenCalledWith({ id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.selectedAcpAgent).toBeNull();
    expect(requestBody.selectedRuntime).toEqual({ id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' });

    await act(async () => {
      root.unmount();
    });
  });

  it('uses the last selected runtime when opened without an explicit runtime', async () => {
    mockSessions = [];
    mockActiveSession = null;
    mockActiveSessionId = null;
    localStorage.setItem(LAST_AGENT_RUNTIME_STORAGE_KEY, JSON.stringify({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    }));
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
      status: 'available',
      capabilities: {},
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockInitSessions).toHaveBeenCalledWith({
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
    });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('sends a native Claude Code runtime selection without legacy ACP routing', async () => {
    mockPersistedProviderModel = { provider: 'anthropic', model: 'claude-test' };
    mockNativeRuntimeDescriptors = [{
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      status: 'available',
      capabilities: {},
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="review this diff" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude Native') as HTMLButtonElement;
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

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.selectedAcpAgent).toBeNull();
    expect(requestBody.selectedRuntime).toEqual({ id: 'claude', name: 'Claude Code', kind: 'claude' });
    expect(requestBody).not.toHaveProperty('providerOverride');
    expect(requestBody).not.toHaveProperty('modelOverride');
    expect(mockSetSessionAgentRuntimeBinding).toHaveBeenCalledWith({ id: 'claude', name: 'Claude Code', kind: 'claude' });

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps failed native runtime bindings visible but does not submit them as resumable runtime ids', async () => {
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      binaryPath: '/usr/local/bin/codex',
      status: 'available',
      capabilities: {},
    }];
    mockActiveSession = {
      id: 's-codex-failed',
      title: 'Codex failed thread',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      defaultAgentRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeSessionBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thread_failed',
        cwd: '/tmp/mind',
        status: 'failed',
        updatedAt: 2,
      },
    };
    mockSessions = [mockActiveSession];
    mockActiveSessionId = mockActiveSession.id;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="continue safely" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const askCall = fetchMock.mock.calls.find(([url]) => url === '/api/ask');
    expect(askCall).toBeTruthy();
    const requestBody = JSON.parse(String((askCall?.[1] as RequestInit | undefined)?.body));
    expect(requestBody.runtimeBinding).toMatchObject({
      kind: 'codex-thread',
      runtime: 'codex',
      runtimeId: 'codex',
      externalSessionId: 'thread_failed',
      status: 'failed',
    });
    expect(requestBody.selectedRuntime).toEqual({ id: 'codex', name: 'Codex', kind: 'codex', binaryPath: '/usr/local/bin/codex' });

    await act(async () => {
      root.unmount();
    });
  });

  it('shows only Claude Code sessions in the runtime history', async () => {
    const mindosSession: ChatSession = {
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    };
    const linkedClaudeSession: ChatSession = {
      id: 's-claude-linked',
      title: 'Linked Claude review',
      createdAt: 2,
      updatedAt: 2,
      messages: [{ role: 'user', content: 'review' }],
      defaultAgentRuntime: { id: 'claude', name: 'Claude Code', kind: 'claude' },
      runtimeSessionBinding: {
        kind: 'claude-session',
        runtime: 'claude',
        runtimeId: 'claude',
        externalSessionId: 'claude-session-1',
        status: 'active',
        updatedAt: 2,
      },
    };
    mockSessions = [mindosSession, linkedClaudeSession];
    mockActiveSession = mindosSession;
    mockActiveSessionId = mindosSession.id;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude Native') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(mockLoadSession).toHaveBeenCalledWith('s-claude-linked');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).toContain('Linked Claude review');
    expect(host.querySelector('[data-testid="header-session-list"]')?.textContent).not.toContain('MindOS planning');

    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });

    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).toContain('Linked Claude review');
    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).not.toContain('MindOS planning');
    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/agent-runtimes/claude/sessions', expect.anything());

    await act(async () => {
      root.unmount();
    });
  });

  it('loads Codex local threads in runtime history and attaches without starting a turn', async () => {
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'available',
      capabilities: {},
    }];
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';
    const codexThread = {
      id: 'thread_existing',
      name: 'Runtime fix thread',
      preview: 'Continue native runtime work',
      cwd: '/tmp/repo',
      updatedAt: 123,
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/api/agent-runtimes/codex/threads?')) {
        return {
          ok: true,
          json: async () => ({ data: [codexThread], nextCursor: null, backwardsCursor: null }),
        };
      }
      return {
        ok: true,
        body: new ReadableStream(),
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });

    const selectCodex = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodex.click();
    });

    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/agent-runtimes/codex/threads?'))).toBe(true);
    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent).toContain('Runtime fix thread');

    const attach = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Attach Runtime fix thread') as HTMLButtonElement;
    await act(async () => {
      attach.click();
    });

    expect(mockAttachRuntimeSession).toHaveBeenCalledWith(
      { id: 'codex', name: 'Codex', kind: 'codex' },
      {
        externalSessionId: 'thread_existing',
        cwd: '/tmp/repo',
        status: 'active',
        updatedAt: 123,
      },
      { title: 'Runtime fix thread' },
    );
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ask')).toBe(false);
    expect(host.querySelector('[data-testid="history-session-list"]')).toBeNull();
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('forks a Codex local thread and attaches the returned thread without starting a turn', async () => {
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'available',
      capabilities: {},
    }];
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';
    const codexThread = {
      id: 'thread_existing',
      name: 'Runtime fix thread',
      cwd: '/tmp/repo',
      updatedAt: 123,
    };
    const forkedThread = {
      id: 'thread_forked',
      name: 'Forked runtime fix',
      cwd: '/tmp/repo',
      updatedAt: 456,
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/api/agent-runtimes/codex/threads?')) {
        return {
          ok: true,
          json: async () => ({ data: [codexThread], nextCursor: null, backwardsCursor: null }),
        };
      }
      if (String(url) === '/api/agent-runtimes/codex/threads/thread_existing/fork') {
        return {
          ok: true,
          json: async () => ({ thread: forkedThread }),
        };
      }
      return {
        ok: true,
        body: new ReadableStream(),
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });
    const selectCodex = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodex.click();
    });
    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const fork = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Fork Runtime fix thread') as HTMLButtonElement;
    await act(async () => {
      fork.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/agent-runtimes/codex/threads/thread_existing/fork')).toBe(true);
    expect(mockAttachRuntimeSession).toHaveBeenCalledWith(
      { id: 'codex', name: 'Codex', kind: 'codex' },
      {
        externalSessionId: 'thread_forked',
        cwd: '/tmp/repo',
        status: 'active',
        updatedAt: 456,
      },
      { title: 'Forked runtime fix' },
    );
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ask')).toBe(false);
    expect(host.querySelector('[data-testid="history-session-list"]')).toBeNull();
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows a concise composer status and blocks sending while the selected native runtime is still being checked', async () => {
    mockDetectionLoading = true;
    mockNativeLoadingByKind = { codex: true, claude: false };
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="summarize this repo" />);
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');
    expect(mockAskHeaderProps).toHaveBeenLastCalledWith(expect.objectContaining({
      agentLoading: false,
      agentLoadingByKind: { codex: true, claude: false },
    }));
    expect(host.textContent).toContain('Checking Codex status...');
    expect(host.textContent).not.toContain('Local runtime cold starts can take up to 20 seconds.');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/ask', expect.anything());

    await act(async () => {
      root.unmount();
    });
  });

  it('blocks sending when the selected runtime is unavailable', async () => {
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'signed-out',
      capabilities: {},
      availability: {
        checkedAt: '2026-06-09T00:00:00.000Z',
        sources: ['native-health'],
        reason: 'Run codex login first.',
      },
    }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="summarize this repo" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(host.textContent).toContain('Codex is signed out. Run codex login first.');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/ask', expect.anything());

    await act(async () => {
      root.unmount();
    });
  });

  it('blocks sending when native runtime cache was available but background revalidation failed', async () => {
    mockNativeRuntimeDescriptors = [{
      id: 'claude',
      name: 'Claude Code',
      kind: 'claude',
      status: 'available',
      capabilities: {},
    }];
    mockNativeLoadingByKind = { claude: false };
    mockNativeErrorByKind = { claude: 'Detection failed' };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="summarize this repo" />);
    });

    const selectButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Claude Native') as HTMLButtonElement;
    await act(async () => {
      selectButton.click();
    });

    expect(host.textContent).toContain('Claude Code is unavailable. Detection failed');

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    expect(globalThis.fetch).not.toHaveBeenCalledWith('/api/ask', expect.anything());

    await act(async () => {
      root.unmount();
    });
  });

  it('refuses a runtime switch while the active session is running, then allows it on a run-less session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    // Submit in s1 — the mocked stream never resolves, so s1 keeps a live run.
    await act(async () => {
      root.render(<AskContent visible variant="panel" initialMessage="long running task" />);
    });
    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ask')).toBe(true);

    // Switching runtime while the *active* session runs is refused.
    const selectCodex = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodex.click();
    });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Claude Code');

    // Activate a session without a run — the same switch now goes through.
    mockSessions = [sessionWithClaude, emptySession];
    mockActiveSession = emptySession;
    mockActiveSessionId = emptySession.id;
    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });
    const selectCodexAgain = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodexAgain.click();
    });
    expect(host.querySelector('[data-testid="runtime-switcher"]')?.textContent).toBe('Codex');

    await act(async () => {
      root.unmount();
    });
  });

  it('surfaces the running-session message when attaching a Codex thread is refused', async () => {
    mockAttachRuntimeSession.mockReturnValueOnce(false);
    mockNativeRuntimeDescriptors = [{
      id: 'codex',
      name: 'Codex',
      kind: 'codex',
      status: 'available',
      capabilities: {},
    }];
    mockSessions = [{
      id: 's-mindos',
      title: 'MindOS planning',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ role: 'user', content: 'plan' }],
    }];
    mockActiveSession = mockSessions[0];
    mockActiveSessionId = 's-mindos';
    const codexThread = { id: 'thread_busy', name: 'Busy thread', cwd: '/tmp/repo', updatedAt: 123 };
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/api/agent-runtimes/codex/threads?')) {
        return { ok: true, json: async () => ({ data: [codexThread], nextCursor: null, backwardsCursor: null }) };
      }
      return { ok: true, body: new ReadableStream(), json: async () => ({}) };
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AskContent visible variant="panel" />);
    });
    const selectCodex = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Select Codex') as HTMLButtonElement;
    await act(async () => {
      selectCodex.click();
    });
    const toggleHistoryButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Toggle History') as HTMLButtonElement;
    await act(async () => {
      toggleHistoryButton.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const attach = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Attach Busy thread') as HTMLButtonElement;
    await act(async () => {
      attach.click();
    });

    // Refusal keeps the panel open and shows the retry hint instead of switching.
    expect(host.querySelector('[data-testid="history-session-list"]')?.textContent)
      .toContain('That session is still running. Try again after it finishes.');

    await act(async () => {
      root.unmount();
    });
  });
});
