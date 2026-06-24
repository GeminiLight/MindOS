/**
 * Obsidian Plugin Compatibility - Plugin Shim
 * Base class for all Obsidian plugins
 */

import { Component } from '../component';
import type { App, Command, IPlugin, PluginManifest, PluginSettingTab, ViewCreator, CodeBlockProcessor, MarkdownPostProcessor } from '../types';
import type { ObsidianRuntimeHost } from '../runtime';
import { createObsidianElement } from './dom';
import fs from 'fs';
import path from 'path';

type RuntimeApp = App & { getRuntimeHost?: () => ObsidianRuntimeHost };

function getRuntimeHost(app: App): ObsidianRuntimeHost | null {
  return (app as RuntimeApp).getRuntimeHost?.() ?? null;
}

export class Plugin extends Component implements IPlugin {
  app: App;
  manifest: PluginManifest;
  settingTabs: PluginSettingTab[] = [];

  private dataFilePath: string;

  constructor(app: App, manifest: PluginManifest, pluginDir: string) {
    super();
    this.app = app;
    this.manifest = manifest;
    this.dataFilePath = path.join(pluginDir, 'data.json');
    if (this.app.plugins) {
      this.app.plugins.plugins[this.manifest.id] = this;
      this.app.plugins.enabledPlugins.add(this.manifest.id);
    }
  }

  async loadData(): Promise<unknown> {
    if (!fs.existsSync(this.dataFilePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      const message = `Failed to load plugin data for "${this.manifest.id}": ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[obsidian-compat] ${message}`);
      throw new Error(message);
    }
  }

  async saveData(data: unknown): Promise<void> {
    try {
      const dir = path.dirname(this.dataFilePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[obsidian-compat] Failed to save plugin data: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  addCommand(command: Command): Command {
    return this.app.registerCommand(this.manifest.id, command);
  }

  removeCommand(commandId: string): void {
    this.app.unregisterCommand(this.manifest.id, commandId);
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => any): HTMLElement {
    const el = createObsidianElement('button');
    el.textContent = icon;
    el.title = title;
    el.addEventListener('click', callback as EventListener);
    getRuntimeHost(this.app)?.registerRibbonIcon(this.manifest.id, icon, title, el, callback);
    return el;
  }

  addStatusBarItem(): HTMLElement {
    const el = createObsidianElement('div');
    getRuntimeHost(this.app)?.registerStatusBarItem(this.manifest.id, el);
    return el;
  }

  registerView(type: string, creator: ViewCreator): void {
    getRuntimeHost(this.app)?.registerView(this.manifest.id, type, creator);
  }

  registerExtensions(extensions: string[], viewType: string): void {
    getRuntimeHost(this.app)?.registerViewExtensions(this.manifest.id, extensions, viewType);
  }

  registerHoverLinkSource(source: string, options: unknown): void {
    this.app.workspace.registerHoverLinkSource?.(source, options);
  }

  registerEditorExtension(extension: unknown): void {
    getRuntimeHost(this.app)?.registerEditorExtension(this.manifest.id, extension);
  }

  registerEditorSuggest(editorSuggest: unknown): void {
    getRuntimeHost(this.app)?.registerEditorSuggest(this.manifest.id, editorSuggest);
  }

  registerMarkdownCodeBlockProcessor(language: string, processor: CodeBlockProcessor): void {
    getRuntimeHost(this.app)?.registerMarkdownCodeBlockProcessor(this.manifest.id, language, processor);
  }

  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): void {
    getRuntimeHost(this.app)?.registerMarkdownPostProcessor(this.manifest.id, processor);
  }

  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void {
    void handler;
    getRuntimeHost(this.app)?.warn({
      code: 'obsidian-protocol-handler-recorded-only',
      message: `Plugin "${this.manifest.id}" registered obsidian://${action}; MindOS records protocol handlers as no-ops in Phase 1.`,
    });
  }

  registerCliHandler(command: string, description: string, args: unknown, handler: (params: Record<string, string>) => unknown): boolean {
    void args;
    void handler;
    getRuntimeHost(this.app)?.warn({
      code: 'obsidian-cli-handler-recorded-only',
      message: `Plugin "${this.manifest.id}" registered CLI handler "${command}" (${description}); MindOS records CLI handlers as no-ops in Phase 1.`,
    });
    return true;
  }
}
