// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '@/lib/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/components/Breadcrumb', () => ({
  default: ({ filePath }: { filePath: string }) => <nav>{filePath}</nav>,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      dirView: {
        emptyFolder: 'Empty',
        newFile: 'New file',
        gridView: 'Grid view',
        listView: 'List view',
        fileCount: (n: number) => `${n} files`,
      },
      home: {
        rootLevel: 'Root',
        relativeTime: {
          justNow: 'just now',
          minutesAgo: (n: number) => `${n}m ago`,
          hoursAgo: (n: number) => `${n}h ago`,
          daysAgo: (n: number) => `${n}d ago`,
        },
      },
    },
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ totalCount, itemContent, components }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
    components?: { List?: React.ComponentType<React.PropsWithChildren> };
  }) => {
    const List = components?.List ?? (({ children }: React.PropsWithChildren) => <div>{children}</div>);
    return (
      <List>
        {Array.from({ length: Math.min(totalCount, 5) }).map((_, index) => (
          <React.Fragment key={index}>{itemContent(index)}</React.Fragment>
        ))}
      </List>
    );
  },
  VirtuosoGrid: ({ totalCount, itemContent, components }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
    components?: {
      List?: React.ComponentType<React.PropsWithChildren>;
      Item?: React.ComponentType<React.PropsWithChildren>;
    };
  }) => {
    const List = components?.List ?? (({ children }: React.PropsWithChildren) => <div>{children}</div>);
    const Item = components?.Item ?? (({ children }: React.PropsWithChildren) => <div>{children}</div>);
    return (
      <List>
        {Array.from({ length: Math.min(totalCount, 5) }).map((_, index) => (
          <Item key={index}>{itemContent(index)}</Item>
        ))}
      </List>
    );
  },
}));

function makeEntries(count: number): FileNode[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `note-${index}.md`,
    path: `Big/note-${index}.md`,
    type: 'file',
    extension: '.md',
    mtime: Date.now(),
  }));
}

describe('DirView large directory virtualization', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    localStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  it('virtualizes large grid directories instead of mounting every entry', async () => {
    const { default: DirView } = await import('@/components/DirView');

    await act(async () => {
      root.render(<DirView dirPath="Big" entries={makeEntries(201)} />);
      await Promise.resolve();
    });

    expect(host.querySelector('[data-dir-view-virtualized="grid"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-dir-view-entry]')).toHaveLength(5);
  });

  it('virtualizes large list directories instead of mounting every entry', async () => {
    localStorage.setItem('mindos-dir-view', 'list');
    const { default: DirView } = await import('@/components/DirView');

    await act(async () => {
      root.render(<DirView dirPath="Big" entries={makeEntries(201)} />);
      await Promise.resolve();
    });

    expect(host.querySelector('[data-dir-view-virtualized="list"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-dir-view-entry]')).toHaveLength(5);
  });
});
