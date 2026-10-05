import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { selectHomeRecentNotes } from '@/lib/home-recent-notes';

const roots: string[] = [];
function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-home-recent-'));
  roots.push(root);
  return root;
}
function write(root: string, file: string) {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, file);
  return absolute;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it('puts a real note before untouched Space scaffold files while keeping scaffolds as fallback', () => {
  const root = vault();
  write(root, 'Inbox/README.md'); write(root, 'Inbox/INSTRUCTION.md'); write(root, 'Notes/Research.md');
  const recent = [
    { path: 'Inbox/README.md', mtime: 3 },
    { path: 'Inbox/INSTRUCTION.md', mtime: 2 },
    { path: 'Notes/Research.md', mtime: 1 },
  ];
  expect(selectHomeRecentNotes(recent, root, 3).map(file => file.path)).toEqual([
    'Notes/Research.md', 'Inbox/README.md', 'Inbox/INSTRUCTION.md',
  ]);
  expect(selectHomeRecentNotes(recent.slice(0, 2), root, 3)).toEqual(recent.slice(0, 2));
});

it('keeps an edited Space README and an ordinary README in their recent positions', () => {
  const root = vault();
  const edited = write(root, 'Inbox/README.md'); write(root, 'Inbox/INSTRUCTION.md');
  write(root, 'Docs/README.md'); write(root, 'Notes/Research.md');
  const editedAt = new Date(Date.now() + 60_000);
  fs.utimesSync(edited, editedAt, editedAt);
  const recent = [
    { path: 'Inbox/README.md', mtime: 4 },
    { path: 'Docs/README.md', mtime: 3 },
    { path: 'Inbox/INSTRUCTION.md', mtime: 2 },
    { path: 'Notes/Research.md', mtime: 1 },
  ];
  expect(selectHomeRecentNotes(recent, root, 3).map(file => file.path)).toEqual([
    'Inbox/README.md', 'Docs/README.md', 'Notes/Research.md',
  ]);
});

it('does not fail when a stale recent-file entry disappears', () => {
  const root = vault();
  expect(selectHomeRecentNotes([{ path: 'Missing/README.md', mtime: 1 }], root, 3))
    .toEqual([{ path: 'Missing/README.md', mtime: 1 }]);
  expect(selectHomeRecentNotes([], root, 3)).toEqual([]);
  expect(selectHomeRecentNotes([{ path: 'Missing/README.md', mtime: 1 }], root, -1)).toEqual([]);
});
