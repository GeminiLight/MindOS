'use client';

import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import SidebarLayout from './SidebarLayout';
import { FileNode } from '@/lib/types';

/**
 * Structural sharing for FileNode trees.
 * Recursively compares new and old trees — if a node hasn't changed,
 * returns the old reference so React.memo can skip re-rendering it.
 * This makes router.refresh() much cheaper: only truly changed nodes
 * get new references, while the rest keep their identity.
 */
function shareFileTree(next: FileNode[], prev: FileNode[]): FileNode[] {
  if (next === prev) return prev;
  if (next.length !== prev.length) return next.map((n, i) => shareFileNode(n, prev.find(p => p.path === n.path)));

  let allSame = true;
  const result: FileNode[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const shared = shareFileNode(next[i], prev[i]?.path === next[i].path ? prev[i] : prev.find(p => p.path === next[i].path));
    result[i] = shared;
    if (shared !== prev[i]) allSame = false;
  }
  return allSame ? prev : result;
}

function shareFileNode(next: FileNode, prev: FileNode | undefined): FileNode {
  if (!prev) return next;
  if (next.path !== prev.path) return next;
  if (next.type !== prev.type) return next;
  if (next.name !== prev.name) return next;
  if (next.extension !== prev.extension) return next;
  if (next.isSpace !== prev.isSpace) return next;

  // For directories, recursively share children
  if (next.children && prev.children) {
    const sharedChildren = shareFileTree(next.children, prev.children);
    if (sharedChildren === prev.children && next.name === prev.name) {
      // SpacePreview might have changed even if children didn't
      if (next.spacePreview === prev.spacePreview ||
          (next.spacePreview && prev.spacePreview &&
           next.spacePreview.lastCompiled === prev.spacePreview.lastCompiled &&
           next.spacePreview.isTemplate === prev.spacePreview.isTemplate)) {
        return prev; // Nothing changed — reuse old reference
      }
    }
    // Children or preview changed — return new node with shared children
    return { ...next, children: sharedChildren };
  }

  // File node: same path + name + extension = same node
  return prev;
}

interface ShellLayoutProps {
  fileTree: FileNode[];
  children: React.ReactNode;
}

export default function ShellLayout({ fileTree, children }: ShellLayoutProps) {
  const pathname = usePathname();
  const prevTreeRef = useRef<FileNode[]>(fileTree);

  // Apply structural sharing: reuse old node references where nothing changed
  const sharedTree = shareFileTree(fileTree, prevTreeRef.current);
  prevTreeRef.current = sharedTree;

  if (pathname === '/login') return <>{children}</>;
  return <SidebarLayout fileTree={sharedTree}>{children}</SidebarLayout>;
}
