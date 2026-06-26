/**
 * Obsidian Plugin Compatibility - Plugin Loader
 * Scans MindOS Obsidian plugin directories, validates manifests, loads and executes plugins
 */

import fs from 'fs';
import path from 'path';
import nodeAssert from 'assert';
import nodeAssertStrict from 'assert/strict';
import * as nodeBuffer from 'buffer';
import * as nodeCrypto from 'crypto';
import * as nodeEvents from 'events';
import * as nodeQuerystring from 'querystring';
import * as nodeStream from 'stream';
import * as nodeStringDecoder from 'string_decoder';
import * as nodeTimers from 'timers';
import * as nodeTimersPromises from 'timers/promises';
import * as nodeUrl from 'url';
import * as nodeUtil from 'util';
import { validateManifest, ManifestError } from './manifest';
import { CompatError, CompatErrorCodes } from './errors';
import { Plugin } from './shims/plugin';
import { createObsidianModule } from './shims/obsidian';
import { AppShim, type AppShimOptions } from './shims/app';
import { createObsidianElement } from './shims/dom';
import { ObsidianRuntimeHost } from './runtime';
import { ObsidianRuntimeCapabilityLedgerStore } from './runtime-capability-ledger-store';
import { PluginManifest } from './types';
import {
  assertSafeObsidianPluginId,
  resolveInstalledObsidianPluginDir,
  resolveObsidianPluginRootsForRead,
} from './plugin-paths';

export interface LoadedPlugin {
  manifest: PluginManifest;
  instance: Plugin;
  pluginDir: string;
}

export interface PluginLoaderOptions extends AppShimOptions {
  runtimeCapabilityLedgerStore?: ObsidianRuntimeCapabilityLedgerStore;
}

type PluginLocalStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type PluginDocumentShim = {
  body: HTMLElement;
  head: HTMLElement;
  createElement(tagName: string): HTMLElement;
  createEl(tagName: string, attrs?: unknown, callback?: (el: HTMLElement) => void): HTMLElement;
  createDocumentFragment(): DocumentFragment | HTMLElement;
  addEventListener(): void;
  removeEventListener(): void;
  on(): void;
  off(): void;
  querySelector(selector: string): HTMLElement | null;
  querySelectorAll(selector: string): HTMLElement[];
  getElementsByTagName(tagName: string): HTMLElement[];
  getElementsByClassName(className: string): HTMLElement[];
};

class CompatibilityHTMLElement {}

/**
 * Plugin loader: scans MindOS Obsidian plugin directories and loads valid plugins
 */
export class PluginLoader {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private app: AppShim;

  constructor(private mindRoot: string, options: PluginLoaderOptions = {}) {
    const { runtimeCapabilityLedgerStore, ...appOptions } = options;
    const ledgerStore = runtimeCapabilityLedgerStore ?? new ObsidianRuntimeCapabilityLedgerStore(mindRoot);
    this.app = new AppShim(mindRoot, new ObsidianRuntimeHost({
      capabilityLedgerStore: ledgerStore,
    }), appOptions);
  }

  private resolvePluginDir(pluginId: string): string {
    try {
      assertSafeObsidianPluginId(pluginId);
    } catch {
      throw new CompatError(`Plugin path escapes MindOS plugin directory: ${pluginId}`, CompatErrorCodes.PLUGIN_NOT_FOUND, { pluginId });
    }
    const location = resolveInstalledObsidianPluginDir(this.mindRoot, pluginId);
    if (!location) {
      throw new CompatError(`Plugin not found: ${pluginId}`, CompatErrorCodes.PLUGIN_NOT_FOUND, { pluginId });
    }
    return location.pluginDir;
  }

  /**
   * Scan canonical .mindos/plugins plus legacy .plugins and discover all plugins.
   */
  discoverPlugins(): PluginManifest[] {
    const discovered: PluginManifest[] = [];
    const seenPluginIds = new Set<string>();

    for (const root of resolveObsidianPluginRootsForRead(this.mindRoot)) {
      let entries: string[];
      try {
        entries = fs.readdirSync(root.rootDir);
      } catch (err) {
        console.error(`[obsidian-compat] Failed to scan plugins directory: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const entry of entries) {
        if (entry.startsWith('.')) {
          continue;
        }
        const pluginDir = path.join(root.rootDir, entry);
        const manifestPath = path.join(pluginDir, 'manifest.json');

        const pluginDirStats = fs.lstatSync(pluginDir);
        if (pluginDirStats.isSymbolicLink() || !pluginDirStats.isDirectory()) {
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
          if (manifest.id !== entry) {
            console.warn(`[obsidian-compat] Plugin directory "${entry}" does not match manifest id "${manifest.id}", skipping`);
            continue;
          }
          if (seenPluginIds.has(manifest.id)) {
            console.warn(`[obsidian-compat] Duplicate plugin "${manifest.id}" found in legacy plugins directory, using canonical package`);
            continue;
          }
          seenPluginIds.add(manifest.id);
          discovered.push(manifest);
        } catch (err) {
          if (err instanceof ManifestError) {
            console.error(`[obsidian-compat] Invalid manifest in plugin "${entry}": ${err.message}`);
          } else {
            console.error(`[obsidian-compat] Failed to read manifest in plugin "${entry}": ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    return discovered;
  }

  /**
   * Load a plugin by ID.
   */
  async loadPlugin(pluginId: string): Promise<LoadedPlugin> {
    if (this.plugins.has(pluginId)) {
      return this.plugins.get(pluginId)!;
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
      await this.app.getRuntimeHost().runWithPluginContext(pluginId, () => instance.load());
    } catch (err) {
      await this.cleanupPlugin(pluginId, instance);
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
      await this.app.getRuntimeHost().runWithPluginContext(pluginId, () => loaded.instance.unload());
    } catch (err) {
      console.error(`[obsidian-compat] Error during plugin unload: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.clearPluginRegistrations(pluginId);
  }

  /**
   * Execute plugin code in a restricted CommonJS wrapper with the Obsidian shim.
   *
   * This is compatibility isolation for unsupported imports, not a security
   * sandbox for arbitrary untrusted plugin code.
   */
  private executePluginModule(code: string, manifest: PluginManifest, pluginDir: string): Plugin {
    const module = { exports: {} as any };
    const exports = module.exports;

    const obsidianModule = createObsidianModule();
    const supportedRuntimeModules: Record<string, unknown> = {
      path,
      'node:path': path,
      assert: nodeAssert,
      'node:assert': nodeAssert,
      'assert/strict': nodeAssertStrict,
      'node:assert/strict': nodeAssertStrict,
      buffer: nodeBuffer,
      'node:buffer': nodeBuffer,
      crypto: nodeCrypto,
      'node:crypto': nodeCrypto,
      events: nodeEvents,
      'node:events': nodeEvents,
      querystring: nodeQuerystring,
      'node:querystring': nodeQuerystring,
      stream: nodeStream,
      'node:stream': nodeStream,
      string_decoder: nodeStringDecoder,
      'node:string_decoder': nodeStringDecoder,
      timers: nodeTimers,
      'node:timers': nodeTimers,
      'timers/promises': nodeTimersPromises,
      'node:timers/promises': nodeTimersPromises,
      url: nodeUrl,
      'node:url': nodeUrl,
      util: nodeUtil,
      'node:util': nodeUtil,
    };

    const require = (id: string) => {
      if (id === 'obsidian') {
        return obsidianModule;
      }
      if (Object.prototype.hasOwnProperty.call(supportedRuntimeModules, id)) {
        return supportedRuntimeModules[id];
      }
      throw new CompatError(`Unsupported module: ${id}`, CompatErrorCodes.MODULE_NOT_SUPPORTED, { moduleId: id });
    };

    const globals = this.createPluginGlobals(obsidianModule);

    try {
      const wrappedCode = `${code}\n//# sourceURL=obsidian-plugin:${manifest.id}/main.js`;
      const fn = new Function(
        'module',
        'exports',
        'require',
        'console',
        'window',
        'document',
        'activeWindow',
        'activeDocument',
        'self',
        'globalThis',
        'localStorage',
        'app',
        'createEl',
        'createDiv',
        'createSpan',
        'createFragment',
        'HTMLElement',
        'CodeMirror',
        'CodeMirrorAdapter',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        wrappedCode,
      );
      fn(
        module,
        exports,
        require,
        console,
        globals.window,
        globals.document,
        globals.activeWindow,
        globals.document,
        globals.window,
        globals.window,
        globals.localStorage,
        this.app,
        globals.createEl,
        globals.createDiv,
        globals.createSpan,
        globals.createFragment,
        globals.HTMLElement,
        globals.CodeMirror,
        globals.CodeMirrorAdapter,
        globals.setTimeout,
        globals.clearTimeout,
        globals.setInterval,
        globals.clearInterval,
      );
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

  private createPluginGlobals(obsidianModule: Record<string, unknown>) {
    const localStorage = this.createLocalStorageShim();
    const documentShim = this.createDocumentShim();
    const codeMirrorShim = this.createCodeMirrorShim();
    const codeMirrorAdapterShim = { commands: {} as Record<string, unknown> };
    const createEl = (tagName: string, attrs?: unknown, callback?: (el: HTMLElement) => void) => {
      const element = createObsidianElement(tagName);
      this.applyCreateElAttrs(element, attrs);
      callback?.(element);
      return element;
    };
    const createDiv = (attrs?: unknown, callback?: (el: HTMLElement) => void) => createEl('div', attrs, callback);
    const createSpan = (attrs?: unknown, callback?: (el: HTMLElement) => void) => createEl('span', attrs, callback);
    const createFragment = (callback?: (el: HTMLElement) => void) => {
      const fragment = createObsidianElement('fragment');
      callback?.(fragment);
      return fragment;
    };
    const runSafely = (callback: unknown, args: unknown[]) => {
      try {
        if (typeof callback === 'function') {
          (callback as (...values: unknown[]) => void)(...args);
        }
      } catch (err) {
        this.app.getRuntimeHost().warn({
          code: 'plugin-async-callback-error',
          message: `Plugin async callback failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };
    const safeSetTimeout = (callback: unknown, timeout?: number, ...args: unknown[]) => (
      setTimeout(() => runSafely(callback, args), timeout)
    );
    const safeSetInterval = (callback: unknown, timeout?: number, ...args: unknown[]) => (
      setInterval(() => runSafely(callback, args), timeout)
    );

    const windowShim = {
      app: this.app,
      document: documentShim,
      activeDocument: documentShim,
      CodeMirror: codeMirrorShim,
      CodeMirrorAdapter: codeMirrorAdapterShim,
      localStorage,
      moment: obsidianModule.moment,
      setTimeout: safeSetTimeout,
      clearTimeout,
      setInterval: safeSetInterval,
      clearInterval,
      requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
      cancelAnimationFrame: (id: number) => clearTimeout(id),
      addEventListener: () => {},
      removeEventListener: () => {},
      getComputedStyle: () => ({
        getPropertyValue: () => '',
      }),
    } as Record<string, unknown>;
    windowShim.window = windowShim;
    windowShim.self = windowShim;
    windowShim.globalThis = windowShim;
    windowShim.activeWindow = windowShim;

    return {
      window: windowShim,
      document: documentShim,
      activeWindow: windowShim,
      localStorage,
      createEl,
      createDiv,
      createSpan,
      createFragment,
      HTMLElement: typeof HTMLElement === 'undefined' ? CompatibilityHTMLElement : HTMLElement,
      CodeMirror: codeMirrorShim,
      CodeMirrorAdapter: codeMirrorAdapterShim,
      setTimeout: safeSetTimeout,
      clearTimeout,
      setInterval: safeSetInterval,
      clearInterval,
    };
  }

  private createLocalStorageShim(): PluginLocalStorage {
    return {
      getItem: (key: string) => {
        const value = this.app.loadLocalStorage(String(key));
        return typeof value === 'string' ? value : value == null ? null : JSON.stringify(value);
      },
      setItem: (key: string, value: string) => {
        this.app.saveLocalStorage(String(key), String(value));
      },
      removeItem: (key: string) => {
        this.app.removeLocalStorage(String(key));
      },
    };
  }

  private createDocumentShim(): PluginDocumentShim {
    const body = createObsidianElement('body');
    const head = createObsidianElement('head');
    const querySelectorAll = (selector: string): HTMLElement[] => [
      ...Array.from(body.querySelectorAll(selector)),
      ...Array.from(head.querySelectorAll(selector)),
    ] as HTMLElement[];
    const classSelector = (className: string): string => className
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `.${item.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`)
      .join('');
    return {
      body,
      head,
      createElement: (tagName: string) => createObsidianElement(tagName),
      createEl: (tagName: string, attrs?: unknown, callback?: (el: HTMLElement) => void) => {
        const element = createObsidianElement(tagName);
        this.applyCreateElAttrs(element, attrs);
        callback?.(element);
        return element;
      },
      createDocumentFragment: () => createObsidianElement('fragment'),
      addEventListener: () => {},
      removeEventListener: () => {},
      on: () => {},
      off: () => {},
      querySelector: (selector: string) => querySelectorAll(selector)[0] ?? null,
      querySelectorAll,
      getElementsByTagName: (tagName: string) => {
        const normalized = tagName.toLowerCase();
        if (normalized === 'body') return [body];
        if (normalized === 'head') return [head];
        return [];
      },
      getElementsByClassName: (className: string) => {
        const selector = classSelector(className);
        return selector ? querySelectorAll(selector) : [];
      },
    };
  }

  private createCodeMirrorShim() {
    const modes: Record<string, unknown> = {};
    return {
      modes,
      defineMode: (name: string, factory: unknown) => {
        modes[String(name)] = factory;
      },
      getMode: (_config: unknown, name: string) => modes[String(name)] ?? { name },
    };
  }

  private applyCreateElAttrs(element: HTMLElement, attrs: unknown): void {
    if (!attrs || typeof attrs !== 'object') return;
    const values = attrs as {
      text?: unknown;
      cls?: unknown;
      attr?: Record<string, unknown>;
      href?: unknown;
      title?: unknown;
      type?: unknown;
      value?: unknown;
    };
    if (values.text !== undefined) element.textContent = String(values.text);
    if (typeof values.cls === 'string') {
      element.classList.add(...values.cls.split(/\s+/).filter(Boolean));
    } else if (Array.isArray(values.cls)) {
      element.classList.add(...values.cls.map(String));
    }
    if (values.href !== undefined) element.setAttribute('href', String(values.href));
    if (values.title !== undefined) element.setAttribute('title', String(values.title));
    if (values.type !== undefined) element.setAttribute('type', String(values.type));
    if (values.value !== undefined) {
      (element as unknown as { value: string }).value = String(values.value);
    }
    for (const [key, value] of Object.entries(values.attr ?? {})) {
      element.setAttribute(key, String(value));
    }
  }

  private async cleanupPlugin(pluginId: string, instance: Plugin): Promise<void> {
    try {
      await instance.unload();
    } catch (err) {
      console.error(`[obsidian-compat] Error during failed plugin cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.clearPluginRegistrations(pluginId);
  }

  private clearPluginRegistrations(pluginId: string): void {
    this.app.unregisterAllCommands(pluginId);
    this.app.getRuntimeHost().unregisterPlugin(pluginId);
    delete this.app.plugins.plugins[pluginId];
    this.app.plugins.enabledPlugins.delete(pluginId);
    this.plugins.delete(pluginId);
  }
}
