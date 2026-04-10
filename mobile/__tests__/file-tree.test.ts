import { describe, expect, it } from 'vitest';
import { findNode, flattenFiles, formatRelativeTime, sortFileNodes } from '@/lib/file-tree';
import type { FileNode } from '@/lib/types';

const tree: FileNode[] = [
  {
    type: 'directory',
    name: 'inbox',
    path: 'inbox',
    children: [
      {
        type: 'file',
        name: '2026-04-11.md',
        path: 'inbox/2026-04-11.md',
        extension: '.md',
        mtime: 100,
      },
    ],
  },
  {
    type: 'file',
    name: 'root.md',
    path: 'root.md',
    extension: '.md',
    mtime: 200,
  },
];

describe('file-tree', () => {
  it('flattens nested tree into files only', () => {
    expect(flattenFiles(tree).map((node) => node.path)).toEqual(['inbox/2026-04-11.md', 'root.md']);
  });

  it('returns empty list for empty tree', () => {
    expect(flattenFiles([])).toEqual([]);
  });

  it('finds node recursively by path', () => {
    expect(findNode(tree, 'inbox/2026-04-11.md')?.name).toBe('2026-04-11.md');
  });

  it('returns null when node is missing', () => {
    expect(findNode(tree, 'missing.md')).toBeNull();
  });

  it('sorts directories before files and then alphabetically', () => {
    const nodes: FileNode[] = [
      { type: 'file', name: 'zeta.md', path: 'zeta.md', extension: '.md' },
      { type: 'directory', name: 'beta', path: 'beta' },
      { type: 'file', name: 'alpha.md', path: 'alpha.md', extension: '.md' },
      { type: 'directory', name: 'alpha', path: 'alpha' },
    ];

    expect(sortFileNodes(nodes).map((node) => node.name)).toEqual(['alpha', 'beta', 'alpha.md', 'zeta.md']);
  });

  it('formats relative time for same minute, hours, days, and older dates', () => {
    const now = new Date('2026-04-11T10:00:00');
    expect(formatRelativeTime(now.getTime(), { now })).toBe('just now');
    expect(formatRelativeTime(new Date('2026-04-11T09:52:00').getTime(), { now })).toBe('8m ago');
    expect(formatRelativeTime(new Date('2026-04-11T07:00:00').getTime(), { now })).toBe('3h ago');
    expect(formatRelativeTime(new Date('2026-04-09T10:00:00').getTime(), { now })).toBe('2d ago');
    expect(formatRelativeTime(new Date('2026-03-30T10:00:00').getTime(), { now })).toBe('3/30/2026');
  });
});
