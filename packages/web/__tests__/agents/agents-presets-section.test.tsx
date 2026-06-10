// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import AgentsPresetsSection from '@/components/agents/AgentsPresetsSection';
import { getPresetStorageKey } from '@/components/agents/builtin-agent-presets';
import {
  INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
  INBOX_ORGANIZER_DEFAULT_PROMPT,
} from '@/lib/inbox-assistant';
import { messages } from '@/lib/i18n';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const inboxOrganizerPromptUrl = `/api/file?path=${encodeURIComponent(INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH)}&op=read_file`;

function mockInboxOrganizerPromptFile(content = INBOX_ORGANIZER_DEFAULT_PROMPT) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === inboxOrganizerPromptUrl) {
      return { ok: true, json: async () => ({ content }) };
    }
    if (url === '/api/file' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ ok: true, path: INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setTextareaValue(textarea: HTMLTextAreaElement | null, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  valueSetter?.call(textarea, value);
  textarea?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

describe('AgentsPresetsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockInboxOrganizerPromptFile();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('shows every run surface for the selected Assistant profile', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Review all pending captures');
    expect(host.textContent).toContain('Retry failed organize run');
    expect(host.textContent).toContain('Open from Inbox panel');

    await act(async () => {
      root.unmount();
    });
  });

  it('loads the Inbox Organizer prompt file without marking it as unsaved', async () => {
    mockInboxOrganizerPromptFile('Use a tighter review policy.');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} />);
      await new Promise(r => setTimeout(r, 0));
    });

    const promptTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Prompt'));

    await act(async () => {
      promptTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save prompt'));
    const resetButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Reset'));

    expect(textarea?.value).toBe('Use a tighter review policy.');
    expect(host.textContent).toContain('Custom draft');
    expect(host.textContent).not.toContain('Unsaved changes');
    expect(saveButton?.hasAttribute('disabled')).toBe(true);
    expect(resetButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it('migrates the old Inbox Agent prompt draft key for existing users', async () => {
    const fetchMock = mockInboxOrganizerPromptFile(INBOX_ORGANIZER_DEFAULT_PROMPT);
    localStorage.setItem(getPresetStorageKey('inbox-agent'), 'Use the legacy review policy.');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} />);
      await new Promise(r => setTimeout(r, 0));
    });

    const promptTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Prompt'));

    await act(async () => {
      promptTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.querySelector('textarea')?.value).toBe('Use the legacy review policy.');
    expect(host.textContent).toContain('Unsaved changes');

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save prompt'));
    expect(saveButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/file', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        op: 'save_file',
        path: INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
        content: 'Use the legacy review policy.',
        source: 'user',
      }),
    }));
    expect(localStorage.getItem(getPresetStorageKey('inbox-agent'))).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('saves edited Inbox Organizer prompts to the assistant prompt file', async () => {
    const fetchMock = mockInboxOrganizerPromptFile('Use the file review policy.');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} />);
      await new Promise(r => setTimeout(r, 0));
    });

    const promptTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Prompt'));

    await act(async () => {
      promptTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    await act(async () => {
      setTextareaValue(textarea, 'Use the edited review policy.');
      await new Promise(r => setTimeout(r, 0));
    });

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save prompt'));
    expect(host.textContent).toContain('Unsaved changes');
    expect(saveButton?.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/file', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'save_file',
        path: INBOX_ORGANIZER_ASSISTANT_PROMPT_PATH,
        content: 'Use the edited review policy.',
        source: 'user',
      }),
    }));
    expect(host.textContent).toContain('Custom draft');
    expect(host.textContent).not.toContain('Unsaved changes');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps resources behind an explicit section instead of crowding the overview', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentsPresetsSection copy={messages.en.agentsContent.presets} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Runtime contract');
    expect(host.textContent).toContain('Run surfaces');
    expect(host.textContent).not.toContain('read_inbox');
    expect(host.textContent).not.toContain('workflow-to-skill');

    const resourcesTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Resources'));

    await act(async () => {
      resourcesTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('read_inbox');
    expect(host.textContent).toContain('workflow-to-skill');
    expect(host.textContent).toContain('Inbox files');

    await act(async () => {
      root.unmount();
    });
  });
});
