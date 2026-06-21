// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useInboxOrganizeController } from '@/hooks/useInboxOrganizeController';
import type { InboxOrganizeFile, InboxOrganizeOptions } from '@/hooks/useInboxOrganizeController';

const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/toast', () => ({
  toast: {
    error: toastError,
  },
}));

const startMock = vi.fn();
const resultMock = vi.fn();

const aiOrganize = {
  phase: 'idle',
  changes: [],
  start: startMock,
};

const labels = {
  organizeNoAi: 'Configure an AI API key before running the Inbox Organizer. Capture still works without AI.',
  organizeFailed: 'Inbox Organizer failed.',
};

function InboxOrganizeHarness({
  files,
  options,
  ai = aiOrganize,
  autoStart = true,
}: {
  files: InboxOrganizeFile[];
  options?: InboxOrganizeOptions;
  ai?: unknown;
  autoStart?: boolean;
}) {
  const controller = useInboxOrganizeController({
    aiOrganize: ai as unknown as Parameters<typeof useInboxOrganizeController>[0]['aiOrganize'],
    labels,
  });

  useEffect(() => {
    if (autoStart) void controller.requestInboxOrganize(files, options).then(resultMock);
  }, [autoStart, controller, files, options]);

  return null;
}

describe('useInboxOrganizeController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('starts Inbox Organizer with the active provider from Settings instead of showing the missing-key toast', async () => {
    const files = [{ name: 'capture.md', path: 'Inbox/capture.md' }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/settings') {
        return {
          ok: true,
          json: async () => ({
            ai: {
              activeProvider: 'p_openai01',
              providers: [
                { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
              ],
            },
            envOverrides: {},
          }),
        };
      }
      if (url.startsWith('/api/file?')) {
        return {
          ok: true,
          json: async () => ({ content: 'Inbox capture content' }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(toastError).not.toHaveBeenCalledWith(labels.organizeNoAi, expect.anything());
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(
      [{ name: 'capture.md', content: 'Inbox capture content' }],
      expect.stringContaining('Current Inbox Review Run'),
      'inbox-organize',
      { assistantId: 'inbox-organizer' },
    );
    expect(startMock.mock.calls[0]?.[1]).toContain('Inbox/capture.md');
    expect(resultMock).toHaveBeenCalledWith({ started: true });

    await act(async () => {
      root.unmount();
    });
  });

  it('uses providerOverride availability when the active provider is not configured', async () => {
    const files = [{ name: 'capture.md', path: 'Inbox/capture.md' }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/settings') {
        return {
          ok: true,
          json: async () => ({
            ai: {
              activeProvider: 'p_anthro01',
              providers: [
                { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
                { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
              ],
            },
            envOverrides: {},
          }),
        };
      }
      if (url.startsWith('/api/file?')) {
        return {
          ok: true,
          json: async () => ({ content: 'Inbox capture content' }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const options = { providerOverride: 'p_openai01', modelOverride: 'gpt-5.4' };

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} options={options} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(toastError).not.toHaveBeenCalledWith(labels.organizeNoAi, expect.anything());
    expect(startMock).toHaveBeenCalledWith(
      [{ name: 'capture.md', content: 'Inbox capture content' }],
      expect.stringContaining('Current Inbox Review Run'),
      'inbox-organize',
      { ...options, assistantId: 'inbox-organizer' },
    );
    expect(startMock.mock.calls[0]?.[1]).not.toContain('mode: subagent');
    expect(startMock.mock.calls[0]?.[1]).toContain('Inbox/capture.md');
    expect(resultMock).toHaveBeenCalledWith({ started: true });

    await act(async () => {
      root.unmount();
    });
  });

  it('archives only readable source files included in a fully successful run', async () => {
    const deleteBodies: unknown[] = [];
    const files = [
      { name: 'notes.md', path: 'Inbox/notes.md' },
      { name: 'report.pdf', path: 'Inbox/report.pdf' },
      { name: 'unreadable.txt', path: 'Inbox/unreadable.txt' },
    ];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return {
          ok: true,
          json: async () => ({
            ai: {
              activeProvider: 'p_openai01',
              providers: [
                { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
              ],
            },
            envOverrides: {},
          }),
        };
      }
      if (url.startsWith('/api/file?path=Inbox%2Fnotes.md')) {
        return { ok: true, json: async () => ({ content: 'Readable notes' }) };
      }
      if (url.startsWith('/api/file?path=Inbox%2Funreadable.txt')) {
        return { ok: false, status: 500, json: async () => ({ error: 'read failed' }) };
      }
      if (url === '/api/inbox' && init?.method === 'DELETE') {
        deleteBodies.push(JSON.parse(String(init.body)));
        return {
          ok: true,
          json: async () => ({ archived: [{ original: 'notes.md', archivedPath: '.archive/notes.md' }], notFound: [] }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const idleAi = { ...aiOrganize, phase: 'idle', changes: [] };

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} ai={idleAi} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(startMock).toHaveBeenCalledWith(
      [{ name: 'notes.md', content: 'Readable notes' }],
      expect.stringContaining('notes.md'),
      'inbox-organize',
      { assistantId: 'inbox-organizer' },
    );

    const doneAi = {
      ...idleAi,
      phase: 'done',
      changes: [{ ok: true, path: 'Knowledge/notes.md', action: 'create' }],
    };

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} ai={doneAi} autoStart={false} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(deleteBodies).toEqual([{ names: ['notes.md'] }]);

    await act(async () => {
      root.unmount();
    });
  });

  it('does not archive source files when the organize run has failed changes', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return {
          ok: true,
          json: async () => ({
            ai: {
              activeProvider: 'p_openai01',
              providers: [
                { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
              ],
            },
            envOverrides: {},
          }),
        };
      }
      if (url.startsWith('/api/file?')) {
        return { ok: true, json: async () => ({ content: 'Readable notes' }) };
      }
      if (url === '/api/inbox' && init?.method === 'DELETE') {
        return { ok: true, json: async () => ({ archived: [], notFound: [] }) };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = [{ name: 'notes.md', path: 'Inbox/notes.md' }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const idleAi = { ...aiOrganize, phase: 'idle', changes: [] };

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} ai={idleAi} />);
      await new Promise(r => setTimeout(r, 0));
    });

    const doneAi = {
      ...idleAi,
      phase: 'done',
      changes: [{ ok: false, path: 'Knowledge/notes.md', action: 'create' }],
    };

    await act(async () => {
      root.render(<InboxOrganizeHarness files={files} ai={doneAi} autoStart={false} />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).not.toHaveBeenCalledWith('/api/inbox', expect.objectContaining({ method: 'DELETE' }));

    await act(async () => {
      root.unmount();
    });
  });
});
