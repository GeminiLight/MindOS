// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { messages } from '@/lib/i18n';

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    locale: 'en' as const,
    setLocale: vi.fn(),
    t: messages.en,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

const mockRouterPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/capture',
}));

describe('InboxView product shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/capture');
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'agent-memory-notes.md',
            path: 'Inbox/agent-memory-notes.md',
            size: 2048,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
          {
            name: 'wechat-capture.txt',
            path: 'Inbox/wechat-capture.txt',
            size: 1024,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          },
        ],
      }),
    }));
  });

  it('opens as a quiet add surface with a scrollable Review queue preview', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('New capture');
    expect(host.textContent).toContain('Paste, drop, save.');
    const pageShell = host.querySelector('[data-content-page-shell="inbox"]');
    expect(pageShell?.className).toContain('content-width');
    expect(pageShell?.className).toContain('workbench-content-page');
    expect(pageShell?.className).toContain('inbox-content-page');
    const mainLayout = host.querySelector('[data-inbox-main-layout]');
    expect(mainLayout?.className).toContain('xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]');
    expect(mainLayout?.className).not.toContain('max-w-[1120px]');
    expect(host.querySelector('[data-inbox-page-title]')?.textContent).toBe('New capture');
    expect(host.querySelector('[data-inbox-back-to-capture]')).toBeNull();
    expect(host.querySelector('[data-inbox-page-upload]')).toBeNull();
    expect(Array.from(host.querySelectorAll('button'))
      .some(button => button.getAttribute('aria-label') === 'Back to Wiki')).toBe(false);
    expect(host.textContent).not.toContain('CaptureSave only');
    expect(host.textContent).not.toContain('Capture anythingCapture anything');
    const flowSteps = host.querySelector('[data-inbox-flow-steps]');
    expect(flowSteps?.textContent).toContain('1New capture');
    expect(flowSteps?.textContent).toContain('2Review queue');
    expect(flowSteps?.textContent).toContain('3Organize to Mind');
    expect(flowSteps?.textContent).not.toContain('Paste, type, or drop files.');
    expect(flowSteps?.textContent).not.toContain('6 files');
    expect(flowSteps?.textContent).not.toContain('Open Review to organize.');
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).toContain('Paste a link, write a note');
    expect(host.querySelector('textarea')?.getAttribute('aria-label')).toContain('Add a link, note, file');
    expect(host.textContent).toContain('Attach');
    expect(host.textContent).toContain('Stage as note');
    expect(host.textContent).not.toContain('⌘/Ctrl Enter');
    expect(host.textContent).toContain('Save to Inbox');
    expect(host.textContent).toContain('Organize to Mind');
    const stageButton = host.querySelector('[data-stage-note-action]');
    expect(stageButton?.closest('[data-inbox-composer-footer]')).not.toBeNull();
    expect(stageButton?.closest('[data-inbox-primary-actions]')).toBeNull();
    expect(host.querySelector('[data-inbox-attach-action]')?.textContent).toContain('Attach');
    expect(host.querySelector('[data-inbox-primary-actions]')?.textContent).toContain('Save to Inbox');
    expect(host.querySelector('[data-inbox-primary-actions]')?.textContent).toContain('Organize to Mind');
    expect(host.querySelector('[data-inbox-primary-actions]')?.textContent).not.toContain('Attach');
    expect(host.querySelector('[data-inbox-primary-actions]')?.textContent).not.toContain('Stage as note');
    expect(host.textContent).not.toContain('Next action');
    expect(host.textContent).not.toContain('Save only');
    expect(host.textContent).not.toContain('Suggested: Save only');
    expect(host.textContent).not.toContain('Choose intent');
    expect(host.textContent).not.toContain('Local first · Source preserved · Review later');
    expect(host.textContent).not.toContain('Links, notes, files, drops');
    expect(host.querySelector('[data-capture-autodetect-hint]')?.textContent).toContain('Auto-detects: links');
    expect(host.textContent).toContain('Auto-detects: links · PDF · images · files · notes');
    expect(host.querySelectorAll('[data-capture-affordance]')).toHaveLength(0);
    expect(host.textContent).not.toContain('YouTube, Bilibili, XHS');
    expect(host.textContent).not.toContain('Assistant waits for Review');
    expect(host.textContent).toContain('Live source preview');
    expect(host.textContent).toContain('Paste any source');
    expect(host.textContent).toContain('The preview appears here before saving.');
    const livePreview = host.querySelector('section[aria-label="Live source preview"]');
    const livePreviewAside = livePreview?.closest('aside');
    expect(livePreviewAside?.className).not.toContain('sticky');
    expect(livePreviewAside?.className).not.toContain('top-');
    expect(host.textContent).not.toContain('Detected');
    expect(host.textContent).not.toContain('Documents');
    expect(host.textContent).not.toContain('Tables');
    expect(host.textContent).not.toContain('Screenshots');
    expect(host.textContent).toContain('Review queue');
    expect(host.textContent).not.toContain('Scroll here when you are ready to clear what you captured.');
    expect(host.textContent).not.toContain('Ready for review');
    expect(host.textContent).not.toContain('Inbox Organizer');
    expect(host.textContent).not.toContain('This assistant helps clear the queue when you open Review.');
    expect(host.textContent).toContain('Review 2 pending');
    expect(host.textContent).not.toContain('0 selected');
    expect(host.textContent).toContain('Select all');
    expect(host.textContent).not.toContain('Select aging');
    expect(host.textContent).toContain('Shelve selected');
    expect(host.textContent).toContain('Organize selected');
    expect(host.textContent).not.toContain('Writes only after review');
    expect(host.textContent).not.toContain('Open Review to choose captures and organize them.');
    expect(host.textContent).not.toContain('Routing hints');
    expect(host.textContent).not.toContain('Review with Agent');
    expect(Array.from(host.querySelectorAll('button'))
      .some(button => button.textContent?.trim() === 'Review with Agent')).toBe(false);
    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.textContent).not.toContain('Capture sources');
    expect(host.textContent).not.toContain('WeChat');
    expect(host.textContent).not.toContain('Web clipper');
    expect(host.textContent).not.toContain('Current item');
    expect(host.textContent).not.toContain('Item preview');
    expect(host.textContent).not.toContain('Inbox Agent');

    await act(async () => {
      root.unmount();
    });
  });

  it('runs Organize to Mind directly from the capture composer', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let organizeDetail: unknown = null;
    const onOrganize = (event: Event) => {
      organizeDetail = (event as CustomEvent).detail;
    };
    window.addEventListener('mindos:inbox-organize', onOrganize);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const primaryActions = host.querySelector('[data-inbox-primary-actions]');
    const organizeButton = Array.from(primaryActions?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Organize to Mind'));
    expect(organizeButton).not.toBeNull();

    await act(async () => {
      organizeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(organizeDetail).toEqual(expect.objectContaining({
      files: [
        expect.objectContaining({ name: 'agent-memory-notes.md', path: 'Inbox/agent-memory-notes.md' }),
        expect.objectContaining({ name: 'wechat-capture.txt', path: 'Inbox/wechat-capture.txt' }),
      ],
    }));
    expect(host.textContent).toContain('Review queue');
    expect(host.textContent).toContain('2 selected');

    await act(async () => {
      root.unmount();
    });
    window.removeEventListener('mindos:inbox-organize', onOrganize);
  });

  it('organizes selected captures directly from the New capture queue preview', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let organizeDetail: unknown = null;
    const onOrganize = (event: Event) => {
      organizeDetail = (event as CustomEvent).detail;
    };
    window.addEventListener('mindos:inbox-organize', onOrganize);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const previewAction = host.querySelector('[data-inbox-queue-preview-action]');
    expect(previewAction?.textContent).toContain('Organize selected');
    expect(previewAction?.textContent).toContain('Shelve selected');
    expect(previewAction?.textContent).toContain('Select all');
    expect(previewAction?.textContent).not.toContain('Writes only after review');

    const firstSelectionButton = host.querySelector('button[aria-label="Select agent-memory-notes.md"]') as HTMLButtonElement | null;
    expect(firstSelectionButton).not.toBeNull();

    await act(async () => {
      firstSelectionButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('1 selected');
    expect(host.textContent).toContain('Shelve 1 selected');
    expect(host.textContent).toContain('Organize 1 selected');

    const organizeButton = Array.from(previewAction?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Organize 1 selected'));
    expect(organizeButton).not.toBeNull();

    await act(async () => {
      organizeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(organizeDetail).toEqual(expect.objectContaining({
      files: [
        expect.objectContaining({ name: 'agent-memory-notes.md', path: 'Inbox/agent-memory-notes.md' }),
      ],
    }));

    const shelveButton = Array.from(previewAction?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Shelve 1 selected'));
    expect(shelveButton).not.toBeNull();

    await act(async () => {
      shelveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).not.toContain('agent-memory-notes');
    expect(host.textContent).toContain('wechat-capture');

    await act(async () => {
      root.unmount();
    });
    window.removeEventListener('mindos:inbox-organize', onOrganize);
  });

  it('puts the organizer command strip above a multi-select queue and keeps details item-only', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let organizeDetail: unknown = null;
    const onOrganize = (event: Event) => {
      organizeDetail = (event as CustomEvent).detail;
    };
    window.addEventListener('mindos:inbox-organize', onOrganize);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const queueTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Review'));
    expect(queueTab).not.toBeNull();

    await act(async () => {
      queueTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Review queue');
    expect(host.textContent).not.toContain('Select captures to organize.');
    expect(host.querySelector('[data-inbox-page-title]')?.textContent).toBe('Review queue');
    expect(host.querySelector('[data-inbox-back-to-capture]')?.textContent).toContain('New capture');
    expect(host.querySelector('[data-inbox-page-upload]')?.textContent).toContain('Upload Files');
    expect(host.querySelector('[data-inbox-queue-section-header]')).toBeNull();
    expect(host.querySelector('[data-inbox-organizer-command-strip]')?.textContent).toContain('Organize to Mind');
    expect(host.textContent).not.toContain('Inbox Organizer');
    expect(host.textContent).not.toContain('Built-in assistant');
    expect(host.textContent).not.toContain('Select captures, then generate a reviewable organization plan.');
    expect(host.textContent).not.toContain('Writes only after review');
    expect(host.textContent).not.toContain('Selected captures');
    expect(host.textContent).not.toContain('Reviewed Mind updates');
    expect(Array.from(host.querySelectorAll('a'))
      .some(link => link.getAttribute('href') === '/agents?tab=presets' && link.textContent?.trim() === 'Edit')).toBe(false);
    expect(host.textContent).toContain('0 selected');
    expect(host.textContent).toContain('Select all');
    expect(host.textContent).not.toContain('Select aging');
    expect(host.textContent).toContain('Shelve selected');
    expect(host.textContent).toContain('Organize selected');
    expect(Array.from(host.querySelectorAll('button'))
      .some(button => button.textContent?.trim().includes('Organize selected'))).toBe(true);
    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.textContent).toContain('Select an item');
    expect(host.textContent).not.toContain('Scope');
    expect(host.textContent).not.toContain('Review before write');
    expect(host.textContent).not.toContain('Undo history');
    expect(host.textContent).not.toContain('Item details');

    const backToCaptureButton = host.querySelector('[data-inbox-back-to-capture]') as HTMLButtonElement | null;
    expect(backToCaptureButton).not.toBeNull();

    await act(async () => {
      backToCaptureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('');
    expect(host.querySelector('[data-inbox-page-title]')?.textContent).toBe('New capture');
    expect(host.querySelector('[data-inbox-back-to-capture]')).toBeNull();

    const queueTabAfterBack = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Review'));
    expect(queueTabAfterBack).not.toBeNull();

    await act(async () => {
      queueTabAfterBack!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(window.location.hash).toBe('#queue');
    expect(host.querySelector('[data-inbox-page-title]')?.textContent).toBe('Review queue');

    const selectAllButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Select all');
    expect(selectAllButton).not.toBeNull();

    await act(async () => {
      selectAllButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    const selectionButtons = Array.from(host.querySelectorAll('button[aria-label^="Select "]')) as HTMLButtonElement[];
    expect(selectionButtons).toHaveLength(2);
    expect(selectionButtons[0]?.getAttribute('data-inbox-row-select-control')).not.toBeNull();
    expect(selectionButtons[0]?.className).toContain('h-[18px]');
    expect(selectionButtons[0]?.className).toContain('rounded-full');
    expect(selectionButtons.every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
    expect(host.textContent).toContain('2 selected');
    expect(host.textContent).toContain('Organize 2 selected');

    await act(async () => {
      selectAllButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(selectionButtons.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(host.textContent).toContain('0 selected');

    const selectionButton = host.querySelector('button[aria-label="Select wechat-capture.txt"]') as HTMLButtonElement | null;
    expect(selectionButton).not.toBeNull();

    await act(async () => {
      selectionButton!.click();
      await new Promise(r => setTimeout(r, 0));
    });

    expect(selectionButton!.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('1 selected');
    expect(host.textContent).toContain('Organize 1 selected');
    const actionColumn = host.querySelector('[data-inbox-row-actions]');
    expect(actionColumn?.className).toContain('md:w-[118px]');
    expect(actionColumn?.className).toContain('pointer-events-none');
    expect(actionColumn?.className).not.toContain('group-hover:flex');

    const organizeButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Organize 1 selected'));
    expect(organizeButton).not.toBeNull();

    await act(async () => {
      organizeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(organizeDetail).toEqual(expect.objectContaining({
      files: [expect.objectContaining({ name: 'wechat-capture.txt', path: 'Inbox/wechat-capture.txt' })],
    }));

    const row = Array.from(host.querySelectorAll('[role="button"]'))
      .find(button => button.textContent?.includes('agent-memory-notes'));
    expect(row).not.toBeUndefined();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Item details');
    expect(host.textContent).toContain('Item preview');
    expect(host.textContent).toContain('Content preview');
    expect(host.textContent).toContain('No previewable text in this capture.');
    expect(host.textContent).not.toContain('Reason');
    expect(host.textContent).not.toContain('Ambiguous capture. Keep it staged until the target is clear.');

    await act(async () => {
      root.unmount();
    });
    window.removeEventListener('mindos:inbox-organize', onOrganize);
  });

  it('opens Review with item details selected from a sidebar file hash', async () => {
    window.history.replaceState(null, '', '/capture#queue?path=Inbox%2Fwechat-capture.txt');
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.querySelector('[data-inbox-page-title]')?.textContent).toBe('Review queue');
    expect(host.textContent).toContain('wechat-capture');
    expect(host.textContent).toContain('Item details');
    expect(host.textContent).toContain('Item preview');
    expect(host.textContent).not.toContain('Select an item');

    await act(async () => {
      root.unmount();
    });
  });

  it('shelves selected queue captures locally and restores them from Shelved', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Review queue');
    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.textContent).toContain('wechat-capture');

    const selectionButton = host.querySelector('button[aria-label="Select wechat-capture.txt"]') as HTMLButtonElement | null;
    expect(selectionButton).not.toBeNull();

    await act(async () => {
      selectionButton!.click();
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Shelve 1 selected');

    const shelveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Shelve 1 selected'));
    expect(shelveButton).not.toBeNull();

    await act(async () => {
      shelveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(JSON.parse(localStorage.getItem('mindos-inbox-shelved-paths') ?? '[]')).toEqual(['Inbox/wechat-capture.txt']);
    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.querySelector('button[aria-label="Select wechat-capture.txt"]')).toBeNull();

    const shelvedNavButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Shelved'));
    expect(shelvedNavButton).not.toBeNull();
    expect(shelvedNavButton?.textContent).toContain('1');

    await act(async () => {
      shelvedNavButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).not.toContain('Captured items you decided to keep out of the active queue for now.');
    expect(host.textContent).not.toContain('Shelved items');
    expect(host.textContent).toContain('wechat-capture');
    expect(host.textContent).not.toContain('agent-memory-notes');

    const restoreButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Restore');
    expect(restoreButton).not.toBeNull();

    await act(async () => {
      restoreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(JSON.parse(localStorage.getItem('mindos-inbox-shelved-paths') ?? '[]')).toEqual([]);
    expect(host.textContent).toContain('Nothing shelved');

    const pendingNavButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Pending'));
    expect(pendingNavButton).not.toBeNull();

    await act(async () => {
      pendingNavButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.textContent).toContain('wechat-capture');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows source-aware rows for captured social links in Review', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [
          {
            name: 'Video Notes.md',
            path: 'Inbox/Video Notes.md',
            size: 2048,
            modifiedAt: new Date().toISOString(),
            isAging: false,
            source: {
              kind: 'web',
              url: 'https://www.youtube.com/watch?v=abc',
              domain: 'youtube.com',
              siteName: 'YouTube',
              platform: 'youtube',
              platformLabel: 'YouTube',
              title: 'Video Notes',
            },
          },
        ],
      }),
    }));

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('YouTube');
    expect(host.querySelector('img[src="/source-icons/youtube.ico"]')).not.toBeNull();

    const row = Array.from(host.querySelectorAll('[role="button"]'))
      .find(button => button.textContent?.includes('Video Notes'));
    expect(row).not.toBeUndefined();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('youtube.com');

    await act(async () => {
      root.unmount();
    });
  });

  it('loads a selected markdown capture into the item content preview', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/file?path=Inbox%2Fclip.md')) {
        return {
          ok: true,
          json: async () => ({
            content: [
              '---',
              'title: Clip',
              'type: material',
              'source_type: web',
              'source_url: "https://github.com/GeminiLight/MindOS"',
              'source_platform: github',
              'captured_at: "2026-06-10T10:00:00.000Z"',
              '---',
              '',
              '***',
              'title: Clip',
              'type: material',
              'source_type: web',
              'source_url: "https://github.com/GeminiLight/MindOS"',
              'source_platform: github',
              'captured_at: "2026-06-10T10:00:00.000Z"',
              '----------------------------------------',
              '',
              '# Clip',
              '',
              'Preview body line from the saved capture.',
            ].join('\n'),
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          files: [{
            name: 'clip.md',
            path: 'Inbox/clip.md',
            size: 512,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const row = Array.from(host.querySelectorAll('[role="button"]'))
      .find(button => button.textContent?.includes('clip'));
    expect(row).not.toBeUndefined();

    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/file?path=Inbox%2Fclip.md&op=read_file');
    expect(host.textContent).toContain('Content preview');
    expect(host.textContent).toContain('Preview body line from the saved capture.');
    expect(host.textContent).not.toContain('source_url:');
    expect(host.textContent).not.toContain('captured_at:');

    await act(async () => {
      root.unmount();
    });
  });

  it('clears item details and queue selection after removing the selected capture', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    let deleted = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inbox' && init?.method === 'DELETE') {
        deleted = true;
        return {
          ok: true,
          json: async () => ({ archived: [{ original: 'keep-me.md', archivedPath: '.trash/keep-me.md' }], notFound: [] }),
        };
      }
      if (url.startsWith('/api/file?path=Inbox%2Fkeep-me.md')) {
        return {
          ok: true,
          json: async () => ({ content: '# Keep me\n\nSelected item body.' }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          files: deleted ? [] : [{
            name: 'keep-me.md',
            path: 'Inbox/keep-me.md',
            size: 512,
            modifiedAt: new Date().toISOString(),
            isAging: false,
          }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const selectionButton = host.querySelector('button[aria-label="Select keep-me.md"]') as HTMLButtonElement | null;
    expect(selectionButton).not.toBeNull();
    await act(async () => {
      selectionButton!.click();
      await new Promise(r => setTimeout(r, 0));
    });

    const row = Array.from(host.querySelectorAll('[role="button"]'))
      .find(button => button.textContent?.includes('keep-me'));
    expect(row).not.toBeUndefined();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('1 selected');
    expect(host.textContent).toContain('Item details');
    expect(host.textContent).toContain('Selected item body.');

    const removeButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Remove');
    expect(removeButton).not.toBeNull();
    await act(async () => {
      removeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ names: ['keep-me.md'] }),
    }));
    expect(host.textContent).toContain('Nothing waiting');
    expect(host.textContent).toContain('Select an item');
    expect(host.textContent).not.toContain('Item details');
    expect(host.textContent).not.toContain('1 selected');

    await act(async () => {
      root.unmount();
    });
  });

  it('uses organization records language in the Done tab instead of old import wording', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const doneTab = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Done'));
    expect(doneTab).not.toBeNull();

    await act(async () => {
      doneTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Recent organization records and undo history.');
    expect(host.textContent).toContain('Organization records');
    expect(host.textContent).toContain('No completed runs yet');
    expect(host.querySelector('[data-inbox-page-upload]')).toBeNull();
    expect(host.textContent).not.toContain('Import History');
    expect(host.textContent).not.toContain('AI organize results will appear here');

    await act(async () => {
      root.unmount();
    });
  });

  it('saves pasted text as an Inbox markdown capture', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return { ok: true, json: async () => ({ ai: { activeProvider: '', providers: [] } }) };
      }
      if (url === '/api/inbox' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ saved: [{ original: 'capture.md', path: 'Inbox/capture.md' }], skipped: [] }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'Decision rule: must keep durable notes.\n\nUse this for future Inbox review.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).not.toContain('Staged captures');
    expect(host.textContent).toContain('Draft note');
    expect(host.textContent).toContain('Text capture');
    expect(host.textContent).toContain('Text note');
    expect(host.textContent).toContain('Review pending');

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Decision rule'),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      body: expect.stringContaining('"captureIntent":"judgment"'),
    }));
    expect(host.textContent).toContain('Saved 1 capture to Inbox');
    expect(host.textContent).toContain('Staged locally. Review when you are ready.');

    await act(async () => {
      root.unmount();
    });
  });

  it('stages a typed note explicitly without saving it yet', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'First research note to keep for later.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    const stageButton = host.querySelector('[data-stage-note-action]') as HTMLButtonElement | null;
    expect(stageButton).not.toBeNull();
    expect(stageButton?.disabled).toBe(false);

    await act(async () => {
      stageButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(textarea!.value).toBe('');
    expect(host.textContent).toContain('Staged captures');
    expect(host.textContent).toContain('1 staged');
    expect(host.textContent).toContain('Note');
    expect(host.textContent).toContain('Text capture');
    expect(host.textContent).toContain('Review pending');

    await act(async () => {
      root.unmount();
    });
  });

  it('stages the current note with the keyboard shortcut', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'Shortcut staged note.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      textarea!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', metaKey: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(textarea!.value).toBe('');
    expect(host.textContent).toContain('Staged captures');
    expect(host.textContent).toContain('1 staged');
    expect(host.textContent).toContain('Note');

    await act(async () => {
      root.unmount();
    });
  });

  it('saves staged notes together with the current draft', async () => {
    const inboxPostBodies: Array<{ files: Array<{ name: string; content: string }> }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return { ok: true, json: async () => ({ ai: { activeProvider: '', providers: [] } }) };
      }
      if (url === '/api/inbox' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { files: Array<{ name: string; content: string }> };
        inboxPostBodies.push(body);
        return {
          ok: true,
          json: async () => ({
            saved: body.files.map(file => ({ original: file.name, path: `Inbox/${file.name}` })),
            skipped: [],
          }),
        };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

    await act(async () => {
      valueSetter?.call(textarea, 'First staged note.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    const stageButton = host.querySelector('[data-stage-note-action]') as HTMLButtonElement | null;
    await act(async () => {
      stageButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    await act(async () => {
      valueSetter?.call(textarea, 'Second draft note.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save 2 to Inbox'));
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(inboxPostBodies).toHaveLength(1);
    expect(inboxPostBodies[0].files).toHaveLength(2);
    expect(inboxPostBodies[0].files.map(file => file.content)).toEqual([
      'First staged note.',
      'Second draft note.',
    ]);
    expect(host.textContent).toContain('Saved 2 captures to Inbox');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps the visible attach control wired to the file input without extra source shortcuts', async () => {
    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(textarea).not.toBeNull();
    expect(fileInput).not.toBeNull();

    const fileClickSpy = vi.spyOn(fileInput!, 'click').mockImplementation(() => undefined);

    const attachButton = Array.from(host.querySelectorAll('button'))
      .find(item => item.textContent?.includes('Attach'));
    expect(attachButton).not.toBeNull();

    await act(async () => {
      attachButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fileClickSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('turns a pasted URL into a composer chip and captures it with the same primary action', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/settings') {
        return { ok: true, json: async () => ({ ai: { activeProvider: '', providers: [] } }) };
      }
      if (url === '/api/inbox/clip') {
        return { ok: true, json: async () => ({ title: 'Example Article' }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: (type: string) => type === 'text/plain' ? 'https://example.com/article' : '',
          files: [],
        },
      });
      textarea!.dispatchEvent(pasteEvent);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('URL');
    expect(host.textContent).toContain('example.com/article');
    expect(textarea!.value).toBe('');
    expect(host.textContent).toContain('Live source preview');
    expect(host.textContent).toContain('Web link');
    expect(host.textContent).toContain('Source preserved');
    expect(host.textContent).toContain('Review pending');
    expect(host.textContent).not.toContain('Inbox Organizer');
    expect(host.textContent).not.toContain('Built-in assistant');
    expect(host.textContent).not.toContain('Organize selected');

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox/clip', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.com/article'),
    }));

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps a pasted URL inside the draft when the composer already has note text', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/settings') {
        return { ok: true, json: async () => ({ ai: { activeProvider: '', providers: [] } }) };
      }
      if (url === '/api/inbox' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ saved: [{ original: 'capture.md', path: 'Inbox/capture.md' }], skipped: [] }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

    await act(async () => {
      valueSetter?.call(textarea, 'Reading note:\n');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      textarea!.selectionStart = textarea!.value.length;
      textarea!.selectionEnd = textarea!.value.length;

      const pasteEvent = new Event('paste', { bubbles: true });
      const preventDefaultSpy = vi.spyOn(pasteEvent, 'preventDefault');
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: (type: string) => type === 'text/plain' ? 'https://example.com/inside-note' : '',
          files: [],
        },
      });
      textarea!.dispatchEvent(pasteEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      valueSetter?.call(textarea, `${textarea!.value}https://example.com/inside-note`);
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(textarea!.value).toContain('https://example.com/inside-note');
    expect(host.textContent).not.toContain('Web link');
    expect(host.textContent).not.toContain('Source preserved');
    expect(host.querySelector('[aria-label="Remove URL"]')).toBeNull();
    expect(host.textContent).toContain('Draft note');

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.com/inside-note'),
    }));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/inbox/clip', expect.anything());

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps a URL chip after clip failure', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/inbox/clip') {
        return { ok: false, status: 422, json: async () => ({ error: 'Clip failed' }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: (type: string) => type === 'text/plain' ? 'https://example.com/fail' : '',
          files: [],
        },
      });
      textarea!.dispatchEvent(pasteEvent);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('example.com/fail');
    expect(host.textContent).toContain('Source preserved');
    expect(host.textContent).toContain('Review pending');

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox/clip', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.com/fail'),
    }));
    expect(host.textContent).toContain('example.com/fail');
    expect(host.textContent).toContain('Live source preview');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows an in-page partial saved state when one capture item fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inbox' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ saved: [{ original: 'capture.md', path: 'Inbox/capture.md' }], skipped: [] }) };
      }
      if (url === '/api/inbox/clip') {
        return { ok: false, status: 422, json: async () => ({ error: 'Clip failed' }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();

    await act(async () => {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: (type: string) => type === 'text/plain' ? 'https://example.com/fail' : '',
          files: [],
        },
      });
      textarea!.dispatchEvent(pasteEvent);
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'Decision note to keep');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save 2 to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('Decision note to keep'),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/inbox/clip', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.com/fail'),
    }));
    expect(host.textContent).toContain('1 saved, 1 need retry');
    expect(host.textContent).toContain('Unfinished items stayed in the composer so you can retry or remove them.');
    expect(host.textContent).toContain('example.com/fail');
    expect(host.textContent).not.toContain('Saved 1 capture to Inbox');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps a pending file chip after upload save failure', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inbox' && init?.method === 'POST') {
        return { ok: false, status: 500, json: async () => ({ error: 'Disk write failed' }) };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const file = new File(['notes'], 'notes.md', { type: 'text/markdown' });

    await act(async () => {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '',
          files: [file],
        },
      });
      textarea!.dispatchEvent(pasteEvent);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('notes.md');
    expect(host.textContent).toContain('Original file');
    expect(host.textContent).toContain('Review pending');
    expect(host.textContent).toContain('Staged captures');

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('notes.md');

    await act(async () => {
      root.unmount();
    });
  });

  it('removes only the saved same-name file when a partial upload leaves another pending', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inbox' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            saved: [{ original: 'notes.md', path: 'Inbox/notes.md' }],
            skipped: [{ name: 'notes.md', reason: 'Disk write failed' }],
          }),
        };
      }
      return { ok: true, json: async () => ({ files: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    const savedFile = new File(['saved'], 'notes.md', { type: 'text/markdown', lastModified: 1 });
    const failedFile = new File(['still here'], 'notes.md', { type: 'text/markdown', lastModified: 2 });

    await act(async () => {
      const pasteEvent = new Event('paste', { bubbles: true });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          getData: () => '',
          files: [savedFile, failedFile],
        },
      });
      textarea!.dispatchEvent(pasteEvent);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('2 staged');
    expect(host.querySelectorAll('[aria-label="Remove File"]')).toHaveLength(2);

    const captureButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save 2 to Inbox'));
    expect(captureButton).not.toBeNull();

    await act(async () => {
      captureButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('still here'),
    }));
    expect(host.textContent).toContain('1 saved, 1 need retry');
    expect(host.querySelectorAll('[aria-label="Remove File"]')).toHaveLength(1);
    expect(host.textContent).toContain('notes.md');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows a retryable error when Inbox loading fails in the Review tab', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'MIND_ROOT is not configured' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('MIND_ROOT is not configured');
    expect(host.textContent).toContain('Retry');
    expect(host.textContent).not.toContain('Nothing waiting');

    await act(async () => {
      root.unmount();
    });
  });

  it('keeps a queue row when archive response reports notFound', async () => {
    window.history.replaceState(null, '', '/capture#queue');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inbox' && init?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ archived: [], notFound: ['ghost.md'] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          files: [
            {
              name: 'ghost.md',
              path: 'Inbox/ghost.md',
              size: 120,
              modifiedAt: new Date().toISOString(),
              isAging: false,
            },
          ],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const InboxView = (await import('@/components/InboxView')).default;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<InboxView />);
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('ghost');

    const removeButton = Array.from(host.querySelectorAll('button[title="Remove from Inbox"]'))[0];
    expect(removeButton).not.toBeUndefined();

    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ names: ['ghost.md'] }),
    }));
    expect(host.textContent).toContain('ghost');

    await act(async () => {
      root.unmount();
    });
  });

});
