import { ComponentType } from 'react';

export interface RendererContext {
  filePath: string;
  content: string;
  extension: string;
  saveAction: (content: string) => Promise<void>;
}

export interface RendererDefinition {
  id: string;
  name: string;
  description: string;
  author: string;
  icon: string;          // emoji or short string
  tags: string[];
  builtin: boolean;      // true = ships with MindOS; false = user-installed (future)
  core?: boolean;        // true = default renderer for a file type, cannot be disabled by user
  /**
   * App-builtin feature (not a user-facing plugin).
   * When true, keep renderer functional but hide from Plugins surfaces.
   */
  appBuiltinFeature?: boolean;
  entryPath?: string;    // canonical entry file shown on home page (e.g. 'TODO.md')
  match: (ctx: Pick<RendererContext, 'filePath' | 'extension'>) => boolean;
  // Provide either `component` (eager) or `load` (lazy). Prefer `load` for code-splitting.
  component?: ComponentType<RendererContext>;
  load?: () => Promise<{ default: ComponentType<RendererContext> }>;
}

const registry: RendererDefinition[] = [];

// Disabled plugin IDs — persisted to localStorage on client
let _disabledIds: Set<string> = new Set();

function parseDisabledIds(raw: string | null): Set<string> {
  if (!raw) return new Set();

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return new Set();

  return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
}

export function loadDisabledState() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('mindos-disabled-renderers');
    _disabledIds = parseDisabledIds(raw);
  } catch {
    _disabledIds = new Set();
  }
}

export function setRendererEnabled(id: string, enabled: boolean) {
  // Core renderers cannot be disabled
  const def = registry.find(r => r.id === id);
  if (def?.core) return;
  if (enabled) {
    _disabledIds.delete(id);
  } else {
    _disabledIds.add(id);
  }
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('mindos-disabled-renderers', JSON.stringify([..._disabledIds]));
    } catch {
      // Keep the in-memory setting for the current session if localStorage is unavailable.
    }
  }
}

export function isRendererEnabled(id: string): boolean {
  // Core renderers cannot be disabled
  const def = registry.find(r => r.id === id);
  if (def?.core) return true;
  return !_disabledIds.has(id);
}

export function registerRenderer(def: RendererDefinition) {
  if (!registry.find(r => r.id === def.id)) registry.push(def);
}

export function resolveRenderer(
  filePath: string,
  extension: string,
  forceId?: string,
): RendererDefinition | undefined {
  if (forceId) {
    const r = registry.find(d => d.id === forceId);
    return r && isRendererEnabled(r.id) ? r : undefined;
  }
  return registry.find(r => isRendererEnabled(r.id) && r.match({ filePath, extension }));
}

export function getAllRenderers(): RendererDefinition[] {
  return registry;
}

/** User-facing plugins only (exclude app-builtin features like CSV). */
export function getPluginRenderers(): RendererDefinition[] {
  return registry.filter((r) => !r.appBuiltinFeature);
}
