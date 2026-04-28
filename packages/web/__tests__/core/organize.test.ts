import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile, readSeeded } from './helpers';
import { organizeAfterImport } from '@/lib/core/organize';

describe('organizeAfterImport', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('appends entries to existing README.md', () => {
    seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Notes');
    seedFile(mindRoot, 'Notes/README.md', '# Notes Index\n');
    seedFile(mindRoot, 'Notes/imported.md', '# Imported');

    const result = organizeAfterImport(mindRoot, ['Notes/imported.md'], 'Notes');

    expect(result.readmeUpdated).toBe(true);
    const readme = readSeeded(mindRoot, 'Notes/README.md');
    expect(readme).toContain('[imported.md](./imported.md)');
  });

  it('does not create README if it does not exist', () => {
    seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Notes');
    seedFile(mindRoot, 'Notes/imported.md', '# Imported');

    const result = organizeAfterImport(mindRoot, ['Notes/imported.md'], 'Notes');
    expect(result.readmeUpdated).toBe(false);
  });

  it('skips readme update for root imports (empty targetSpace)', () => {
    seedFile(mindRoot, 'README.md', '# Root');
    seedFile(mindRoot, 'file.md', '# File');

    const result = organizeAfterImport(mindRoot, ['file.md'], '');
    expect(result.readmeUpdated).toBe(false);
  });

  it('finds related files by keyword matching', () => {
    seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Notes');
    seedFile(mindRoot, 'Notes/README.md', '# Notes');
    seedFile(mindRoot, 'existing.md', '# Document about machine learning and neural networks');
    seedFile(mindRoot, 'Notes/machine-learning-guide.md', '# ML Guide');

    const result = organizeAfterImport(
      mindRoot,
      ['Notes/machine-learning-guide.md'],
      'Notes',
    );

    const relatedPaths = result.relatedFiles.map(f => f.path);
    expect(relatedPaths).toContain('existing.md');
  });

  it('limits related files to 10', () => {
    seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Space');
    seedFile(mindRoot, 'Space/README.md', '# Space');
    for (let i = 0; i < 15; i++) {
      seedFile(mindRoot, `related-${i}.md`, 'topic keyword content');
    }
    seedFile(mindRoot, 'Space/topic-keyword-file.md', '# Topic');

    const result = organizeAfterImport(
      mindRoot,
      ['Space/topic-keyword-file.md'],
      'Space',
    );
    expect(result.relatedFiles.length).toBeLessThanOrEqual(10);
  });

  it('does not include created files in related files', () => {
    seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Notes');
    seedFile(mindRoot, 'Notes/README.md', '# Notes');
    seedFile(mindRoot, 'Notes/new-file.md', '# content about new file');

    const result = organizeAfterImport(
      mindRoot,
      ['Notes/new-file.md'],
      'Notes',
    );
    const relatedPaths = result.relatedFiles.map(f => f.path);
    expect(relatedPaths).not.toContain('Notes/new-file.md');
  });

  it('handles gracefully when mindRoot is invalid', () => {
    const result = organizeAfterImport('/nonexistent-path-xyz', ['file.md'], 'Space');
    expect(result.readmeUpdated).toBe(false);
    expect(result.relatedFiles).toEqual([]);
  });
});
