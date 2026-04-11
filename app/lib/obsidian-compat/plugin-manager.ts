/**
 * Obsidian Plugin Compatibility - Plugin Manager
 * Persists enabled state and orchestrates bulk plugin loading.
 */

import fs from 'fs';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel, type CompatibilityLevel, type PluginCompatibilityReport } from './compatibility-report';
import { importObsidianPlugin, scanObsidianVaultPlugins, type ScanResult } from './obsidian-import';
import { PluginLoader } from './loader';
import type { PluginManifest } from './types';

interface PluginManagerState {
  enabled: Record<string, boolean>;
}

export interface ManagedPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  loaded: boolean;
  compatibility: PluginCompatibilityReport;
  compatibilityLevel: CompatibilityLevel;
  lastError?: string;
}

export interface LoadEnabledResult {
  loaded: string[];
  failed: string[];
}

const EMPTY_STATE: PluginManagerState = { enabled: {} };

export class PluginManager {
  private readonly loader: PluginLoader;
  private readonly stateFilePath: string;
  private plugins = new Map<string, ManagedPlugin>();

  constructor(private mindRoot: string) {
    this.loader = new PluginLoader(mindRoot);
    this.stateFilePath = path.join(mindRoot, '.plugins', '.plugin-manager.json');
  }

  async discover(): Promise<ManagedPlugin[]> {
    const persisted = this.readState();
    const manifests = this.loader.discoverPlugins();

    this.plugins.clear();
    for (const manifest of manifests) {
      this.plugins.set(manifest.id, this.toManagedPlugin(manifest, persisted));
    }

    return this.list();
  }

  list(): ManagedPlugin[] {
    return Array.from(this.plugins.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  async enable(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    plugin.enabled = true;
    plugin.lastError = undefined;
    this.writeState();
  }

  async disable(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.loaded) {
      await this.loader.unloadPlugin(pluginId);
    }
    plugin.enabled = false;
    plugin.loaded = false;
    plugin.lastError = undefined;
    this.writeState();
  }

  async loadEnabledPlugins(): Promise<LoadEnabledResult> {
    const result: LoadEnabledResult = { loaded: [], failed: [] };

    for (const plugin of this.list()) {
      if (!plugin.enabled) {
        continue;
      }

      try {
        await this.loader.loadPlugin(plugin.id);
        plugin.loaded = true;
        plugin.lastError = undefined;
        result.loaded.push(plugin.id);
      } catch (error) {
        plugin.loaded = false;
        plugin.lastError = error instanceof Error ? error.message : String(error);
        result.failed.push(plugin.id);
      }
    }

    this.writeState();
    return result;
  }

  getLoader(): PluginLoader {
    return this.loader;
  }

  async scanObsidianVault(vaultRoot: string): Promise<ScanResult> {
    return scanObsidianVaultPlugins(vaultRoot);
  }

  async importFromObsidianVault(vaultRoot: string, pluginId: string): Promise<void> {
    await importObsidianPlugin({
      vaultRoot,
      pluginId,
      targetMindRoot: this.mindRoot,
    });
  }

  private toManagedPlugin(manifest: PluginManifest, state: PluginManagerState): ManagedPlugin {
    const loaded = this.loader.getLoadedPlugins().some((plugin) => plugin.manifest.id === manifest.id);
    const pluginDir = path.join(this.mindRoot, '.plugins', manifest.id);
    const mainPath = path.join(pluginDir, 'main.js');
    const code = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf-8') : '';
    const compatibility = analyzePluginCompatibility(code);

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      enabled: state.enabled[manifest.id] === true,
      loaded,
      compatibility,
      compatibilityLevel: getCompatibilityLevel(compatibility),
    };
  }

  private requirePlugin(pluginId: string): ManagedPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }
    return plugin;
  }

  private readState(): PluginManagerState {
    if (!fs.existsSync(this.stateFilePath)) {
      return { ...EMPTY_STATE, enabled: {} };
    }

    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PluginManagerState>;
      return {
        enabled: parsed.enabled ?? {},
      };
    } catch {
      return { ...EMPTY_STATE, enabled: {} };
    }
  }

  private writeState(): void {
    const enabled: Record<string, boolean> = {};
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled) {
        enabled[plugin.id] = true;
      }
    }

    try {
      fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
      fs.writeFileSync(this.stateFilePath, JSON.stringify({ enabled }, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[obsidian-compat] Failed to write plugin state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
