/**
 * Obsidian Plugin Compatibility - Plugin Loader
 * Scans .plugins/ directory, validates manifests, loads and executes plugins
 */

import fs from 'fs';
import path from 'path';
import { validateManifest, ManifestError } from './manifest';
import { CompatError, CompatErrorCodes } from './errors';
import { Plugin } from './shims/plugin';
import { createObsidianModule } from './shims/obsidian';
import { AppShim } from './shims/app';
import { PluginManifest } from './types';

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: Plugin;
  pluginDir: string;
}

/**
 * Plugin loader: scans .plugins/ directory and loads valid plugins
 */
export class PluginLoader {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private app: AppShim;

  constructor(private mindRoot: string) {
    this.app = new AppShim(mindRoot);
  }

  private resolvePluginDir(pluginId: string): string {
    if (!pluginId || pluginId.includes('..') || pluginId.includes('/') || pluginId.includes('\\')) {
      throw new CompatError(`Plugin path escapes .plugins directory: ${pluginId}`, CompatErrorCodes.PLUGIN_NOT_FOUND, { pluginId });
    }
    const pluginsDir = path.resolve(path.join(this.mindRoot, '.plugins'));
    const pluginDir = path.resolve(path.join(pluginsDir, pluginId));

    if (!pluginDir.startsWith(pluginsDir + path.sep)) {
      throw new CompatError(`Plugin path escapes .plugins directory: ${pluginId}`, CompatErrorCodes.PLUGIN_NOT_FOUND, { pluginId });
    }

    return pluginDir;
  }

  /**
   * Scan .plugins/ directory and discover all plugins.
   */
  discoverPlugins(): PluginManifest[] {
    const pluginsDir = path.join(this.mindRoot, '.plugins');

    if (!fs.existsSync(pluginsDir)) {
      return [];
    }

    const discovered: PluginManifest[] = [];

    try {
      const entries = fs.readdirSync(pluginsDir);
      for (const entry of entries) {
        const pluginDir = path.join(pluginsDir, entry);
        const manifestPath = path.join(pluginDir, 'manifest.json');

        if (!fs.statSync(pluginDir).isDirectory()) {
          continue;
        }

        if (!fs.existsSync(manifestPath)) {
          console.warn(`[obsidian-compat] Plugin "${entry}" has no manifest.json, skipping`);
          continue;
        }

        try {
          const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
          const manifestObj = JSON.parse(manifestRaw);
          const manifest = validateManifest(manifestObj);
          discovered.push(manifest);
        } catch (err) {
          if (err instanceof ManifestError) {
            console.error(`[obsidian-compat] Invalid manifest in plugin "${entry}": ${err.message}`);
          } else {
            console.error(`[obsidian-compat] Failed to read manifest in plugin "${entry}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch (err) {
      console.error(`[obsidian-compat] Failed to scan plugins directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    return discovered;
  }

  /**
   * Load a plugin by ID.
   */
  async loadPlugin(pluginId: string): Promise<LoadedPlugin> {
    if (this.plugins.has(pluginId)) {
      throw new CompatError(`Plugin already loaded: ${pluginId}`, CompatErrorCodes.PLUGIN_ALREADY_LOADED);
    }

    const pluginDir = this.resolvePluginDir(pluginId);
    const manifestPath = path.join(pluginDir, 'manifest.json');
    const mainPath = path.join(pluginDir, 'main.js');

    // Validate manifest exists and is valid
    if (!fs.existsSync(manifestPath)) {
      throw new CompatError(`Plugin manifest not found: ${pluginId}`, CompatErrorCodes.MANIFEST_READ_FAILED, { pluginId });
    }

    let manifest: PluginManifest;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = validateManifest(JSON.parse(raw));
    } catch (err) {
      throw new CompatError(
        `Invalid plugin manifest: ${err instanceof ManifestError ? err.message : String(err)}`,
        CompatErrorCodes.MANIFEST_INVALID,
        { pluginId },
      );
    }

    // Check if main.js exists
    if (!fs.existsSync(mainPath)) {
      throw new CompatError(`Plugin main.js not found: ${pluginId}`, CompatErrorCodes.MODULE_LOAD_FAILED, { pluginId });
    }

    // Load and execute main.js with obsidian shim
    let instance: Plugin;
    try {
      const code = fs.readFileSync(mainPath, 'utf-8');
      instance = this.executePluginModule(code, manifest, pluginDir);
    } catch (err) {
      throw new CompatError(
        `Failed to load plugin: ${err instanceof Error ? err.message : String(err)}`,
        CompatErrorCodes.MODULE_LOAD_FAILED,
        { pluginId },
      );
    }

    const loaded: LoadedPlugin = { manifest, instance, pluginDir };
    this.plugins.set(pluginId, loaded);

    // Call onload
    try {
      await instance.load();
    } catch (err) {
      this.plugins.delete(pluginId);
      throw new CompatError(
        `Plugin onload failed: ${err instanceof Error ? err.message : String(err)}`,
        CompatErrorCodes.PLUGIN_RUNTIME_ERROR,
        { pluginId },
      );
    }

    return loaded;
  }

  /**
   * Unload a plugin by ID.
   */
  async unloadPlugin(pluginId: string): Promise<void> {
    const loaded = this.plugins.get(pluginId);
    if (!loaded) {
      throw new CompatError(`Plugin not loaded: ${pluginId}`, CompatErrorCodes.PLUGIN_NOT_LOADED, { pluginId });
    }

    try {
      await loaded.instance.unload();
    } catch (err) {
      console.error(`[obsidian-compat] Error during plugin unload: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.app.unregisterAllCommands(pluginId);
    this.plugins.delete(pluginId);
  }

  /**
   * Execute plugin code in a sandbox with obsidian shim.
   */
  private executePluginModule(code: string, manifest: PluginManifest, pluginDir: string): Plugin {
    const module = { exports: {} as any };
    const exports = module.exports;

    const obsidianModule = createObsidianModule();

    const require = (id: string) => {
      if (id === 'obsidian') {
        return obsidianModule;
      }
      throw new CompatError(`Unsupported module: ${id}`, CompatErrorCodes.MODULE_NOT_SUPPORTED, { moduleId: id });
    };

    try {
      const wrappedCode = `${code}\n//# sourceURL=obsidian-plugin:${manifest.id}/main.js`;
      const fn = new Function('module', 'exports', 'require', 'console', wrappedCode);
      fn(module, exports, require, console);
    } catch (err) {
      throw new Error(`Plugin code execution failed for "${manifest.id}": ${err instanceof Error ? err.message : String(err)}`);
    }

    // Instantiate plugin
    const PluginClass = module.exports.default || module.exports;
    if (typeof PluginClass !== 'function') {
      throw new Error('Plugin must export a default Plugin class');
    }

    const instance = new PluginClass(this.app, manifest, pluginDir) as Plugin;
    if (!(instance instanceof Plugin)) {
      throw new Error('Plugin instance is not instanceof Plugin');
    }

    return instance;
  }

  /**
   * Get all loaded plugins.
   */
  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get the app shim (for testing/integration).
   */
  getApp(): AppShim {
    return this.app;
  }
}
