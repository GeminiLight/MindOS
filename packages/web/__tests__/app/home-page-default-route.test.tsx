import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';

const mockReadSetupPending = vi.hoisted(() => vi.fn(() => false));
const mockGetRecentlyModified = vi.hoisted(() => vi.fn(() => []));
const mockListWorkspaceSpaces = vi.hoisted(() => vi.fn(() => []));

vi.mock('@/lib/setup-state', () => ({
  readSetupPending: mockReadSetupPending,
}));

vi.mock('@/lib/fs', () => ({
  getRecentlyModified: mockGetRecentlyModified,
  getMindRoot: () => '/tmp/mind',
}));

vi.mock('@/lib/renderers/registry', () => ({
  getAllRenderers: () => [],
}));

vi.mock('@/lib/space-records', () => ({
  listWorkspaceSpaces: mockListWorkspaceSpaces,
}));

vi.mock('@/components/HomeContent', () => ({
  default: ({ recent, existingFiles, spaces }: {
    recent: Array<{ path: string; mtime: number }>;
    existingFiles: string[];
    spaces: unknown[];
  }) => (
    <div
      data-testid="home-content"
      data-recent-count={recent.length}
      data-existing-count={existingFiles.length}
      data-space-count={spaces.length}
    />
  ),
}));

describe('HomePage default route', () => {
  beforeEach(() => {
    mockReadSetupPending.mockReset();
    mockReadSetupPending.mockReturnValue(false);
    mockGetRecentlyModified.mockReset();
    mockGetRecentlyModified.mockReturnValue([{ path: 'Notes/today.md', mtime: 1 }]);
    mockListWorkspaceSpaces.mockReset();
    mockListWorkspaceSpaces.mockReturnValue([{ name: 'Notes', path: 'Notes/', fileCount: 1, description: '' }]);
  });

  it('renders the product Home after setup is complete', () => {
    const element = HomePage();

    expect(React.isValidElement(element)).toBe(true);
    const html = renderToStaticMarkup(element as React.ReactElement);
    expect(html).toContain('data-testid="home-content"');
    expect(html).toContain('data-recent-count="1"');
    expect(html).toContain('data-space-count="1"');
    expect(html).not.toContain('href="/echo/overview"');
  });

  it('keeps setup as the first-run destination', () => {
    mockReadSetupPending.mockReturnValue(true);

    const element = HomePage();
    expect(React.isValidElement(element)).toBe(true);
    expect(renderToStaticMarkup(element as React.ReactElement)).toContain('href="/setup"');
  });
});
