// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '@/lib/types';
import DirView from '@/components/DirView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/Breadcrumb', () => ({
  default: ({ filePath }: { filePath: string }) => <nav>{filePath}</nav>,
}));
vi.mock('@/lib/stores/locale-store', async () => {
  const { messages } = await import('@/lib/i18n');
  return { useLocale: () => ({ locale: 'en', t: messages.en }) };
});
vi.mock('react-virtuoso', () => ({
  Virtuoso: () => null,
  VirtuosoGrid: () => null,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entries: FileNode[] = [
  { name: 'alpha.md', path: 'Space/alpha.md', type: 'file', extension: '.md', mtime: Date.now() },
  { name: 'beta.md', path: 'Space/beta.md', type: 'file', extension: '.md', mtime: Date.now() },
];

describe('DirView storage and fetch hardening', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ fileCount: 2 }) })));
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders when localStorage throws a SecurityError', async () => {
    const throwSecurity = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    vi.spyOn(localStorage, 'getItem').mockImplementation(throwSecurity);
    vi.spyOn(localStorage, 'setItem').mockImplementation(throwSecurity);

    await act(async () => {
      root.render(<DirView dirPath="Space" entries={entries} />);
    });
    expect(host.textContent).toContain('alpha.md');
    expect(host.textContent).toContain('beta.md');

    // Toggling the view preference must not crash either.
    const listButton = host.querySelector<HTMLButtonElement>('button[title="List view"], button[aria-label="List view"]');
    if (listButton) {
      expect(() => act(() => { listButton.click(); })).not.toThrow();
    }
  });

  it('aborts the space file-count request on unmount and ignores non-2xx responses', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return Promise.resolve({ ok: false, status: 500, json: async () => ({ fileCount: 99 }) });
    }));

    await act(async () => {
      root.render(
        <DirView
          dirPath="Space"
          entries={entries}
          spacePreview={{ instructionLines: [], readmeLines: [], isTemplate: true, readmeIsTemplate: true }}
        />,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    // A failed request must not leak the body's count into the UI.
    expect(host.textContent).not.toContain('99');

    await act(async () => { root.unmount(); });
    expect(capturedSignal?.aborted).toBe(true);
    root = createRoot(host);
  });
});
