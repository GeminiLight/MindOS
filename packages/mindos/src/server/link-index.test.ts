import { describe, expect, it, vi } from 'vitest';
import { handleBacklinks, handleGraph } from './handlers/graph.js';
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
    expect(graph.body.edges).toEqual([{ source: 'source.md', target: 'Space/target.md' }]);
    // No additional full-library reads for the cached calls.
    expect(services.readTextFile.mock.calls.length).toBe(readsAfterFirst);
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
    expect(handleGraph(services).body).toEqual({ nodes: [], edges: [] });
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
      { source: 'source.md', target: 'target.md', snippet: 'See [[target]].' },
    ]);
    expect(snapshot.backlinksByTarget.get('target.md')?.get('source.md')).toEqual(new Set(['See [[target]].']));
    // Same version → identical snapshot instance (no re-scan).
    expect(getLinkSnapshot(services)).toBe(snapshot);
  });
});
