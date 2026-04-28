import type { FileNode } from '@/lib/types';

export interface RelativeTimeOptions {
  now?: Date;
}

export const flattenFiles = (nodes: FileNode[]): FileNode[] => {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    if (node.children?.length) result.push(...flattenFiles(node.children));
  }
  return result;
};

export const findNode = (nodes: FileNode[], targetPath: string): FileNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (!node.children?.length) continue;
    const found = findNode(node.children, targetPath);
    if (found) return found;
  }
  return null;
};

export const sortFileNodes = (nodes: FileNode[]): FileNode[] => [...nodes].sort((a, b) => {
  if (a.type === 'directory' && b.type !== 'directory') return -1;
  if (a.type !== 'directory' && b.type === 'directory') return 1;
  return a.name.localeCompare(b.name);
});

export const getChildrenAtPath = (nodes: FileNode[], path: string): FileNode[] | null => {
  if (!path) return nodes;
  const node = findNode(nodes, path);
  return node?.type === 'directory' ? (node.children ?? []) : null;
};

export const getParentPath = (path: string): string => {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.substring(0, idx);
};

export const formatRelativeTime = (mtimeMs: number, options: RelativeTimeOptions = {}): string => {
  const now = options.now ?? new Date();
  const diff = now.getTime() - mtimeMs;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(mtimeMs).toLocaleDateString();
};
