// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChatContent from '@/components/chat/ChatContent';

const streamMockState = vi.hoisted(() => ({
  resolvers: [] as Array<(message: { role: 'assistant'; content: string; timestamp: number }) => void>,
}));

const mockSetMessages = vi.fn();
const mockPersistSession = vi.fn();
const mockClearPersistTimer = vi.fn();
const mockInitSessions = vi.fn();
let mockLocalAttachments: Array<{ name: string; content: string; status?: 'loading' | 'success' | 'error' }> = [];
let mockUploadError = '';

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
        uploadsProcessing: 'Wait for uploaded files to finish processing before sending.',
        queueFollowUpTitle: 'Queue follow-up',
        queuedFollowUpState: 'Queued',
        followUpPlaceholder: 'Ask for follow-up changes',
        queuedFollowUpTextOnly: 'Finish the current run before sending files, images, or skills.',
        dragQueuedFollowUp: 'Drag to reorder',
        editQueuedFollowUp: 'Edit queued follow-up',
        saveQueuedFollowUp: 'Save queued follow-up',
        cancelQueuedFollowUp: 'Cancel editing queued follow-up',
        removeQueuedFollowUp: 'Remove queued follow-up',
        stopTitle: 'Stop',
        cancelReconnect: 'Cancel reconnect',
        connecting: 'connecting',
        thinking: 'thinking',
        generating: 'generating',
        reconnecting: (attempt: number, max: number) => `reconnecting ${attempt}/${max}`,
        runThinking: (runtime: string) => `${runtime} is thinking with you`,
        elapsedSeconds: (seconds: number) => `${seconds}s`,
        stopped: 'stopped',
        errorNoResponse: 'no response',
        concurrentLimit: 'too many conversations are running',
        emptyPrompt: 'empty',
        suggestions: [],
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
    },
  }),
}));

vi.mock('@/hooks/useAskSession', () => ({
  useAskSession: () => ({
    messages: [],
    sessions: [],
    activeSession: null,
    activeSessionId: 's1',
    initSessions: mockInitSessions,
    persistSession: mockPersistSession,
    clearPersistTimer: mockClearPersistTimer,
    setMessages: mockSetMessages,
    setSessionDefaultAcpAgent: vi.fn(),
    setSessionWorkDir: vi.fn(() => true),
    setSessionContextSelection: vi.fn(() => true),
    setSessionModelSelection: vi.fn(() => true),
    resetSession: vi.fn(),
    loadSession: vi.fn(),
    deleteSession: vi.fn(),
    forkSession: vi.fn(),
    clearAllSessions: vi.fn(),
  }),
}));

vi.mock('@/hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    localAttachments: mockLocalAttachments,
    uploadError: mockUploadError,
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
    notInstalledAgents: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
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
  consumeUIMessageStream: vi.fn(() => new Promise((resolve) => {
    streamMockState.resolvers.push(resolve);
  })),
}));

function isAgentTurnUrl(url: RequestInfo | URL): boolean {
  const href = typeof url === 'string' ? url : url.toString();
  return /^\/api\/agent\/sessions\/[^/]+\/turns$/.test(href);
}

function agentTurnCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => isAgentTurnUrl(url as RequestInfo | URL));
}

async function requestSubmit(form: HTMLFormElement) {
  await act(async () => {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  });
}

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function setTextInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitForAgentTurnCallCount(fetchMock: ReturnType<typeof vi.fn>, expected: number) {
  for (let i = 0; i < 20; i += 1) {
    if (agentTurnCalls(fetchMock).length >= expected) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function resolveNextStream(content: string) {
  const resolve = streamMockState.resolvers.shift();
  expect(resolve).toBeTruthy();
  await act(async () => {
    resolve?.({ role: 'assistant', content, timestamp: Date.now() });
  });
}

function queuedFollowUpRows(host: HTMLElement): HTMLDivElement[] {
  return Array.from(host.querySelectorAll('[data-follow-up-item]')) as HTMLDivElement[];
}

function queuedFollowUpRowByText(host: HTMLElement, text: string): HTMLDivElement {
  const row = queuedFollowUpRows(host).find((item) => item.textContent?.includes(text));
  expect(row).toBeTruthy();
  return row as HTMLDivElement;
}

describe('ChatContent input behavior while running', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamMockState.resolvers = [];
    mockLocalAttachments = [];
    mockUploadError = '';
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
      root.render(<ChatContent visible variant="panel" initialMessage="run a task" />);
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);

    const textareaAfterSubmit = host.querySelector('textarea') as HTMLTextAreaElement;
    const stopButton = host.querySelector('button[title="Stop"]');
    expect(stopButton).toBeTruthy();
    expect(stopButton?.className).toContain('h-8');
    expect(stopButton?.className).toContain('w-8');
    expect(stopButton?.className).not.toContain('--hit-target-border');
    expect(textareaAfterSubmit.disabled).toBe(false);
    expect(textareaAfterSubmit.value).toBe('');

    await setTextareaValue(textareaAfterSubmit, 'follow up');
    const runningSubmitButton = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(runningSubmitButton.className).toContain('h-8');
    expect(runningSubmitButton.className).toContain('w-8');

    await act(async () => {
      root.unmount();
    });
  });

  it('blocks submit while uploaded files are still processing', async () => {
    mockLocalAttachments = [{ name: 'appendix.pdf', content: '', status: 'loading' }];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="read the appendix" />);
    });

    const submitButton = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(submitButton.title).toBe('Wait for uploaded files to finish processing before sending.');
    expect(host.textContent).not.toContain('Wait for uploaded files to finish processing before sending.');

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);

    expect(agentTurnCalls(fetchMock)).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('clears textarea value after submit in modal variant', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ChatContent visible variant="modal" initialMessage="hello world" onClose={() => {}} />);
    });

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('hello world');

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);

    const textareaAfterSubmit = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textareaAfterSubmit.value).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('queues follow-up text while a run is active without sending a concurrent turn', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="run a task" />);
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);
    expect(agentTurnCalls(fetchMock)).toHaveLength(1);

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await setTextareaValue(textarea, 'second');
    await requestSubmit(form);

    expect(agentTurnCalls(fetchMock)).toHaveLength(1);
    expect(host.textContent).toContain('second');
    expect(host.textContent).toContain('Queued');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(host.querySelector('button[title="Stop"]')).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
  });

  it('removes a queued follow-up before it runs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="run a task" />);
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);
    await setTextareaValue(host.querySelector('textarea') as HTMLTextAreaElement, 'remove me');
    await requestSubmit(form);

    expect(host.textContent).toContain('remove me');

    const removeButton = host.querySelector('button[title="Remove queued follow-up"]') as HTMLButtonElement;
    await act(async () => {
      removeButton.click();
    });

    expect(host.textContent).not.toContain('remove me');

    await act(async () => {
      root.unmount();
    });
  });

  it('edits a queued follow-up in place before it runs', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="first" />);
    });

    const form = host.querySelector('form') as HTMLFormElement;
    await requestSubmit(form);
    await setTextareaValue(host.querySelector('textarea') as HTMLTextAreaElement, 'before edit');
    await requestSubmit(form);

    const editButton = host.querySelector('button[title="Edit queued follow-up"]') as HTMLButtonElement;
    await act(async () => {
      editButton.click();
    });

    const editInput = host.querySelector('input[aria-label="Edit queued follow-up"]') as HTMLInputElement;
    expect(editInput.value).toBe('before edit');
    await setTextInputValue(editInput, 'after edit');

    const saveButton = host.querySelector('button[title="Save queued follow-up"]') as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });

    expect(host.textContent).not.toContain('before edit');
    expect(host.textContent).toContain('after edit');

    await resolveNextStream('first done');
    await waitForAgentTurnCallCount(fetchMock, 2);
    const editedBody = JSON.parse(String(agentTurnCalls(fetchMock)[1][1]?.body));
    const editedLastUser = editedBody.messages.filter((message: { role: string }) => message.role === 'user').at(-1);
    expect(editedLastUser.content).toBe('after edit');

    await act(async () => {
      root.unmount();
    });
  });

  it('reorders queued follow-ups by drag before they run', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="first" />);
    });

    const form = host.querySelector('form') as HTMLFormElement;
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await requestSubmit(form);
    await setTextareaValue(textarea, 'second');
    await requestSubmit(form);
    await setTextareaValue(textarea, 'third');
    await requestSubmit(form);

    const secondRow = queuedFollowUpRowByText(host, 'second');
    const thirdRow = queuedFollowUpRowByText(host, 'third');
    const dataTransfer = new DataTransfer();

    await act(async () => {
      thirdRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      secondRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientY: 0, dataTransfer }));
      secondRow.dispatchEvent(new DragEvent('drop', { bubbles: true, clientY: 0, dataTransfer }));
    });

    const rowsAfterDrop = queuedFollowUpRows(host);
    expect(rowsAfterDrop[0].textContent).toContain('third');
    expect(rowsAfterDrop[1].textContent).toContain('second');

    await resolveNextStream('first done');
    await waitForAgentTurnCallCount(fetchMock, 2);
    const reorderedBody = JSON.parse(String(agentTurnCalls(fetchMock)[1][1]?.body));
    const reorderedLastUser = reorderedBody.messages.filter((message: { role: string }) => message.role === 'user').at(-1);
    expect(reorderedLastUser.content).toBe('third');

    await resolveNextStream('third done');
    await waitForAgentTurnCallCount(fetchMock, 3);
    const remainingBody = JSON.parse(String(agentTurnCalls(fetchMock)[2][1]?.body));
    const remainingLastUser = remainingBody.messages.filter((message: { role: string }) => message.role === 'user').at(-1);
    expect(remainingLastUser.content).toBe('second');

    await act(async () => {
      root.unmount();
    });
  });

  it('runs queued follow-ups in FIFO order after each active turn finishes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;

    await act(async () => {
      root.render(<ChatContent visible variant="panel" initialMessage="first" />);
    });

    const form = host.querySelector('form') as HTMLFormElement;
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    await requestSubmit(form);
    expect(agentTurnCalls(fetchMock)).toHaveLength(1);

    await setTextareaValue(textarea, 'second');
    await requestSubmit(form);
    await setTextareaValue(textarea, 'third');
    await requestSubmit(form);
    expect(agentTurnCalls(fetchMock)).toHaveLength(1);
    expect(host.textContent).toContain('second');
    expect(host.textContent).toContain('third');

    await resolveNextStream('first done');
    await waitForAgentTurnCallCount(fetchMock, 2);
    expect(agentTurnCalls(fetchMock)).toHaveLength(2);
    const secondBody = JSON.parse(String(agentTurnCalls(fetchMock)[1][1]?.body));
    const secondLastUser = secondBody.messages.filter((message: { role: string }) => message.role === 'user').at(-1);
    expect(secondLastUser.content).toBe('second');
    expect(host.textContent).not.toContain('second');
    expect(host.textContent).toContain('third');

    await resolveNextStream('second done');
    await waitForAgentTurnCallCount(fetchMock, 3);
    expect(agentTurnCalls(fetchMock)).toHaveLength(3);
    const thirdBody = JSON.parse(String(agentTurnCalls(fetchMock)[2][1]?.body));
    const thirdLastUser = thirdBody.messages.filter((message: { role: string }) => message.role === 'user').at(-1);
    expect(thirdLastUser.content).toBe('third');

    await act(async () => {
      root.unmount();
    });
  });
});
