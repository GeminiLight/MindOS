import { describe, expect, it } from 'vitest';
import { resolveSubpath } from '@/lib/obsidian-compat/shims/subpath';
import { parseMarkdownMetadata } from '@/lib/obsidian-compat/markdown-metadata';
import type { CachedMetadata } from '@/lib/obsidian-compat/types';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

function metadata(overrides: Partial<CachedMetadata> = {}): CachedMetadata {
  return {
    headings: [
      {
        heading: 'Alpha',
        level: 1,
        position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 6, offset: 6 } },
      },
      {
        heading: 'Beta',
        level: 2,
        position: { start: { line: 4, col: 0, offset: 40 }, end: { line: 4, col: 7, offset: 47 } },
      },
      {
        heading: 'Gamma',
        level: 1,
        position: { start: { line: 8, col: 0, offset: 80 }, end: { line: 8, col: 8, offset: 88 } },
      },
    ],
    blocks: {
      abc123: {
        id: 'abc123',
        position: { start: { line: 5, col: 0, offset: 48 }, end: { line: 6, col: 0, offset: 60 } },
      },
    },
    ...overrides,
  };
}

describe('obsidian resolveSubpath shim', () => {
  it('resolves a heading subpath to the heading and the next heading boundary', () => {
    const cache = metadata();
    const result = resolveSubpath(cache, '#Beta');
    expect(result).toMatchObject({
      type: 'heading',
      current: cache.headings?.[1],
      next: cache.headings?.[2],
    });
    expect(result?.start).toEqual(cache.headings?.[1].position.start);
    expect(result?.end).toEqual(cache.headings?.[2].position.start);
  });

  it('resolves the last heading with a null end boundary', () => {
    const cache = metadata();
    const result = resolveSubpath(cache, '#Gamma');
    expect(result).toMatchObject({ type: 'heading', current: cache.headings?.[2] });
    expect(result?.end).toBeNull();
  });

  it('requires an exact heading match', () => {
    const cache = metadata();
    expect(resolveSubpath(cache, '#beta')).toBeNull();
    expect(resolveSubpath(cache, '#Missing')).toBeNull();
    expect(resolveSubpath(cache, 'Beta')).toMatchObject({ type: 'heading' });
  });

  it('resolves a block subpath through the block cache', () => {
    const cache = metadata();
    const result = resolveSubpath(cache, '#^abc123');
    expect(result).toMatchObject({ type: 'block', block: cache.blocks?.abc123 });
    expect(result?.start).toEqual(cache.blocks?.abc123.position.start);
    expect(result?.end).toEqual(cache.blocks?.abc123.position.end);
  });

  it('returns null for unknown block ids, empty subpaths and missing caches', () => {
    const cache = metadata();
    expect(resolveSubpath(cache, '#^missing')).toBeNull();
    expect(resolveSubpath(cache, '#^')).toBeNull();
    expect(resolveSubpath(cache, '#')).toBeNull();
    expect(resolveSubpath(cache, '')).toBeNull();
    expect(resolveSubpath({} as CachedMetadata, '#Alpha')).toBeNull();
    expect(resolveSubpath(null as unknown as CachedMetadata, '#Alpha')).toBeNull();
  });

  it('returns null for footnote subpaths until the shared parser indexes footnotes', () => {
    expect(resolveSubpath(metadata(), '#[^note]')).toBeNull();
  });

  it('resolves against the shared MindOS markdown metadata parser', () => {
    const content = [
      '# Intro',
      '',
      'Body text. ^block-one',
      '',
      '## Details',
      'More text.',
    ].join('\n');
    const cache = parseMarkdownMetadata(content);
    const heading = resolveSubpath(cache, '#Details');
    expect(heading).toMatchObject({
      type: 'heading',
      current: expect.objectContaining({ heading: 'Details' }),
    });
    const block = resolveSubpath(cache, '#^block-one');
    expect(block).toMatchObject({
      type: 'block',
      block: expect.objectContaining({ id: 'block-one' }),
    });
  });

  it('registers resolveSubpath on the obsidian module', () => {
    expect(createObsidianModule().resolveSubpath).toBe(resolveSubpath);
  });
});
