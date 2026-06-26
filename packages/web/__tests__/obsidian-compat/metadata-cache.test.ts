import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Vault } from '@/lib/obsidian-compat/shims/vault';
import { MetadataCacheShim } from '@/lib/obsidian-compat/shims/metadata-cache';
import { parseFrontMatterTags } from '@/lib/obsidian-compat/shims/obsidian';

let mindRoot: string;
let vault: Vault;
let metadataCache: MetadataCacheShim;

describe('MetadataCache', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-metadata-cache-'));
    vault = new Vault(mindRoot);
    metadataCache = new MetadataCacheShim(mindRoot, vault);
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  describe('frontmatter tag helpers', () => {
    it('normalizes frontmatter tag values to Obsidian hash-prefixed tags', () => {
      expect(parseFrontMatterTags({
        tags: ['mindos/legacy', '#already-prefixed', 'split one,#two'],
      })).toEqual(['#mindos/legacy', '#already-prefixed', '#split', '#one', '#two']);
      expect(parseFrontMatterTags({ tag: 'alpha, beta #gamma' })).toEqual(['#alpha', '#beta', '#gamma']);
      expect(parseFrontMatterTags({ title: 'No tags' })).toBeNull();
    });
  });

  describe('getFileCache', () => {
    it('extracts frontmatter, tags, headings and links', async () => {
      const content = `---
title: Test Note
tags: [test, demo]
---

# Main Heading

This is a note with #inline-tag and [[wikilink]] and [markdown link](other.md).

## Sub Heading
`;
      const file = await vault.create('test.md', content);
      const cache = metadataCache.getFileCache(file);

      expect(cache).toBeDefined();
      expect(cache?.frontmatter).toEqual({ title: 'Test Note', tags: ['test', 'demo'] });
      expect(cache?.tags).toHaveLength(1);
      expect(cache?.tags[0]?.tag).toBe('#inline-tag');
      expect(cache?.headings).toHaveLength(2);
      expect(cache?.headings[0]?.heading).toBe('Main Heading');
      expect(cache?.headings[0]?.level).toBe(1);
      expect(cache?.links).toHaveLength(2);
      expect(cache?.links.map((l) => l.link)).toContain('wikilink');
      expect(cache?.links.map((l) => l.link)).toContain('other');
    });

    it('extracts Obsidian-style rich metadata payload fields', async () => {
      const content = `---
title: Rich
related: "[[Front Ref|Front]]"
---

# Main Heading

Paragraph with #inline-tag, [[Target Note#Section|Target Label]] and [markdown label](other.md#part).

![[image.png|Image Alt]]
![diagram](diagram.svg)

- [ ] Task item ^task-block
  - Child item

## Sub Heading
`;
      const file = await vault.create('rich.md', content);
      const cache = metadataCache.getFileCache(file);

      expect(cache?.frontmatter).toEqual({ title: 'Rich', related: '[[Front Ref|Front]]' });
      expect(cache?.frontmatterPosition?.start).toMatchObject({ line: 0, col: 0, offset: 0 });
      expect(cache?.frontmatterLinks).toEqual([
        { key: 'related', link: 'Front Ref', original: '[[Front Ref|Front]]', displayText: 'Front' },
      ]);
      expect(cache?.links).toEqual(expect.arrayContaining([
        expect.objectContaining({
          link: 'Target Note#Section',
          original: '[[Target Note#Section|Target Label]]',
          displayText: 'Target Label',
          position: expect.objectContaining({
            start: expect.objectContaining({ line: 7 }),
          }),
        }),
        expect.objectContaining({
          link: 'other#part',
          original: '[markdown label](other.md#part)',
          displayText: 'markdown label',
        }),
      ]));
      expect(cache?.embeds).toEqual(expect.arrayContaining([
        expect.objectContaining({
          link: 'image.png',
          original: '![[image.png|Image Alt]]',
          displayText: 'Image Alt',
        }),
        expect.objectContaining({
          link: 'diagram.svg',
          original: '![diagram](diagram.svg)',
          displayText: 'diagram',
        }),
      ]));
      expect(cache?.sections?.map((section) => section.type)).toEqual(expect.arrayContaining([
        'yaml',
        'heading',
        'paragraph',
        'list',
      ]));
      expect(cache?.tags?.[0]?.position.start.line).toBe(7);
      expect(cache?.headings?.[0]).toEqual(expect.objectContaining({
        heading: 'Main Heading',
        level: 1,
        position: expect.objectContaining({
          start: expect.objectContaining({ line: 5 }),
        }),
      }));
      expect(cache?.listItems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'task-block',
          task: ' ',
          parent: -12,
        }),
        expect.objectContaining({
          parent: 12,
        }),
      ]));
      expect(cache?.blocks?.['task-block']).toEqual(expect.objectContaining({
        id: 'task-block',
        position: expect.objectContaining({
          start: expect.objectContaining({ line: 12 }),
        }),
      }));
    });

    it('ignores frontmatter and code spans while preserving repeated body references', async () => {
      const content = `---
related: "[[Front Only]]"
---

\`#not-a-tag [[Not A Link]]\`

\`\`\`md
#not-a-tag [[Not A Link]]
\`\`\`

Body #real-tag links [[Real]] and [[Real|Again]].
![[image.png]]
`;
      const file = await vault.create('body-only.md', content);
      const cache = metadataCache.getFileCache(file);

      expect(cache?.frontmatterLinks?.[0]).toEqual({
        key: 'related',
        link: 'Front Only',
        original: '[[Front Only]]',
      });
      expect(cache?.tags?.map((tag) => tag.tag)).toEqual(['#real-tag']);
      expect(cache?.links?.map((link) => link.link)).toEqual(['Real', 'Real']);
      expect(cache?.links?.[1]?.displayText).toBe('Again');
      expect(cache?.embeds?.map((embed) => embed.link)).toEqual(['image.png']);
      expect(cache?.links?.some((link) => link.link === 'Not A Link')).toBe(false);
    });

    it('returns null for non-existent file', () => {
      const file = { path: 'nonexistent.md', basename: 'nonexistent', extension: 'md' };
      const cache = metadataCache.getFileCache(file);
      expect(cache).toBeNull();
    });
  });

  describe('getTags', () => {
    it('counts frontmatter and body tags with Obsidian hash prefixes', async () => {
      await vault.create('frontmatter.md', `---
tags: [mindos/legacy, "#existing"]
---

Body keeps #body-tag and repeats #mindos/legacy.
`);
      await vault.create('string-tag.md', `---
tag: alpha, beta
---

# Heading
`);

      expect(metadataCache.getTags()).toEqual({
        '#mindos/legacy': 2,
        '#existing': 1,
        '#body-tag': 1,
        '#alpha': 1,
        '#beta': 1,
      });
    });
  });

  describe('resolvedLinks and unresolvedLinks', () => {
    it('does not scan markdown files until the global link index is requested', () => {
      const getMarkdownFiles = vi.spyOn(vault, 'getMarkdownFiles');
      const lazyCache = new MetadataCacheShim(mindRoot, vault);

      expect(getMarkdownFiles).not.toHaveBeenCalled();

      void lazyCache.resolvedLinks;

      expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
      getMarkdownFiles.mockRestore();
    });

    it('reuses one markdown file snapshot while building the global link index', async () => {
      await vault.create('target.md', '# Target');
      await vault.create('source.md', '[[target]] [[target]] [[missing]]');
      const getMarkdownFiles = vi.spyOn(vault, 'getMarkdownFiles');

      metadataCache.buildGlobalIndex();

      expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(2);
      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);
      getMarkdownFiles.mockRestore();
    });

    it('builds global index with resolved links', async () => {
      // Create target files
      await vault.create('target-a.md', '# Target A');
      await vault.create('target-b.md', '# Target B');

      // Create source file with links to existing files
      await vault.create('source.md', '[[target-a]] and [[target-b]]');

      // Rebuild index
      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']).toBeDefined();
      expect(metadataCache.resolvedLinks['source.md']['target-a.md']).toBe(1);
      expect(metadataCache.resolvedLinks['source.md']['target-b.md']).toBe(1);
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();
    });

    it('builds global index with unresolved links', async () => {
      // Create source file with links to non-existent files
      await vault.create('source.md', '[[missing-a]] and [[missing-b]]');

      // Rebuild index
      metadataCache.buildGlobalIndex();

      expect(metadataCache.unresolvedLinks['source.md']).toBeDefined();
      expect(metadataCache.unresolvedLinks['source.md']['missing-a']).toBe(1);
      expect(metadataCache.unresolvedLinks['source.md']['missing-b']).toBe(1);
      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
    });

    it('counts multiple links to same target', async () => {
      await vault.create('target.md', '# Target');
      await vault.create('source.md', '[[target]] and [[target]] and [[target]]');

      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(3);
    });

    it('handles mixed resolved and unresolved links', async () => {
      await vault.create('exists.md', '# Exists');
      await vault.create('source.md', '[[exists]] and [[missing]]');

      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['exists.md']).toBe(1);
      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);
    });

    it('handles markdown-style links', async () => {
      await vault.create('target.md', '# Target');
      await vault.create('source.md', '[link text](target.md)');

      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(1);
    });

    it('resolves links by basename when full path not found', async () => {
      await vault.create('notes/target.md', '# Target');
      await vault.create('source.md', '[[target]]');

      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['notes/target.md']).toBe(1);
    });

    it('updates index for specific file', async () => {
      await vault.create('target.md', '# Target');
      const source = await vault.create('source.md', '[[target]]');

      metadataCache.buildGlobalIndex();
      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(1);

      // Modify source to add more links
      await vault.modify(source, '[[target]] [[target]] [[missing]]');

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(2);
      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);
    });

    it('removes file from index when it has no links', async () => {
      const source = await vault.create('source.md', '[[target]]');

      metadataCache.buildGlobalIndex();
      expect(metadataCache.unresolvedLinks['source.md']).toBeDefined();

      // Remove all links
      await vault.modify(source, 'No links here');

      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();
    });

    it('invalidates and rebuilds entire index', async () => {
      await vault.create('source.md', '[[missing]]');
      metadataCache.buildGlobalIndex();

      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);

      // Create the missing file
      await vault.create('missing.md', '# Now exists');

      expect(metadataCache.resolvedLinks['source.md']['missing.md']).toBe(1);
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();
    });

    it('updates link resolution when a target file is deleted', async () => {
      await vault.create('target.md', '# Target');
      await vault.create('source.md', '[[target]]');
      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(1);

      const target = vault.getFileByPath('target.md');
      await vault.delete(target!);

      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['source.md']['target']).toBe(1);
    });

    it('updates link resolution when a target file is renamed', async () => {
      const target = await vault.create('target.md', '# Target');
      await vault.create('source.md', '[[target]]');
      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(1);

      await vault.rename(target, 'renamed.md');

      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['source.md']['target']).toBe(1);
    });

    it('emits Obsidian-style metadata events when vault files change', async () => {
      const onChanged = vi.fn();
      const onDeleted = vi.fn();
      const onResolve = vi.fn();
      const onResolved = vi.fn();
      metadataCache.on('changed', onChanged);
      metadataCache.on('deleted', onDeleted);
      metadataCache.on('resolve', onResolve);
      metadataCache.on('resolved', onResolved);

      const file = await vault.create('events.md', '# Before');
      await vault.modify(file, '# After\n\n[[missing]]');
      await vault.delete(file);

      expect(onChanged).toHaveBeenCalledTimes(2);
      expect(onChanged.mock.calls[0]?.[0]?.path).toBe('events.md');
      expect(onChanged.mock.calls[1]?.[1]).toContain('# After');
      expect(onChanged.mock.calls[1]?.[2]?.links?.[0]?.link).toBe('missing');
      expect(onDeleted).toHaveBeenCalledTimes(1);
      expect(onDeleted.mock.calls[0]?.[0]?.path).toBe('events.md');
      expect(onDeleted.mock.calls[0]?.[1]?.headings?.[0]?.heading).toBe('After');
      expect(onResolve).toHaveBeenCalledTimes(2);
      expect(onResolve.mock.calls[0]?.[0]?.path).toBe('events.md');
      expect(onResolved).toHaveBeenCalledTimes(3);
    });

    it('updates metadata indexes when DataAdapter writes markdown files', async () => {
      await vault.adapter.write('source.md', '[[target]]');
      metadataCache.buildGlobalIndex();

      expect(metadataCache.unresolvedLinks['source.md']['target']).toBe(1);

      await vault.adapter.write('target.md', '# Target');
      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(1);
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();

      await vault.adapter.rename('target.md', 'renamed.md');
      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['source.md']['target']).toBe(1);

      await vault.adapter.remove('source.md');
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();
    });

    it('handles files with no links', async () => {
      await vault.create('no-links.md', '# Just a heading\n\nNo links here.');

      metadataCache.buildGlobalIndex();

      expect(metadataCache.resolvedLinks['no-links.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['no-links.md']).toBeUndefined();
    });

    it('handles empty vault', () => {
      metadataCache.buildGlobalIndex();

      expect(Object.keys(metadataCache.resolvedLinks)).toHaveLength(0);
      expect(Object.keys(metadataCache.unresolvedLinks)).toHaveLength(0);
    });
  });

  describe('getFirstLinkpathDest', () => {
    it('resolves link by full path', async () => {
      const target = await vault.create('notes/target.md', '# Target');
      const dest = metadataCache.getFirstLinkpathDest('notes/target', 'source.md');

      expect(dest?.path).toBe(target.path);
    });

    it('resolves link by basename', async () => {
      const target = await vault.create('notes/target.md', '# Target');
      const dest = metadataCache.getFirstLinkpathDest('target', 'source.md');

      expect(dest?.path).toBe(target.path);
    });

    it('returns null for non-existent link', () => {
      const dest = metadataCache.getFirstLinkpathDest('missing', 'source.md');
      expect(dest).toBeNull();
    });
  });

  describe('fileToLinktext', () => {
    it('returns path with extension by default', async () => {
      const file = await vault.create('notes/test.md', '# Test');
      const linktext = metadataCache.fileToLinktext(file, 'source.md');

      expect(linktext).toBe('notes/test.md');
    });

    it('omits .md extension when requested', async () => {
      const file = await vault.create('notes/test.md', '# Test');
      const linktext = metadataCache.fileToLinktext(file, 'source.md', true);

      expect(linktext).toBe('notes/test');
    });

    it('keeps extension for non-markdown files', async () => {
      const file = await vault.create('image.png', 'fake image');
      const linktext = metadataCache.fileToLinktext(file, 'source.md', true);

      expect(linktext).toBe('image.png');
    });
  });
});
