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
  entryPath?: string;    // canonical entry file shown on home page (e.g. 'TODO.md')
  match: (ctx: Pick<RendererContext, 'filePath' | 'extension'>) => boolean;
  // Provide either `component` (eager) or `load` (lazy). Prefer `load` for code-splitting.
  component?: ComponentType<RendererContext>;
  load?: () => Promise<{ default: ComponentType<RendererContext> }>;
}

const registry: RendererDefinition[] = [];

// Disabled plugin IDs — persisted to localStorage on client
let _disabledIds: Set<string> = new Set();

export function loadDisabledState() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('mindos-disabled-renderers');
    _disabledIds = new Set(raw ? JSON.parse(raw) : []);
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
    localStorage.setItem('mindos-disabled-renderers', JSON.stringify([..._disabledIds]));
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
