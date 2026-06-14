// @vitest-environment node
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPage from '@/app/view/[...path]/page';

const mocks = vi.hoisted(() => ({
  getFileContent: vi.fn(),
  getFileTree: vi.fn(),
  isDirectory: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mocks.existsSync,
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found');
  }),
}));

vi.mock('@/lib/fs', () => ({
  createFile: vi.fn(),
  getDirEntries: vi.fn(),
  getFileContent: mocks.getFileContent,
  getFileTree: mocks.getFileTree,
  getMindRoot: vi.fn(() => '/tmp/mind-root'),
  getSpacePreview: vi.fn(),
  isDirectory: mocks.isDirectory,
  saveFileContent: vi.fn(),
}));

vi.mock('@/lib/core/security', () => ({
  resolveExistingSafe: vi.fn((_root: string, filePath: string) => `/tmp/mind-root/${filePath}`),
}));

vi.mock('@/lib/space-records', () => ({
  getBuiltInMindSystemSpace: vi.fn(),
}));

vi.mock('@/components/DirView', () => ({
  default: () => React.createElement('div'),
}));

vi.mock('@/components/InboxView', () => ({
  default: () => React.createElement('div'),
}));

async function renderView(path: string[]) {
  const element = await ViewPage({ params: Promise.resolve({ path }) });
  expect(React.isValidElement(element)).toBe(true);
  return element as React.ReactElement;
}

describe('view route client remount key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.getFileContent.mockReturnValue('# Current file');
    mocks.getFileTree.mockReturnValue([]);
    mocks.isDirectory.mockReturnValue(false);
  });

  it('keys the client page by file path for normal text files', async () => {
    const element = await renderView(['notes', 'current.md']);

    expect(element.key).toBe('notes/current.md');
  });

  it('keys the client page by file path for binary files', async () => {
    const element = await renderView(['attachments', 'deck.pdf']);

    expect(element.key).toBe('attachments/deck.pdf');
  });

  it('keys the draft client page by file path', async () => {
    mocks.getFileContent.mockImplementation(() => {
      throw new Error('missing');
    });

    const element = await renderView(['Untitled.md']);

    expect(element.key).toBe('Untitled.md');
  });
});
