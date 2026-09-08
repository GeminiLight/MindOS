/**
 * Dependency-free bridge between the app fs layer (`lib/fs.ts`) and the
 * `/api/events` stream route.
 *
 * `lib/fs.ts` is imported by `app/layout` for the file tree, so importing the
 * core server package from it would drag every Product Server handler into
 * ordinary page renders. Instead the route registers a hook here at module
 * load and `lib/fs.ts` notifies through this module, which has no imports of
 * its own (same shape as `core/search-index-bridge.ts`).
 *
 * If the route was never loaded there is no connected client, so dropping the
 * notification is correct: the stream's `ready` frame carries the current
 * version when a client eventually connects.
 *
 * Hooks live on `globalThis` keyed by name so bundler-duplicated module graphs
 * and HMR re-evaluations share one registry and never double-register.
 */

export type TreeVersionHook = (version: number) => void;

const REGISTRY_KEY = Symbol.for('mindos.tree-version-hooks');

type GlobalWithRegistry = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, TreeVersionHook>;
};

function registry(): Map<string, TreeVersionHook> {
  const g = globalThis as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map<string, TreeVersionHook>();
  return g[REGISTRY_KEY];
}

/**
 * Register (or replace) the hook stored under `key`. Returns an unregister
 * function that only removes the hook if it is still the registered one.
 */
export function registerTreeVersionHook(key: string, hook: TreeVersionHook): () => void {
  registry().set(key, hook);
  return () => {
    if (registry().get(key) === hook) registry().delete(key);
  };
}

export function notifyTreeVersionChanged(version: number): void {
  if (!Number.isFinite(version)) return;
  for (const hook of registry().values()) {
    try {
      hook(version);
    } catch {
      // Change notifications are best-effort; the fs layer must never fail because of a listener.
    }
  }
}

export function hasTreeVersionHooks(): boolean {
  return registry().size > 0;
}
