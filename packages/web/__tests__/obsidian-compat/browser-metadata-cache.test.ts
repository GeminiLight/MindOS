import { expect, it } from 'vitest';
import * as hostModule from '@/lib/obsidian-compat/browser-host/plugin-host';

const note = (path: string, content: string) => ({ path, data: new TextEncoder().encode(content), stat: { ctime: 1, mtime: 2, size: new TextEncoder().encode(content).length } });
const snapshot = (sequence: number, files: ReturnType<typeof note>[]) => ({ vaultId: 'a'.repeat(64), name: 'Notes', sequence, folders: [], files });
function setup(files: ReturnType<typeof note>[]) {
  const controller = hostModule.createBrowserVault(snapshot(0, files));
  expect((hostModule as any).BrowserMetadataCache).toBeTypeOf('function');
  const cache = new (hostModule as any).BrowserMetadataCache(controller);
  return { ...controller, cache, cleanup() { cache.dispose(); controller.close(); } };
}

it('parses frontmatter, tasks, tags and source positions from the actual approved file bytes', () => {
  const source = '---\ntags: [project]\npriority: 2\n---\n# 中文\n- [ ] Ship [[Target]] #work ^task\n`#ignored [[Hidden]]`';
  const { vault, cache, cleanup } = setup([note('Notes/中文.md', source), note('Target.md', '')]);
  const result = cache.getFileCache(vault.getFileByPath('Notes/中文.md'));
  expect(result.frontmatter).toEqual({ tags: ['project'], priority: 2 });
  expect(result.tags.map((t: any) => t.tag)).toEqual(['#work']);
  expect(result.headings[0]).toMatchObject({ heading: '中文', position: { start: { line: 4, col: 0 } } });
  expect(result.listItems[0]).toMatchObject({ task: ' ', id: 'task', position: { start: { line: 5 } } });
  expect(result.links.map((l: any) => l.link)).toEqual(['Target']);
  expect(cache.getTags()).toEqual({ '#project': 1, '#work': 1 });
  result.frontmatter.priority = 99; expect(cache.getCache('Notes/中文.md').frontmatter.priority).toBe(2);
  cleanup();
});

it('resolves links relative to the source before ambiguous basenames and counts unresolved links', () => {
  const { vault, cache, cleanup } = setup([note('Other/Target.md', ''), note('Notes/Target.md', ''),
    note('Notes/Index.md', '[[Target]] [[Target#Heading]] [[Missing]] ![[Target]]'), note('Top.md', '')]);
  expect(cache.getFirstLinkpathDest('Target#Heading', 'Notes/Index.md')).toBe(vault.getFileByPath('Notes/Target.md'));
  expect(cache.getFirstLinkpathDest('../Top', 'Notes/Index.md')).toBe(vault.getFileByPath('Top.md'));
  expect(cache.getFirstLinkpathDest('#Local', 'Notes/Index.md')).toBe(vault.getFileByPath('Notes/Index.md'));
  expect(cache.getFirstLinkpathDest('../../escape', 'Notes/Index.md')).toBeNull();
  expect(cache.resolvedLinks['Notes/Index.md']).toEqual({ 'Notes/Target.md': 3 });
  expect(cache.unresolvedLinks['Notes/Index.md']).toEqual({ Missing: 1 });
  cleanup();
});

it('invalidates metadata before resolve events and drops deleted files from the index', () => {
  const original = note('a.md', '[[missing]] #old'); const { vault, cache, applySnapshot, cleanup } = setup([original]);
  expect(cache.getCache('a.md').tags[0].tag).toBe('#old');
  const observed: unknown[] = [];
  cache.on('resolve', (file: any) => observed.push([file.path, cache.getFileCache(file).tags.map((tag: any) => tag.tag)]));
  applySnapshot(snapshot(1, [note('a.md', '[[b]] #new'), note('b.md', '')]));
  expect(observed).toContainEqual(['a.md', ['#new']]); expect(cache.resolvedLinks['a.md']).toEqual({ 'b.md': 1 });
  const old = vault.getFileByPath('a.md');
  applySnapshot(snapshot(2, [note('b.md', '')]));
  expect(cache.getFileCache(old)).toBeNull(); expect(cache.getCachedFiles()).toEqual(['b.md']);
  expect(cache.resolvedLinks['a.md']).toBeUndefined(); cleanup();
});

it('tolerates malformed YAML while retaining body metadata and stops emitting after disposal', () => {
  const { cache, applySnapshot, cleanup } = setup([note('a.md', '---\nbad: [\n---\n# Body')]);
  expect(cache.getCache('a.md').frontmatter).toBeUndefined(); expect(cache.getCache('a.md').headings[0].heading).toBe('Body');
  const seen: unknown[] = []; cache.on('resolve', (file: any) => seen.push(file.path));
  cache.dispose(); applySnapshot(snapshot(1, [note('a.md', 'new')]));
  expect(seen).toEqual([]); expect(() => cache.getCachedFiles()).toThrow(/closed/i); cleanup();
});
