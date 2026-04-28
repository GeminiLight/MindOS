import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { LinkIndex } from '@/lib/core/link-index';

describe('LinkIndex', () => {
  let mindRoot: string;
  let index: LinkIndex;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    // Create a small knowledge base with cross-references
    seedFile(mindRoot, 'Notes/overview.md', '# Overview\n\nSee [[architecture]] and [[design]].');
    seedFile(mindRoot, 'Notes/architecture.md', '# Architecture\n\nBased on [[overview]]. Uses [design](design.md).');
    seedFile(mindRoot, 'Notes/design.md', '# Design\n\nReferences [[architecture]].');
    seedFile(mindRoot, 'Notes/orphan.md', '# Orphan\n\nNo links here.');
    index = new LinkIndex();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  describe('rebuild', () => {
    it('builds forward and backward links', () => {
      index.rebuild(mindRoot);
      expect(index.isBuilt()).toBe(true);
    });

    it('extracts wikilinks correctly', () => {
      index.rebuild(mindRoot);
      const links = index.getForwardLinks('Notes/overview.md');
      expect(links).toContain('Notes/architecture.md');
      expect(links).toContain('Notes/design.md');
    });

    it('extracts markdown links correctly', () => {
      index.rebuild(mindRoot);
      const links = index.getForwardLinks('Notes/architecture.md');
      expect(links).toContain('Notes/design.md');
    });

    it('builds backward links (backlinks)', () => {
      index.rebuild(mindRoot);
      const backlinks = index.getBacklinks('Notes/architecture.md');
      expect(backlinks).toContain('Notes/overview.md');
      expect(backlinks).toContain('Notes/design.md');
    });

    it('returns empty for orphan files', () => {
      index.rebuild(mindRoot);
      expect(index.getForwardLinks('Notes/orphan.md')).toHaveLength(0);
      expect(index.getBacklinks('Notes/orphan.md')).toHaveLength(0);
    });

    it('excludes self-links', () => {
      seedFile(mindRoot, 'Notes/self.md', '# Self\n\nSee [[self]].');
      index.rebuild(mindRoot);
      expect(index.getForwardLinks('Notes/self.md')).not.toContain('Notes/self.md');
    });
  });

  describe('getAllEdges', () => {
    it('returns all edges as source-target pairs', () => {
      index.rebuild(mindRoot);
      const edges = index.getAllEdges();
      expect(edges.length).toBeGreaterThanOrEqual(4);
      expect(edges).toContainEqual({ source: 'Notes/overview.md', target: 'Notes/architecture.md' });
      expect(edges).toContainEqual({ source: 'Notes/overview.md', target: 'Notes/design.md' });
    });
  });

  describe('incremental updates', () => {
    it('updateFile re-indexes a modified file', () => {
      index.rebuild(mindRoot);
      expect(index.getForwardLinks('Notes/overview.md')).toContain('Notes/architecture.md');

      // Remove the architecture link, add orphan link
      seedFile(mindRoot, 'Notes/overview.md', '# Overview\n\nSee [[orphan]] only.');
      index.updateFile(mindRoot, 'Notes/overview.md');

      expect(index.getForwardLinks('Notes/overview.md')).toContain('Notes/orphan.md');
      expect(index.getForwardLinks('Notes/overview.md')).not.toContain('Notes/architecture.md');
      // Backward link should also update
      expect(index.getBacklinks('Notes/architecture.md')).not.toContain('Notes/overview.md');
      expect(index.getBacklinks('Notes/orphan.md')).toContain('Notes/overview.md');
    });

    it('removeFile cleans up both forward and backward links', () => {
      index.rebuild(mindRoot);
      expect(index.getBacklinks('Notes/architecture.md')).toContain('Notes/overview.md');

      index.removeFile('Notes/overview.md');

      expect(index.getForwardLinks('Notes/overview.md')).toHaveLength(0);
      expect(index.getBacklinks('Notes/architecture.md')).not.toContain('Notes/overview.md');
    });
  });

  describe('invalidate', () => {
    it('clears the index', () => {
      index.rebuild(mindRoot);
      expect(index.isBuilt()).toBe(true);
      index.invalidate();
      expect(index.isBuilt()).toBe(false);
    });
  });
});
