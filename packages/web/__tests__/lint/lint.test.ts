import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from '../core/helpers';
import {
  findOrphans,
  findStaleFiles,
  findBrokenLinks,
  findEmptyFiles,
  computeHealthScore,
  runLint,
} from '@/lib/lint';

describe('lint', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  // ── findOrphans ──────────────────────────────────────────────────

  describe('findOrphans', () => {
    it('returns empty for KB with no files', () => {
      expect(findOrphans(mindRoot)).toEqual([]);
    });

    it('marks files with no inbound links as orphans', () => {
      seedFile(mindRoot, 'notes/standalone.md', '# Standalone note');
      seedFile(mindRoot, 'notes/another.md', '# Another note');
      const orphans = findOrphans(mindRoot);
      expect(orphans.length).toBe(2);
      expect(orphans.map(o => o.path).sort()).toEqual([
        'notes/another.md',
        'notes/standalone.md',
      ]);
    });

    it('excludes system files from orphan detection', () => {
      seedFile(mindRoot, 'INSTRUCTION.md', '# Rules');
      seedFile(mindRoot, 'README.md', '# Welcome');
      seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Space rules');
      seedFile(mindRoot, 'Space/README.md', '# Space readme');
      seedFile(mindRoot, 'CONFIG.json', '{}');
      const orphans = findOrphans(mindRoot);
      expect(orphans).toEqual([]);
    });

    it('does not mark linked files as orphans', () => {
      seedFile(mindRoot, 'index.md', '# Index\n\nSee [[target]]');
      seedFile(mindRoot, 'target.md', '# Target page');
      const orphans = findOrphans(mindRoot);
      const orphanPaths = orphans.map(o => o.path);
      expect(orphanPaths).not.toContain('target.md');
    });

    it('includes lastModified timestamp in orphan entries', () => {
      seedFile(mindRoot, 'lonely.md', '# Lonely');
      const orphans = findOrphans(mindRoot);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].lastModified).toBeDefined();
      expect(new Date(orphans[0].lastModified).getTime()).toBeGreaterThan(0);
    });
  });

  // ── findStaleFiles ───────────────────────────────────────────────

  describe('findStaleFiles', () => {
    it('returns empty when no files are stale', () => {
      seedFile(mindRoot, 'fresh.md', '# Fresh');
      const stale = findStaleFiles(mindRoot, 90);
      expect(stale).toEqual([]);
    });

    it('detects files older than threshold', () => {
      seedFile(mindRoot, 'old.md', '# Old note');
      const abs = fs.realpathSync(`${mindRoot}/old.md`);
      const past = new Date();
      past.setDate(past.getDate() - 100);
      fs.utimesSync(abs, past, past);

      const stale = findStaleFiles(mindRoot, 90);
      expect(stale).toHaveLength(1);
      expect(stale[0].path).toBe('old.md');
      expect(stale[0].daysSinceUpdate).toBeGreaterThanOrEqual(100);
    });

    it('only analyzes .md and .csv files', () => {
      seedFile(mindRoot, 'image.png', 'binary');
      const abs = fs.realpathSync(`${mindRoot}/image.png`);
      const past = new Date();
      past.setDate(past.getDate() - 200);
      fs.utimesSync(abs, past, past);

      const stale = findStaleFiles(mindRoot, 90);
      expect(stale).toEqual([]);
    });

    it('includes daysSinceUpdate in result', () => {
      seedFile(mindRoot, 'aging.md', '# Aging');
      const abs = fs.realpathSync(`${mindRoot}/aging.md`);
      const past = new Date();
      past.setDate(past.getDate() - 95);
      fs.utimesSync(abs, past, past);

      const stale = findStaleFiles(mindRoot, 90);
      expect(stale).toHaveLength(1);
      expect(stale[0].daysSinceUpdate).toBeGreaterThanOrEqual(95);
    });
  });

  // ── findBrokenLinks ──────────────────────────────────────────────

  describe('findBrokenLinks', () => {
    it('returns empty when all links resolve', () => {
      seedFile(mindRoot, 'a.md', 'See [[b]]');
      seedFile(mindRoot, 'b.md', '# B');
      const broken = findBrokenLinks(mindRoot);
      expect(broken).toEqual([]);
    });

    it('detects wikilink to non-existent file', () => {
      seedFile(mindRoot, 'source.md', 'Check [[missing-page]] for details');
      const broken = findBrokenLinks(mindRoot);
      expect(broken).toHaveLength(1);
      expect(broken[0].source).toBe('source.md');
      expect(broken[0].target).toBe('missing-page');
      expect(broken[0].line).toBeGreaterThan(0);
    });

    it('detects markdown link to non-existent file', () => {
      seedFile(mindRoot, 'post.md', 'Read [this](./gone.md) article');
      const broken = findBrokenLinks(mindRoot);
      expect(broken).toHaveLength(1);
      expect(broken[0].source).toBe('post.md');
      expect(broken[0].target).toContain('gone.md');
    });

    it('ignores external http links', () => {
      seedFile(mindRoot, 'page.md', 'Visit [Google](https://google.com)');
      const broken = findBrokenLinks(mindRoot);
      expect(broken).toEqual([]);
    });

    it('includes line number of broken link', () => {
      seedFile(mindRoot, 'multi.md', 'Line 1\nLine 2\n[[missing]]');
      const broken = findBrokenLinks(mindRoot);
      expect(broken).toHaveLength(1);
      expect(broken[0].line).toBe(3);
    });
  });

  // ── findEmptyFiles ───────────────────────────────────────────────

  describe('findEmptyFiles', () => {
    it('returns empty when no files are empty', () => {
      seedFile(mindRoot, 'rich.md', '# Title\n\nLots of meaningful content here that passes the threshold easily.');
      const empty = findEmptyFiles(mindRoot);
      expect(empty).toEqual([]);
    });

    it('detects truly empty files', () => {
      seedFile(mindRoot, 'blank.md', '');
      const empty = findEmptyFiles(mindRoot);
      expect(empty).toContain('blank.md');
    });

    it('detects files with only whitespace', () => {
      seedFile(mindRoot, 'spaces.md', '   \n  \n   ');
      const empty = findEmptyFiles(mindRoot);
      expect(empty).toContain('spaces.md');
    });

    it('detects files with content under 50 chars', () => {
      seedFile(mindRoot, 'stub.md', '# TODO');
      const empty = findEmptyFiles(mindRoot);
      expect(empty).toContain('stub.md');
    });

    it('does not mark files with 50+ chars as empty', () => {
      seedFile(mindRoot, 'enough.md', 'A'.repeat(50));
      const empty = findEmptyFiles(mindRoot);
      expect(empty).not.toContain('enough.md');
    });
  });

  // ── computeHealthScore ───────────────────────────────────────────

  describe('computeHealthScore', () => {
    it('returns 100 for a perfect KB', () => {
      expect(computeHealthScore({ totalFiles: 10, orphanFiles: 0, staleFiles: 0, emptyFiles: 0, brokenLinks: 0 })).toBe(100);
    });

    it('returns 100 for empty KB', () => {
      expect(computeHealthScore({ totalFiles: 0, orphanFiles: 0, staleFiles: 0, emptyFiles: 0, brokenLinks: 0 })).toBe(100);
    });

    it('penalizes orphans', () => {
      const score = computeHealthScore({ totalFiles: 10, orphanFiles: 5, staleFiles: 0, emptyFiles: 0, brokenLinks: 0 });
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it('penalizes broken links more than orphans', () => {
      const orphanOnly = computeHealthScore({ totalFiles: 10, orphanFiles: 1, staleFiles: 0, emptyFiles: 0, brokenLinks: 0 });
      const brokenOnly = computeHealthScore({ totalFiles: 10, orphanFiles: 0, staleFiles: 0, emptyFiles: 0, brokenLinks: 1 });
      expect(brokenOnly).toBeLessThan(orphanOnly);
    });

    it('never returns below 0', () => {
      const score = computeHealthScore({ totalFiles: 10, orphanFiles: 100, staleFiles: 100, emptyFiles: 100, brokenLinks: 100 });
      expect(score).toBe(0);
    });
  });

  // ── runLint (integration) ────────────────────────────────────────

  describe('runLint', () => {
    it('returns full report for empty KB', () => {
      const report = runLint(mindRoot);
      expect(report.healthScore).toBe(100);
      expect(report.stats.totalFiles).toBe(0);
      expect(report.orphans).toEqual([]);
      expect(report.stale).toEqual([]);
      expect(report.brokenLinks).toEqual([]);
      expect(report.empty).toEqual([]);
      expect(report.scope).toBe('all');
      expect(report.timestamp).toBeDefined();
    });

    it('detects multiple issue types in one report', () => {
      seedFile(mindRoot, 'lonely.md', '# Just a heading');
      seedFile(mindRoot, 'broken.md', 'See [[nonexistent]]');
      seedFile(mindRoot, 'blank.md', '');

      const report = runLint(mindRoot);
      expect(report.stats.totalFiles).toBe(3);
      expect(report.stats.emptyFiles).toBeGreaterThanOrEqual(1);
      expect(report.stats.brokenLinks).toBeGreaterThanOrEqual(1);
      expect(report.healthScore).toBeLessThan(100);
    });

    it('scopes to a specific space when specified', () => {
      seedFile(mindRoot, 'Projects/todo.md', '# Project TODO');
      seedFile(mindRoot, 'Notes/random.md', '# Random note');

      const report = runLint(mindRoot, 'Projects');
      expect(report.scope).toBe('Projects');
      expect(report.stats.totalFiles).toBe(1);
    });

    it('handles non-existent space gracefully', () => {
      const report = runLint(mindRoot, 'NonExistent');
      expect(report.scope).toBe('NonExistent');
      expect(report.stats.totalFiles).toBe(0);
      expect(report.healthScore).toBe(100);
    });
  });
});
