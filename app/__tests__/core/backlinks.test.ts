import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { findBacklinks } from '@/lib/core/backlinks';

describe('backlinks', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
  });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('finds wikilink [[target]] references', () => {
    seedFile(mindRoot, 'target.md', '# Target');
    seedFile(mindRoot, 'source.md', 'See [[target]] for details.');
    const results = findBacklinks(mindRoot, 'target.md');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('source.md');
    expect(results[0].context).toContain('[[target]]');
  });

  it('finds markdown link (target.md) references', () => {
    seedFile(mindRoot, 'Profile/Identity.md', '# Identity');
    seedFile(mindRoot, 'index.md', 'Read [my profile](Profile/Identity.md) here.');
    const results = findBacklinks(mindRoot, 'Profile/Identity.md');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('index.md');
  });

  it('finds wikilink with display text [[target|Display]]', () => {
    seedFile(mindRoot, 'target.md', '# Target');
    seedFile(mindRoot, 'source.md', 'See [[target|My Target]] for more.');
    const results = findBacklinks(mindRoot, 'target.md');
    expect(results).toHaveLength(1);
  });

  it('finds backtick references', () => {
    seedFile(mindRoot, 'docs/setup.md', '# Setup');
    seedFile(mindRoot, 'notes.md', 'Check `docs/setup.md` for instructions.');
    const results = findBacklinks(mindRoot, 'docs/setup.md');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('notes.md');
  });

  it('does not include self-references', () => {
    seedFile(mindRoot, 'self.md', 'This file references [[self]] itself.');
    const results = findBacklinks(mindRoot, 'self.md');
    expect(results).toHaveLength(0);
  });

  it('returns empty when no backlinks exist', () => {
    seedFile(mindRoot, 'target.md', '# Target');
    seedFile(mindRoot, 'other.md', 'No references here.');
    const results = findBacklinks(mindRoot, 'target.md');
    expect(results).toHaveLength(0);
  });

  it('only scans .md files', () => {
    seedFile(mindRoot, 'target.md', '# Target');
    seedFile(mindRoot, 'data.csv', 'target,value');
    const results = findBacklinks(mindRoot, 'target.md');
    expect(results).toHaveLength(0);
  });

  it('reports line number and context', () => {
    seedFile(mindRoot, 'target.md', '# Target');
    seedFile(mindRoot, 'source.md', 'Line 1\nLine 2 with [[target]]\nLine 3');
    const results = findBacklinks(mindRoot, 'target.md');
    expect(results[0].line).toBe(2);
    expect(results[0].context).toContain('Line 2');
  });
});
