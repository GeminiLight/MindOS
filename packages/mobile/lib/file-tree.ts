import type { FileNode } from '@/lib/types';

type FilesApiResponse =
  | FileNode[]
  | string[]
  | { tree?: unknown; files?: unknown };

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

export const buildFileTreeFromPaths = (paths: string[]): FileNode[] => {
  const root: FileNode[] = [];
  const directories = new Map<string, FileNode>();

  for (const rawPath of paths) {
    const normalized = rawPath.split('\\').join('/').replace(/^\/+|\/+$/g, '');
    if (!normalized) continue;

    const parts = normalized.split('/').filter(Boolean);
    let siblings = root;
    let parentPath = '';

    parts.forEach((part, index) => {
      const nodePath = parentPath ? `${parentPath}/${part}` : part;
      const isFile = index === parts.length - 1;

      if (isFile) {
        if (!siblings.some((node) => node.path === nodePath)) {
          siblings.push({
            type: 'file',
            name: part,
            path: nodePath,
            extension: getExtension(part),
          });
        }
        return;
      }

      let directory = directories.get(nodePath);
      if (!directory) {
        directory = {
          type: 'directory',
          name: part,
          path: nodePath,
          children: [],
        };
        directories.set(nodePath, directory);
        siblings.push(directory);
      }

      siblings = directory.children ?? [];
      parentPath = nodePath;
    });
  }

  return sortTree(root);
};

export const normalizeFilesResponseToTree = (data: FilesApiResponse): FileNode[] => {
  if (Array.isArray(data)) {
    if (data.every(isFileNode)) return sortTree(data);
    if (data.every((item) => typeof item === 'string')) return buildFileTreeFromPaths(data);
  }

  if (!Array.isArray(data) && data && typeof data === 'object') {
    if (Array.isArray(data.tree)) return normalizeFilesResponseToTree(data.tree as FileNode[] | string[]);
    if (Array.isArray(data.files)) return normalizeFilesResponseToTree(data.files as FileNode[] | string[]);
  }

  throw new Error('Invalid response format');
};

export const getChildrenAtPath = (nodes: FileNode[], path: string): FileNode[] | null => {
  if (!path) return nodes;
  const node = findNode(nodes, path);
  return node?.type === 'directory' ? (node.children ?? []) : null;
};

export const getParentPath = (path: string): string => {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.substring(0, idx);
};

function isFileNode(value: unknown): value is FileNode {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as FileNode).name === 'string'
    && typeof (value as FileNode).path === 'string'
    && ((value as FileNode).type === 'file' || (value as FileNode).type === 'directory');
}

function getExtension(fileName: string): string | undefined {
  const idx = fileName.lastIndexOf('.');
  if (idx <= 0 || idx === fileName.length - 1) return undefined;
  return fileName.slice(idx);
}

function sortTree(nodes: FileNode[]): FileNode[] {
  return sortFileNodes(nodes).map((node) => ({
    ...node,
    children: node.children ? sortTree(node.children) : undefined,
  }));
}

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
