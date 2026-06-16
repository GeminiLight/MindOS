import { ComponentType } from 'react';
import type { PluginFundingUrl, PluginManifest } from '@/lib/obsidian-compat/types';

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
  /**
   * Obsidian-compatible manifest identity for MindOS built-in extensions.
   * Defaults are supplied by `toRendererPluginManifest` for legacy renderer
   * definitions, but new user-facing renderers should set these explicitly.
   */
  version?: string;
  minAppVersion?: string;
  minMindOsVersion?: string;
  authorUrl?: string;
  fundingUrl?: PluginFundingUrl;
  isDesktopOnly?: boolean;
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

export type RendererPluginManifest = PluginManifest & {
  description: string;
  author: string;
  minAppVersion: string;
  isDesktopOnly: boolean;
};

const registry: RendererDefinition[] = [];
const DEFAULT_RENDERER_PLUGIN_VERSION = '1.0.0';
const DEFAULT_RENDERER_PLUGIN_MIN_APP_VERSION = '1.0.0';

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

export function toRendererPluginManifest(renderer: RendererDefinition): RendererPluginManifest {
  const manifest: RendererPluginManifest = {
    id: renderer.id,
    name: renderer.name,
    version: renderer.version ?? DEFAULT_RENDERER_PLUGIN_VERSION,
    minAppVersion: renderer.minAppVersion ?? DEFAULT_RENDERER_PLUGIN_MIN_APP_VERSION,
    ...(renderer.minMindOsVersion ? { minMindOsVersion: renderer.minMindOsVersion } : {}),
    description: renderer.description,
    author: renderer.author,
    ...(renderer.authorUrl ? { authorUrl: renderer.authorUrl } : {}),
    ...(renderer.fundingUrl ? { fundingUrl: renderer.fundingUrl } : {}),
    isDesktopOnly: renderer.isDesktopOnly === true,
  };
  validateRendererPluginManifest(manifest);
  return manifest;
}

function validateRendererPluginManifest(manifest: RendererPluginManifest): void {
  if (!isObsidianCompatiblePluginId(manifest.id)) {
    throw new Error(`Invalid built-in extension id "${manifest.id}". Use lowercase letters and hyphens, and avoid "obsidian" or a trailing "plugin".`);
  }
  if (!isSemver(manifest.version)) {
    throw new Error(`Invalid built-in extension version for "${manifest.id}": "${manifest.version}". Use x.y.z semver.`);
  }
  if (!isSemver(manifest.minAppVersion)) {
    throw new Error(`Invalid built-in extension minAppVersion for "${manifest.id}": "${manifest.minAppVersion}". Use x.y.z semver.`);
  }
  if (!manifest.name.trim()) {
    throw new Error(`Built-in extension "${manifest.id}" is missing a display name.`);
  }
  if (!manifest.description.trim()) {
    throw new Error(`Built-in extension "${manifest.id}" is missing a description.`);
  }
  if (!manifest.author.trim()) {
    throw new Error(`Built-in extension "${manifest.id}" is missing an author.`);
  }
}

function isObsidianCompatiblePluginId(id: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(id)
    && !id.includes('obsidian')
    && !id.endsWith('plugin');
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}
