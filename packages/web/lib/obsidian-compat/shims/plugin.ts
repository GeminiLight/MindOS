/**
 * Obsidian Plugin Compatibility - Plugin Shim
 * Base class for all Obsidian plugins
 */

import { Component } from '../component';
import { App, Command, IPlugin, PluginManifest, PluginSettingTab, ViewCreator, CodeBlockProcessor, MarkdownPostProcessor } from '../types';
import fs from 'fs';
import path from 'path';

type StubElement = {
  innerHTML: string;
  title: string;
  addEventListener: (type: string, callback: EventListenerOrEventListenerObject) => void;
};

function createHostElement(tagName: string): HTMLElement | StubElement {
  if (typeof document !== 'undefined') {
    return document.createElement(tagName);
  }

  return {
    innerHTML: '',
    title: '',
    addEventListener: () => {},
  };
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
    const el = createHostElement('div');
    el.innerHTML = icon;
    el.title = title;
    el.addEventListener('click', callback as EventListener);
    return el as HTMLElement;
  }

  addStatusBarItem(): HTMLElement {
    return createHostElement('div') as HTMLElement;
  }

  registerView(type: string, creator: ViewCreator): void {
    void type;
    void creator;
  }

  registerExtensions(extensions: string[], viewType: string): void {
    void extensions;
    void viewType;
  }

  registerMarkdownCodeBlockProcessor(language: string, processor: CodeBlockProcessor): void {
    void language;
    void processor;
  }

  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): void {
    void processor;
  }
}
