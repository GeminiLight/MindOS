/**
 * Lightweight bridge between the app fs layer (`lib/fs.ts`) and the core
 * search index (`lib/core/search.ts`).
 *
 * Why this exists: `lib/fs.ts` is imported by `app/layout` for the file
 * tree, so importing `core/search` from that boundary would pull the whole
 * search/index stack into ordinary page renders. Instead, `core/search`
 * registers its invalidation hooks here at module load, and `lib/fs.ts`
 * notifies through this module — which has no other imports.
 *
 * If `core/search` was never loaded, the index was never built, so dropping
 * the notification is the correct behavior (the eventual lazy build reads
 * fresh state from disk).
 *
 * Hooks are stored on `globalThis` so bundler-duplicated module graphs
 * (e.g. separate Next.js route bundles compiling this file twice) still
 * share one registry.
 */

export interface SearchIndexHooks {
  /** Drop the whole index; next search rebuilds from disk. */
  invalidateAll(): void;
  /** Incrementally (re-)index one file after create/write/edit. */
  updateFile(mindRoot: string, filePath: string): void;
  /** Remove a file — or a directory subtree — from the index after delete/move. */
  removePath(relPath: string): void;
}

const REGISTRY_KEY = Symbol.for('mindos.search-index-hooks');

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Set<SearchIndexHooks>;
};

function registry(): Set<SearchIndexHooks> {
  const g = globalThis as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Set<SearchIndexHooks>();
  return g[REGISTRY_KEY];
}

/** Register hooks (called by `core/search` at module load). Returns an unregister fn. */
export function registerSearchIndexHooks(hooks: SearchIndexHooks): () => void {
  registry().add(hooks);
  return () => registry().delete(hooks);
}

export function notifySearchIndexInvalidated(): void {
  for (const hooks of registry()) {
    try { hooks.invalidateAll(); } catch { /* index invalidation is best-effort */ }
  }
}

export function notifySearchIndexFileChanged(mindRoot: string, filePath: string): void {
  for (const hooks of registry()) {
    try { hooks.updateFile(mindRoot, filePath); } catch { /* best-effort */ }
  }
}

export function notifySearchIndexPathRemoved(relPath: string): void {
  for (const hooks of registry()) {
    try { hooks.removePath(relPath); } catch { /* best-effort */ }
  }
}
