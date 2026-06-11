// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import AgentsPresetsSection from '@/components/agents/AgentsPresetsSection';
import { messages } from '@/lib/i18n';

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const localAssistantsPayload = {
  root: '.mindos/assistants',
  assistants: [
    {
      id: 'daily-signal',
      name: 'Daily Signal',
      description: 'Track product signals from local notes.',
      schemaVersion: 1,
      preferredAgent: 'mindos-agent',
      skills: ['signal-curation'],
      mcp: ['arxiv'],
      source: 'builtin',
      deletable: false,
      paths: {
        root: '.mindos/assistants/daily-signal',
        prompt: '.mindos/assistants/daily-signal/prompt.md',
        profile: '.mindos/assistants/daily-signal/profile.json',
      },
      promptPath: '.mindos/assistants/daily-signal/prompt.md',
      profilePath: '.mindos/assistants/daily-signal/profile.json',
      promptReady: true,
      profileReady: true,
      profileError: 'invalid_json',
      promptTitle: 'Daily Signal',
      promptPreview: 'Collect weak signals and summarize them.',
      prompt: {
        exists: true,
        content: `# Daily Signal

## Role

Collect weak signals and summarize them.

## Inputs

- Recent notes
- Decision logs

## Output

Write a concise signal brief.

## Boundaries

- Do not overwrite source notes.
`,
      },
      health: {
        state: 'ready',
        issues: [],
      },
    },
    {
      id: 'research-scout',
      name: 'Research Scout',
      description: 'Prepare a reading queue.',
      schemaVersion: 1,
      preferredAgent: 'codex',
      skills: ['mindos'],
      mcp: ['semantic-scholar'],
      source: 'custom',
      deletable: true,
      paths: {
        root: '.mindos/assistants/research-scout',
        prompt: '.mindos/assistants/research-scout/prompt.md',
        profile: '.mindos/assistants/research-scout/profile.json',
      },
      promptPath: '.mindos/assistants/research-scout/prompt.md',
      profilePath: '.mindos/assistants/research-scout/profile.json',
      promptReady: true,
      profileReady: true,
      promptPreview: 'Prepare a reading queue from local research notes.',
      prompt: {
        exists: true,
        content: `# Research Scout

## Role

Prepare a reading queue from local research notes.
`,
      },
      health: {
        state: 'ready',
        issues: [],
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockAssistantsFetch(payload = localAssistantsPayload, options?: { failAssistants?: boolean }) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href === '/api/assistants' && init?.method === 'DELETE') {
      return jsonResponse({ ok: true });
    }
    if (href === '/api/assistants') {
      if (options?.failAssistants) return jsonResponse({ error: 'boom' }, 500);
      return jsonResponse(payload);
    }
    if (href === '/api/file' && init?.method === 'POST') {
      return jsonResponse({ ok: true });
    }
    if (href === '/api/ask' && init?.method === 'POST') {
      return new Response('data: {"type":"text_delta","delta":"Run summary"}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function flushEffects() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function renderSection(onLibraryCountChange = vi.fn()): Promise<{ host: HTMLDivElement; root: Root; onLibraryCountChange: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} onLibraryCountChange={onLibraryCountChange} />);
    await flushEffects();
  });

  return { host, root, onLibraryCountChange };
}

function clickButton(host: HTMLElement, label: string) {
  const button = Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label));
  expect(button, `button ${label}`).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  valueSetter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AgentsPresetsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('loads Assistant profiles from /api/assistants instead of static presets', async () => {
    const fetchMock = mockAssistantsFetch();
    const onLibraryCountChange = vi.fn();
    const { host, root } = await renderSection(onLibraryCountChange);

    expect(fetchMock).toHaveBeenCalledWith('/api/assistants', { cache: 'no-store' });
    expect(onLibraryCountChange).toHaveBeenCalledWith(2);
    expect(host.textContent).toContain('Daily Signal');
    expect(host.textContent).toContain('Research Scout');
    expect(host.textContent).toContain('Collect weak signals and summarize them.');
    expect(host.textContent).toContain('Recent notes');
    expect(host.textContent).toContain('Decision logs');
    expect(host.textContent).not.toContain('Skill Librarian');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows profile resources in the Resources section', async () => {
    mockAssistantsFetch();
    const { host, root } = await renderSection();

    await act(async () => {
      clickButton(host, 'Resources');
      await flushEffects();
    });

    expect(host.textContent).toContain('mindos-agent');
    expect(host.textContent).toContain('arxiv');
    expect(host.textContent).toContain('signal-curation');

    await act(async () => {
      root.unmount();
    });
  });

  it('saves prompt edits to the selected local prompt file', async () => {
    const fetchMock = mockAssistantsFetch();
    const { host, root } = await renderSection();

    await act(async () => {
      clickButton(host, 'Prompt');
      await flushEffects();
    });

    const textarea = host.querySelector('textarea[data-assistant-prompt-editor="daily-signal"]') as HTMLTextAreaElement;
    expect(textarea.value).toContain('# Daily Signal');

    const editedPrompt = `# Daily Signal

## Role

Use the edited review policy.

## Inputs

- Inbox notes
- Local decisions

## Output

Write an updated morning brief.

## Boundaries

- Keep source notes unchanged.
`;

    await act(async () => {
      setTextareaValue(textarea, editedPrompt);
      await flushEffects();
    });

    expect(host.textContent).toContain('Unsaved changes');

    await act(async () => {
      clickButton(host, 'Save prompt');
      await flushEffects();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/file', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'save_file',
        path: '.mindos/assistants/daily-signal/prompt.md',
        content: editedPrompt,
        source: 'user',
      }),
    }));
    expect(host.textContent).not.toContain('Unsaved changes');

    await act(async () => {
      clickButton(host, 'Overview');
      await flushEffects();
    });

    expect(host.textContent).toContain('Use the edited review policy.');
    expect(host.textContent).toContain('Inbox notes');
    expect(host.textContent).toContain('Local decisions');
    expect(host.textContent).toContain('Write an updated morning brief.');
    expect(host.textContent).toContain('Keep source notes unchanged.');
    expect(host.textContent).not.toContain('Recent notes');

    await act(async () => {
      root.unmount();
    });
  });

  it('saves profile edits to minimal profile.json without runtime fields', async () => {
    const fetchMock = mockAssistantsFetch();
    const { host, root } = await renderSection();

    await act(async () => {
      clickButton(host, 'Profile');
      await flushEffects();
    });

    const nameInput = host.querySelector('input[data-assistant-profile-name="daily-signal"]') as HTMLInputElement;
    const agentInput = host.querySelector('input[data-assistant-profile-agent="daily-signal"]') as HTMLInputElement;
    const skillsInput = host.querySelector('textarea[data-assistant-profile-skills="daily-signal"]') as HTMLTextAreaElement;
    await act(async () => {
      setInputValue(nameInput, 'Morning Signal Editor');
      setInputValue(agentInput, 'claude-code');
      setTextareaValue(skillsInput, 'signal-curation\nmindos');
      await flushEffects();
    });

    await act(async () => {
      host.querySelector('button[data-assistant-profile-save="daily-signal"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    const postCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/file' && init?.method === 'POST');
    expect(postCall).toBeTruthy();
    const request = JSON.parse(postCall![1]!.body as string);
    expect(request.path).toBe('.mindos/assistants/daily-signal/profile.json');
    const savedProfile = JSON.parse(request.content);
    expect(savedProfile).toMatchObject({
      name: 'Morning Signal Editor',
      description: 'Track product signals from local notes.',
      schemaVersion: 1,
      preferredAgent: 'claude-code',
      skills: ['signal-curation', 'mindos'],
      mcp: ['arxiv'],
    });
    expect(savedProfile).not.toHaveProperty('permissionMode');
    expect(savedProfile).not.toHaveProperty('schedule');
    expect(savedProfile).not.toHaveProperty('surface');
    expect(savedProfile).not.toHaveProperty('tools');
    expect(host.textContent).not.toContain('Profile JSON needs repair');
    expect(host.textContent).toContain('Morning Signal Editor');

    await act(async () => {
      root.unmount();
    });
  });

  it('protects built-in Assistants from deletion in the UI', async () => {
    mockAssistantsFetch();
    const { host, root } = await renderSection();

    const deleteButton = host.querySelector('button[data-assistant-delete="daily-signal"]') as HTMLButtonElement;
    expect(deleteButton).toBeTruthy();
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.textContent).toContain('Protected');

    await act(async () => {
      root.unmount();
    });
  });

  it('runs and deletes custom Assistants', async () => {
    const fetchMock = mockAssistantsFetch();
    const { host, root } = await renderSection();

    await act(async () => {
      host.querySelector('button[data-assistant-library-row="research-scout"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    expect(host.textContent).toContain('Custom');
    const deleteButton = host.querySelector('button[data-assistant-delete="research-scout"]') as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(false);

    await act(async () => {
      host.querySelector('button[data-assistant-run="research-scout"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    const askCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/ask' && init?.method === 'POST');
    expect(askCall).toBeTruthy();
    const askBody = JSON.parse(askCall![1]!.body as string);
    expect(askBody.mode).toBe('chat');
    expect(askBody.messages[0].content).toContain('Research Scout');
    expect(askBody.messages[0].content).toContain('readonly mode');
    expect(host.textContent).toContain('Run summary');

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/assistants', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ id: 'research-scout' }),
    }));
    expect(host.textContent).not.toContain('Research Scout');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders an empty local-library state', async () => {
    mockAssistantsFetch({ root: '.mindos/assistants', assistants: [] });
    const onLibraryCountChange = vi.fn();
    const { host, root } = await renderSection(onLibraryCountChange);

    expect(onLibraryCountChange).toHaveBeenCalledWith(0);
    expect(host.textContent).toContain('No local assistants found');
    expect(host.textContent).toContain('.mindos/assistants/<assistant-id>/prompt.md');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders a retryable load failure', async () => {
    mockAssistantsFetch(localAssistantsPayload, { failAssistants: true });
    const onLibraryCountChange = vi.fn();
    const { host, root } = await renderSection(onLibraryCountChange);

    expect(onLibraryCountChange).toHaveBeenCalledWith(0);
    expect(host.textContent).toContain('Failed to load assistants.');
    expect(host.textContent).toContain('Retry');

    await act(async () => {
      root.unmount();
    });
  });
});
