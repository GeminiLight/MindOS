import { describe, expect, it } from 'vitest';
import type { MindSystemSlot } from '@/lib/mind-system';
import type { FileNode } from '@/lib/types';
import { splitMindFileTreeSections } from '@/components/file-tree/mind-file-tree-sections';

const slots: MindSystemSlot[] = [
  { key: 'dao', systemId: 'MIND_DAO', label: '道', path: 'MIND_DAO', role: 'world-model', order: 10, enabled: true },
  { key: 'fa', systemId: 'MIND_FA', label: '法', path: 'MIND_FA', role: 'principles', order: 20, enabled: true },
  { key: 'shu', systemId: 'MIND_SHU', label: '术', path: 'MIND_SHU', role: 'methods', order: 30, enabled: true },
  { key: 'qi', systemId: 'MIND_QI', label: '器', path: 'MIND_QI', role: 'tools-assets', order: 40, enabled: true },
];

function directory(name: string, path = name, extra: Partial<FileNode> = {}): FileNode {
  return {
    name,
    path,
    type: 'directory',
    children: [],
    ...extra,
  };
}

describe('splitMindFileTreeSections', () => {
  it('renders built-in Mind System paths as ordered readonly display nodes', () => {
    const sections = splitMindFileTreeSections([
      directory('MIND_QI', 'MIND_QI', { isSpace: true }),
      directory('Research', 'Research', { isSpace: true }),
      directory('MIND_DAO', 'MIND_DAO', { isSpace: true }),
      { name: 'notes.md', path: 'notes.md', type: 'file', extension: '.md' },
      directory('MIND_FA', 'MIND_FA', { isSpace: true }),
      directory('MIND_SHU', 'MIND_SHU', { isSpace: true }),
    ], slots);

    expect(sections.mindSystemTree.map(node => node.name)).toEqual(['道', '法', '术', '器']);
    expect(sections.mindSystemTree.map(node => node.path)).toEqual(['MIND_DAO', 'MIND_FA', 'MIND_SHU', 'MIND_QI']);
    expect(sections.mindSystemTree.map(node => node.mindSystemKey)).toEqual(['dao', 'fa', 'shu', 'qi']);
    expect(sections.mindSystemTree.every(node => node.isSpace && node.isMindSystem)).toBe(true);
    expect(sections.spaceTree.map(node => node.name)).toEqual(['Research']);
    expect(sections.otherFileTree.map(node => node.name)).toEqual(['notes.md']);
  });

  it('keeps Inbox out of the section trees because it has a dedicated sidebar entry', () => {
    const sections = splitMindFileTreeSections([
      directory('Inbox', 'Inbox', { isSpace: true }),
      directory('Projects', 'Projects', { isSpace: true }),
    ], slots);

    expect(sections.allTree.map(node => node.name)).toEqual(['Projects']);
  });
});
