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
    expect(host.textContent).toContain('Paste anything. Keep the source. Review later.');
    expect(host.textContent).not.toContain('CaptureSave only');
    expect(host.textContent).not.toContain('Capture anythingCapture anything');
    expect(host.querySelector('textarea')?.getAttribute('placeholder')).toContain('Paste a link, write a note');
    expect(host.querySelector('textarea')?.getAttribute('aria-label')).toContain('Add a link, note, file');
    expect(host.textContent).toContain('Attach');
    expect(host.textContent).toContain('Save to Inbox');
    expect(host.textContent).toContain('Next action');
    expect(host.textContent).toContain('Save only');
    expect(host.textContent).not.toContain('Suggested: Save only');
    expect(host.textContent).not.toContain('Choose intent');
    expect(host.textContent).toContain('Local first · Source preserved · Review later');
    expect(host.textContent).toContain('Links, notes, files, drops');
    expect(host.textContent).toContain('Link');
    expect(host.textContent).toContain('YouTube, Bilibili, XHS');
    expect(host.textContent).toContain('Note');
    expect(host.textContent).toContain('File');
    expect(host.textContent).toContain('Drop');
    expect(host.textContent).toContain('AI waits for Review');
    expect(host.textContent).toContain('Live source preview');
    expect(host.textContent).toContain('Paste any source');
    expect(host.textContent).toContain('Links, notes, files, and dropped sources are staged here before they enter the Review queue.');
    const livePreview = host.querySelector('section[aria-label="Live source preview"]');
    const livePreviewAside = livePreview?.closest('aside');
    expect(livePreviewAside?.className).not.toContain('sticky');
    expect(livePreviewAside?.className).not.toContain('top-');
    expect(host.textContent).not.toContain('Detected');
    expect(host.textContent).not.toContain('Documents');
    expect(host.textContent).not.toContain('Tables');
    expect(host.textContent).not.toContain('Screenshots');
    expect(host.textContent).toContain('Review queue');
    expect(host.textContent).toContain('Scroll here when you are ready to clear what you captured.');
    expect(host.textContent).toContain('Inbox Organization Agent');
    expect(host.textContent).toContain('Open Review to select captures. The Agent proposes changes before writing to your Mind.');
    expect(host.textContent).toContain('Review 2 pending');
    expect(host.textContent).not.toContain('0 selected');
    expect(host.textContent).not.toContain('Select all');
    expect(host.textContent).not.toContain('Organize selected');
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

  it('puts the Inbox Organization Agent above a multi-select queue and keeps details item-only', async () => {
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
    expect(host.textContent).toContain('Select captures for the Inbox Organization Agent.');
    expect(host.textContent).toContain('Inbox Organization Agent');
    expect(host.textContent).toContain('0 selected');
    expect(host.textContent).toContain('Select all');
    expect(host.textContent).toContain('Select aging');
    expect(host.textContent).toContain('Organize selected');
    expect(Array.from(host.querySelectorAll('button'))
      .some(button => button.textContent?.trim().includes('Organize selected'))).toBe(true);
    expect(host.textContent).toContain('agent-memory-notes');
    expect(host.textContent).toContain('Select an item');
    expect(host.textContent).not.toContain('Scope');
    expect(host.textContent).not.toContain('Review before write');
    expect(host.textContent).not.toContain('Undo history');
    expect(host.textContent).not.toContain('Item details');

    const checkbox = host.querySelector('input[aria-label="Select wechat-capture.txt"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();

    await act(async () => {
      checkbox!.click();
      await new Promise(r => setTimeout(r, 0));
    });

    expect(checkbox!.checked).toBe(true);
    expect(host.textContent).toContain('1 selected');
    expect(host.textContent).toContain('Organize 1 selected');

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

    await act(async () => {
      root.unmount();
    });
    window.removeEventListener('mindos:inbox-organize', onOrganize);
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
              'source: "https://github.com/GeminiLight/MindOS"',
              '---',
              '',
              '***',
              'title: Clip',
              'source: "https://github.com/GeminiLight/MindOS"',
              'author: GeminiLight',
              'site: github.com',
              'clipped: "2026-06-10T10:00:00.000Z"',
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
    expect(host.textContent).not.toContain('source:');
    expect(host.textContent).not.toContain('clipped:');

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

    const checkbox = host.querySelector('input[aria-label="Select keep-me.md"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox!.click();
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

  it('uses Inbox Agent language in the Done tab instead of old import wording', async () => {
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

    expect(host.textContent).toContain('Recent Agent runs and undo records.');
    expect(host.textContent).toContain('Agent runs');
    expect(host.textContent).toContain('No completed runs yet');
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
      valueSetter?.call(textarea, 'AI Agent article notes\n\nCapture this.');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(host.textContent).toContain('Staged captures');
    expect(host.textContent).toContain('1 staged');
    expect(host.textContent).toContain('Text capture');
    expect(host.textContent).toContain('Text note');
    expect(host.textContent).toContain('Review pending');

    const intentButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save only'));
    expect(intentButton).not.toBeNull();

    await act(async () => {
      intentButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    const judgmentOption = Array.from(document.body.querySelectorAll('button[role="option"]'))
      .find(button => button.textContent?.includes('Extract judgment'));
    expect(judgmentOption).not.toBeNull();

    await act(async () => {
      judgmentOption!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    const saveButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Save to Inbox'));
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/inbox', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('AI Agent article notes'),
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
    expect(host.textContent).not.toContain('Inbox Organization Agent');

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
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, 'Decision note to keep');
      textarea!.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
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
