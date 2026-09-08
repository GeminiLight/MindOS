import { describe, expect, it, vi } from 'vitest';
import { handleBacklinks, handleGraph, type GraphData } from './handlers/graph.js';
import { getLinkSnapshot } from './link-index.js';

type Library = Map<string, string>;

function createServices(library: Library, options: { getTreeVersion?: () => number } = {}) {
  const collectAllFiles = vi.fn(() => [...library.keys()]);
  const readTextFile = vi.fn((path: string) => {
    const content = library.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  });
  return {
    collectAllFiles,
    readTextFile,
    ...(options.getTreeVersion ? { getTreeVersion: options.getTreeVersion } : {}),
  };
}

describe('server link index cache', () => {
  it('serves backlinks and graph from one scan while the tree version is unchanged', () => {
    const library: Library = new Map([
      ['source.md', 'See [[target]] for details.'],
      ['Space/target.md', '# Target'],
    ]);
    const services = createServices(library, { getTreeVersion: () => 7 });

    const first = handleBacklinks(new URLSearchParams('path=Space/target.md'), services);
    expect(first.status).toBe(200);
    expect(first.body).toEqual([
      expect.objectContaining({ filePath: 'source.md', snippets: [expect.stringContaining('[[target]]')] }),
    ]);
    const readsAfterFirst = services.readTextFile.mock.calls.length;

    const second = handleBacklinks(new URLSearchParams('path=Space/target.md'), services);
    const graph = handleGraph(services);

    expect(second.body).toEqual(first.body);
    expect(graph.status).toBe(200);
    expect(graph.body.edges).toEqual([
      expect.objectContaining({ source: 'source.md', target: 'Space/target.md', kind: 'wiki', count: 1 }),
    ]);
    // No additional full-library reads for the cached calls.
    expect(services.readTextFile.mock.calls.length).toBe(readsAfterFirst);
  });

  it('re-reads only files whose stats changed when the file list is stable', () => {
    const library: Library = new Map([
      ['source.md', 'Links to [[target]].'],
      ['other.md', 'Nothing here.'],
      ['Space/target.md', '# Target'],
    ]);
    const stats = new Map<string, { mtime: number; size: number }>([
      ['source.md', { mtime: 1, size: 20 }],
      ['other.md', { mtime: 1, size: 13 }],
      ['Space/target.md', { mtime: 1, size: 8 }],
    ]);
    let version = 1;
    const services = {
      ...createServices(library, { getTreeVersion: () => version }),
      collectFileStats: () => [...stats.entries()].map(([path, stat]) => ({ path, ...stat })),
    };

    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toHaveLength(1);
    expect(services.readTextFile).toHaveBeenCalledTimes(3);

    // Edit one file: only that file is re-read.
    library.set('other.md', 'Now also links to [[target]].');
    stats.set('other.md', { mtime: 2, size: 30 });
    version += 1;
    services.readTextFile.mockClear();
    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toHaveLength(2);
    expect(services.readTextFile.mock.calls.map((call) => call[0])).toEqual(['other.md']);

    // Version bump without content changes: no reads at all.
    version += 1;
    services.readTextFile.mockClear();
    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toHaveLength(2);
    expect(services.readTextFile).not.toHaveBeenCalled();

    // Adding a file changes link resolution, so everything is rescanned.
    library.set('Space/new.md', '# New');
    stats.set('Space/new.md', { mtime: 3, size: 5 });
    version += 1;
    services.readTextFile.mockClear();
    handleBacklinks(new URLSearchParams('path=Space/target.md'), services);
    expect(services.readTextFile).toHaveBeenCalledTimes(4);
  });

  it('rebuilds the index when the tree version changes', () => {
    const library: Library = new Map([
      ['source.md', 'No links yet.'],
      ['Space/target.md', '# Target'],
    ]);
    let version = 1;
    const getTreeVersion = () => version;
    const services = createServices(library, { getTreeVersion });

    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toEqual([]);

    library.set('source.md', 'Now links to [[target]].');
    version += 1;

    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toEqual([
      expect.objectContaining({ filePath: 'source.md' }),
    ]);
  });

  it('rescans on every request when no tree version provider exists', () => {
    const library: Library = new Map([
      ['source.md', 'No links yet.'],
      ['Space/target.md', '# Target'],
    ]);
    const services = createServices(library);

    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toEqual([]);

    library.set('source.md', 'Now links to [[target]].');

    expect(handleBacklinks(new URLSearchParams('path=Space/target.md'), services).body).toEqual([
      expect.objectContaining({ filePath: 'source.md' }),
    ]);
  });

  it('falls back to a fresh scan when the version provider throws', () => {
    const library: Library = new Map([
      ['source.md', 'See [[target]].'],
      ['target.md', '# Target'],
    ]);
    const services = createServices(library, {
      getTreeVersion: () => {
        throw new Error('version unavailable');
      },
    });

    const response = handleBacklinks(new URLSearchParams('path=target.md'), services);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ filePath: 'source.md' })]);
  });

  it('returns an empty graph and no backlinks for an empty library', () => {
    const services = createServices(new Map(), { getTreeVersion: () => 1 });
    expect(handleGraph(services).body).toMatchObject({ nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } });
    expect(handleBacklinks(new URLSearchParams('path=missing.md'), services).body).toEqual([]);
  });

  it('skips files deleted between listing and reading', () => {
    const library: Library = new Map([
      ['source.md', 'See [[target]].'],
      ['target.md', '# Target'],
    ]);
    const services = {
      collectAllFiles: () => ['ghost.md', ...library.keys()],
      readTextFile: (path: string) => {
        const content = library.get(path);
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
      },
      getTreeVersion: () => 1,
    };

    const response = handleBacklinks(new URLSearchParams('path=target.md'), services);
    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ filePath: 'source.md' })]);
  });

  it('still rejects backlink requests without a path', () => {
    const services = createServices(new Map(), { getTreeVersion: () => 1 });
    expect(handleBacklinks(new URLSearchParams(), services)).toMatchObject({
      status: 400,
      body: { error: 'path required' },
    });
  });

  it('isolates caches between distinct version providers', () => {
    const libraryA: Library = new Map([['a.md', 'See [[b]].'], ['b.md', '# B']]);
    const libraryB: Library = new Map([['b.md', '# B, no links']]);
    const servicesA = createServices(libraryA, { getTreeVersion: () => 1 });
    const servicesB = createServices(libraryB, { getTreeVersion: () => 1 });

    expect(handleBacklinks(new URLSearchParams('path=b.md'), servicesA).body).toEqual([
      expect.objectContaining({ filePath: 'a.md' }),
    ]);
    expect(handleBacklinks(new URLSearchParams('path=b.md'), servicesB).body).toEqual([]);
  });

  it('exposes a consistent snapshot of files and hits', () => {
    const library: Library = new Map([
      ['source.md', 'See [[target]].'],
      ['target.md', '# Target'],
      ['image-note.md', '![pic](photo.png)'],
    ]);
    const services = createServices(library, { getTreeVersion: () => 3 });

    const snapshot = getLinkSnapshot(services);
    expect(snapshot.files).toEqual(['image-note.md', 'source.md', 'target.md']);
    expect(snapshot.hits).toEqual([
      expect.objectContaining({
        source: 'source.md',
        target: 'target.md',
        snippet: 'See [[target]].',
        resolution: 'resolved',
        line: 1,
        column: 5,
      }),
    ]);
    expect(snapshot.edgeAggregates).toEqual([
      expect.objectContaining({ source: 'source.md', target: 'target.md', kind: 'wiki', count: 1 }),
    ]);
    expect(snapshot.outgoingEdgesBySource.get('source.md')).toHaveLength(1);
    expect(snapshot.incomingEdgesByTarget.get('target.md')).toHaveLength(1);
    expect(snapshot.fileMetadata.get('target.md')).toMatchObject({ title: 'Target' });
    expect(snapshot.backlinksByTarget.get('target.md')?.get('source.md')).toEqual(new Set(['See [[target]].']));
    // Same version → identical snapshot instance (no re-scan).
    expect(getLinkSnapshot(services)).toBe(snapshot);
  });

  it('skips frontmatter, fenced code, and inline code while preserving link metadata', () => {
    const library: Library = new Map([
      [
        'root.md',
        [
          '---',
          'related: [[Frontmatter Ghost]]',
          'tags: [alpha]',
          '---',
          '# Root',
          '`[[Inline Code]]` and [[Target#Heading|Read target]].',
          '```md',
          '[[Fence Ghost]]',
          '```',
          '[Target label](Target.md#^block-id)',
          '[[#Local Section]]',
        ].join('\n'),
      ],
      ['Target.md', '# Target'],
    ]);
    const services = createServices(library, { getTreeVersion: () => 5 });

    const snapshot = getLinkSnapshot(services);

    expect(snapshot.fileMetadata.get('root.md')).toMatchObject({ tags: ['alpha'] });
    expect(snapshot.hits.map((hit) => hit.rawTarget).sort()).toEqual(['', 'Target', 'Target.md']);
    expect(snapshot.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'root.md',
        target: 'Target.md',
        kind: 'wiki',
        displayText: 'Read target',
        targetSubpath: { type: 'heading', value: 'Heading' },
        line: 6,
      }),
      expect.objectContaining({
        source: 'root.md',
        target: 'Target.md',
        kind: 'markdown',
        displayText: 'Target label',
        targetSubpath: { type: 'block', value: 'block-id' },
        line: 10,
      }),
      expect.objectContaining({
        source: 'root.md',
        target: 'root.md',
        kind: 'wiki',
        targetSubpath: { type: 'heading', value: 'Local Section' },
        line: 11,
      }),
    ]));
    expect(snapshot.hits.some((hit) => hit.rawTarget.includes('Ghost'))).toBe(false);
    expect(snapshot.hits.some((hit) => hit.rawTarget.includes('Inline Code'))).toBe(false);

    const graph = handleGraph(new URLSearchParams('scope=local&path=root.md&depth=1'), services).body as GraphData;
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: 'root.md',
        target: 'Target.md',
        kind: 'mixed',
        count: 2,
        subpaths: expect.arrayContaining([
          { type: 'heading', value: 'Heading' },
          { type: 'block', value: 'block-id' },
        ]),
      }),
    ]);
  });

  it('exposes unresolved, ambiguous, duplicate, and metadata details for graph rendering', () => {
    const library: Library = new Map([
      ['root.md', '---\ntags: [seed, graph]\n---\n# Root\nSee [[Existing]] and [[Existing]] plus [[Missing]] and [[Dup]]. [Child](Folder/Child.md) [pic](photo.png) ![mdpic](image-target.md)'],
      ['Existing.md', '# Existing'],
      ['Folder/Child.md', '# Child'],
      ['image-target.md', '# Image target'],
      ['Space/Dup.md', '# Dup 1'],
      ['Other/Dup.md', '# Dup 2'],
    ]);
    const services = createServices(library, { getTreeVersion: () => 9 });

    const graph = handleGraph(new URLSearchParams('scope=local&path=root.md&depth=1'), services).body as GraphData;

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root.md', label: 'Root', tags: ['graph', 'seed'], isCurrent: true }),
      expect.objectContaining({ id: 'Existing.md', isMissing: false }),
      expect.objectContaining({ id: 'Missing.md', type: 'missing', isMissing: true }),
      expect.objectContaining({ id: 'Dup.md', type: 'missing', isMissing: true }),
      expect.objectContaining({ id: 'Folder/Child.md', isMissing: false }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'root.md', target: 'Existing.md', kind: 'wiki', count: 2, unresolved: false }),
      expect.objectContaining({ source: 'root.md', target: 'Missing.md', kind: 'wiki', unresolved: true }),
      expect.objectContaining({
        source: 'root.md',
        target: 'Dup.md',
        ambiguous: true,
        candidates: ['Other/Dup.md', 'Space/Dup.md'],
      }),
      expect.objectContaining({ source: 'root.md', target: 'Folder/Child.md', kind: 'markdown' }),
    ]));
    expect(graph.edges.some((edge) => edge.target === 'photo.png')).toBe(false);
    expect(graph.edges.some((edge) => edge.target === 'image-target.md')).toBe(false);
    expect(graph.stats).toMatchObject({
      scope: 'local',
      depth: 1,
      unresolvedCount: 2,
      ambiguousCount: 1,
      treeVersion: 9,
    });

    const resolvedOnly = handleGraph(
      new URLSearchParams('scope=local&path=root.md&depth=1&includeUnresolved=false'),
      services,
    ).body as GraphData;
    expect(resolvedOnly.nodes.map((node) => node.id)).not.toContain('Missing.md');
    expect(resolvedOnly.nodes.map((node) => node.id)).not.toContain('Dup.md');
  });

  it('builds local graph projections by depth and direction', () => {
    const library: Library = new Map([
      ['A.md', 'Go [[B]].'],
      ['B.md', 'Go [[C]].'],
      ['C.md', '# C'],
      ['D.md', 'Points to [[A]].'],
    ]);
    const services = createServices(library, { getTreeVersion: () => 4 });

    const outgoing = handleGraph(new URLSearchParams('scope=local&path=A.md&depth=1&direction=outgoing'), services)
      .body as GraphData;
    expect(outgoing.nodes.map((node) => node.id).sort()).toEqual(['A.md', 'B.md']);

    const incoming = handleGraph(new URLSearchParams('scope=local&path=A.md&depth=1&direction=incoming'), services)
      .body as GraphData;
    expect(incoming.nodes.map((node) => node.id).sort()).toEqual(['A.md', 'D.md']);

    const twoHop = handleGraph(new URLSearchParams('scope=local&path=A.md&depth=2&direction=outgoing'), services)
      .body as GraphData;
    expect(twoHop.nodes.map((node) => node.id).sort()).toEqual(['A.md', 'B.md', 'C.md']);
  });
});
