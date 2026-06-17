import type { MindSystemSlot } from '@/lib/mind-system';
import type { FileNode } from '@/lib/types';

export interface MindFileTreeSections {
  mindSystemTree: FileNode[];
  spaceTree: FileNode[];
  otherFileTree: FileNode[];
  allTree: FileNode[];
}

export function splitMindFileTreeSections(
  nodes: FileNode[],
  slots: MindSystemSlot[],
): MindFileTreeSections {
  const slotByTopLevel = buildMindSystemSlotMap(slots);
  const mindSystemByKey = new Map<MindSystemSlot['key'], FileNode>();
  const spaceTree: FileNode[] = [];
  const otherFileTree: FileNode[] = [];

  for (const node of nodes) {
    if (isRootInboxNode(node)) continue;

    if (node.type === 'directory') {
      const slot = slotByTopLevel.get(normalizeTopLevelPath(node.path || node.name));
      if (slot) {
        mindSystemByKey.set(slot.key, toMindSystemTreeNode(node, slot));
        continue;
      }

      if (node.isSpace) {
        spaceTree.push(node);
        continue;
      }
    }

    otherFileTree.push(node);
  }

  const mindSystemTree = slots
    .map(slot => mindSystemByKey.get(slot.key))
    .filter((node): node is FileNode => Boolean(node));

  return {
    mindSystemTree,
    spaceTree,
    otherFileTree,
    allTree: [...mindSystemTree, ...spaceTree, ...otherFileTree],
  };
}

function buildMindSystemSlotMap(slots: MindSystemSlot[]): Map<string, MindSystemSlot> {
  const map = new Map<string, MindSystemSlot>();
  for (const slot of slots) {
    for (const candidate of [slot.path, slot.systemId]) {
      const normalized = normalizeTopLevelPath(candidate);
      if (normalized) map.set(normalized, slot);
    }
  }
  return map;
}

function normalizeTopLevelPath(value: string): string {
  return value.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
}

function isRootInboxNode(node: FileNode): boolean {
  return node.type === 'directory' && normalizeTopLevelPath(node.path || node.name) === 'Inbox';
}

function toMindSystemTreeNode(node: FileNode, slot: MindSystemSlot): FileNode {
  return {
    ...node,
    name: slot.label,
    isSpace: true,
    isMindSystem: true,
    mindSystemKey: slot.key,
  };
}
