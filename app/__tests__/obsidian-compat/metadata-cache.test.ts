import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Vault } from '@/lib/obsidian-compat/shims/vault';
import { MetadataCacheShim } from '@/lib/obsidian-compat/shims/metadata-cache';

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

    it('returns null for non-existent file', () => {
      const file = { path: 'nonexistent.md', basename: 'nonexistent', extension: 'md' };
      const cache = metadataCache.getFileCache(file);
      expect(cache).toBeNull();
    });
  });

  describe('resolvedLinks and unresolvedLinks', () => {
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
      metadataCache.updateFileIndex(source);

      expect(metadataCache.resolvedLinks['source.md']['target.md']).toBe(2);
      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);
    });

    it('removes file from index when it has no links', async () => {
      const source = await vault.create('source.md', '[[target]]');

      metadataCache.buildGlobalIndex();
      expect(metadataCache.unresolvedLinks['source.md']).toBeDefined();

      // Remove all links
      await vault.modify(source, 'No links here');
      metadataCache.updateFileIndex(source);

      expect(metadataCache.resolvedLinks['source.md']).toBeUndefined();
      expect(metadataCache.unresolvedLinks['source.md']).toBeUndefined();
    });

    it('invalidates and rebuilds entire index', async () => {
      await vault.create('source.md', '[[missing]]');
      metadataCache.buildGlobalIndex();

      expect(metadataCache.unresolvedLinks['source.md']['missing']).toBe(1);

      // Create the missing file
      await vault.create('missing.md', '# Now exists');

      // Invalidate should rebuild and resolve the link
      metadataCache.invalidateGlobalIndex();

      expect(metadataCache.resolvedLinks['source.md']['missing.md']).toBe(1);
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
