// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DirView from '@/components/DirView';
import type { BuiltInMindSystemSpaceRecord } from '@/lib/space-records';
import { openAskModal } from '@/hooks/useAskModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigationMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: navigationMocks.refresh,
  }),
}));

vi.mock('@/components/Breadcrumb', () => ({
  default: ({ filePath }: { filePath: string }) => <nav>{filePath}</nav>,
}));

vi.mock('@/hooks/useAskModal', () => ({
  openAskModal: vi.fn(),
}));

const daoSpace: BuiltInMindSystemSpaceRecord = {
  kind: 'builtin-mind-system',
  slot: {
    key: 'dao',
    systemId: 'MIND_DAO',
    label: '道',
    path: 'MIND_DAO',
    role: 'world-model',
    order: 10,
    enabled: true,
  },
  fileCount: 3,
  description: 'Values, direction, long-term judgment',
  assistantSummary: {
    assistants: [
      {
        id: 'daily-signal',
        schedule: { mode: 'daily' },
        promptPath: '.mindos/assistants/daily-signal/prompt.md',
        promptReady: true,
      },
      {
        id: 'decision-synthesizer',
        schedule: { mode: 'manual' },
        promptPath: '.mindos/assistants/decision-synthesizer/prompt.md',
        promptReady: true,
      },
    ],
    draftCount: 2,
    instructionReady: true,
  },
};

describe('DirView Mind System assistant strip', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(openAskModal).mockClear();
    navigationMocks.refresh.mockClear();
    root = null;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('renders a restrained assistant list for a built-in Mind System root directory', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={daoSpace}
        />,
      );
    });

    const strip = host.querySelector<HTMLElement>('[data-mind-system-dir-assistant="dao"]');
    const firstRunButton = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-run-once="daily-signal"]');
    const secondRunButton = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-run-once="decision-synthesizer"]');

    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain('道');
    expect(strip?.textContent).toContain('Assistants');
    expect(strip?.textContent).toContain('Daily signal curator');
    expect(strip?.textContent).toContain('Daily');
    expect(strip?.textContent).toContain('Manual');
    expect(strip?.textContent).toContain('Decision synthesizer');
    expect(strip?.textContent).toContain('Instruction ready');
    expect(strip?.textContent).toContain('2 drafts');
    expect(strip?.querySelector('a[href="/view/MIND_DAO/INSTRUCTION.md"]')).not.toBeNull();
    expect(strip?.querySelector('a[href="/view/MIND_DAO/Drafts"]')).not.toBeNull();
    expect(strip?.querySelector('[data-mind-system-dir-assistant-icon="daily-signal"]')?.textContent).toBe('D');
    expect(strip?.querySelector('[data-mind-system-dir-assistant-icon="decision-synthesizer"]')?.textContent).toBe('D');
    expect(firstRunButton).not.toBeNull();
    expect(secondRunButton).not.toBeNull();
    expect(firstRunButton?.closest('a')).toBeNull();
    expect(firstRunButton?.className).toContain('focus-visible:ring-2');
    expect(firstRunButton?.className).toContain('touch-manipulation');
    expect(strip?.querySelector('[data-mind-system-dir-view-assistant="daily-signal"]')).not.toBeNull();
    expect(strip?.querySelector('[data-mind-system-dir-edit-assistant="daily-signal"]')?.closest('a')).toBeNull();
    expect(strip?.textContent).toContain('Prompt ready');
  });

  it('opens an assistant detail dialog for viewing and editing the prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: '# Daily prompt\n\nKeep it focused.\n' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, path: '.mindos/assistants/daily-signal/prompt.md' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={daoSpace}
        />,
      );
    });

    const editButton = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-edit-assistant="daily-signal"]');

    await act(async () => {
      editButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const dialog = document.body.querySelector<HTMLElement>('[data-mind-system-assistant-dialog="daily-signal"]');
    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-mind-system-assistant-prompt-editor="daily-signal"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Daily signal curator');
    expect(dialog?.textContent).toContain('.mindos/assistants/daily-signal/prompt.md');
    expect(dialog?.textContent).toContain('MIND_DAO/Drafts/');
    expect(textarea?.value).toBe('# Daily prompt\n\nKeep it focused.\n');
    expect(fetchMock).toHaveBeenCalledWith('/api/file?path=.mindos%2Fassistants%2Fdaily-signal%2Fprompt.md&op=read_file');

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(textarea, '# Updated prompt\n');
      textarea?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });

    const saveButton = document.body.querySelector<HTMLButtonElement>('[data-mind-system-assistant-save-prompt="daily-signal"]');
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const [, saveOptions] = fetchMock.mock.calls[1] ?? [];
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saveOptions).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(saveOptions.body))).toEqual({
      op: 'save_file',
      path: '.mindos/assistants/daily-signal/prompt.md',
      content: '# Updated prompt\n',
      source: 'user',
    });
    expect(document.body.textContent).toContain('Prompt saved');
    expect(navigationMocks.refresh).toHaveBeenCalled();
  });

  it('creates the assistant prompt from the editor when the prompt file is missing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'missing' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, path: '.mindos/assistants/daily-signal/prompt.md' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={daoSpace}
        />,
      );
    });

    const editButton = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-edit-assistant="daily-signal"]');

    await act(async () => {
      editButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const textarea = document.body.querySelector<HTMLTextAreaElement>('[data-mind-system-assistant-prompt-editor="daily-signal"]');
    const saveButton = document.body.querySelector<HTMLButtonElement>('[data-mind-system-assistant-save-prompt="daily-signal"]');

    expect(document.body.textContent).toContain('Prompt file is missing. Saving here will create it.');
    expect(textarea?.value).toContain('# Daily signal curator');
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const [, saveOptions] = fetchMock.mock.calls[1] ?? [];
    expect(JSON.parse(String(saveOptions.body))).toMatchObject({
      op: 'save_file',
      path: '.mindos/assistants/daily-signal/prompt.md',
      source: 'user',
    });
    expect(String(JSON.parse(String(saveOptions.body)).content)).toContain('Write one focused Markdown draft');
    expect(document.body.textContent).toContain('Prompt saved');
  });

  it('opens Ask with the selected assistant prompt without navigating or writing directly', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={daoSpace}
        />,
      );
    });

    const runButton = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-run-once="decision-synthesizer"]');

    await act(async () => {
      runButton?.click();
    });

    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining('Decision synthesizer'),
      'user',
    );
    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining('MIND_DAO/Drafts/'),
      'user',
    );
    expect(openAskModal).toHaveBeenCalledWith(
      expect.stringContaining('.mindos/assistants/decision-synthesizer/prompt.md'),
      'user',
    );
  });

  it('shows at most three assistants until the user asks to view all', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={{
            ...daoSpace,
            assistantSummary: {
              ...daoSpace.assistantSummary,
              assistants: [
                { id: 'daily-signal', schedule: { mode: 'daily' }, promptPath: '.mindos/assistants/daily-signal/prompt.md' },
                { id: 'decision-synthesizer', schedule: { mode: 'manual' }, promptPath: '.mindos/assistants/decision-synthesizer/prompt.md' },
                { id: 'third-assistant', schedule: { mode: 'manual' }, promptPath: '.mindos/assistants/third-assistant/prompt.md' },
                { id: 'fourth-assistant', schedule: { mode: 'weekly' }, promptPath: '.mindos/assistants/fourth-assistant/prompt.md' },
              ],
            },
          }}
        />,
      );
    });

    expect(host.querySelectorAll('[data-mind-system-dir-assistant-item]').length).toBe(3);
    expect(host.textContent).toContain('third-assistant');
    expect(host.textContent).not.toContain('fourth-assistant');

    const viewAll = host.querySelector<HTMLButtonElement>('[data-mind-system-dir-view-all-assistants="dao"]');
    expect(viewAll).not.toBeNull();

    await act(async () => {
      viewAll?.click();
    });

    expect(host.querySelectorAll('[data-mind-system-dir-assistant-item]').length).toBe(4);
    expect(host.textContent).toContain('fourth-assistant');
    expect(host.textContent).toContain('Weekly');
  });

  it('does not render the assistant strip for ordinary directories or subdirectories', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(<DirView dirPath="Projects" entries={[]} />);
    });

    expect(host.querySelector('[data-mind-system-dir-assistant]')).toBeNull();

    await act(async () => {
      root?.unmount();
      root = createRoot(host);
      root.render(<DirView dirPath="MIND_DAO/Drafts" entries={[]} />);
    });

    expect(host.querySelector('[data-mind-system-dir-assistant]')).toBeNull();
  });

  it('shows missing instruction state when the assistant cannot read INSTRUCTION.md', async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <DirView
          dirPath="MIND_DAO"
          entries={[]}
          mindSystemSpace={{
            ...daoSpace,
            assistantSummary: {
              ...daoSpace.assistantSummary,
              instructionReady: false,
            },
          }}
        />,
      );
    });

    const strip = host.querySelector<HTMLElement>('[data-mind-system-dir-assistant="dao"]');

    expect(strip?.textContent).toContain('Instruction missing');
    expect(strip?.textContent).not.toContain('Instruction ready');
  });
});
