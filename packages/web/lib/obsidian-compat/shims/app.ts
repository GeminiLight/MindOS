/**
 * Obsidian Plugin Compatibility - App Shim
 * Central app adapter that plugins interact with
 */

import { Vault } from './vault';
import { MetadataCacheShim } from './metadata-cache';
import { CommandRegistry } from '../command-registry';
import { App, Command, IMetadataCache, Workspace } from '../types';

/**
 * Minimal Workspace implementation.
 */
class WorkspaceShim implements Workspace {
  getActiveFile() {
    return null; // TODO: integrate with MindOS current file
  }

  async openLinkText(linktext: string, sourcePath: string): Promise<void> {
    void linktext;
    void sourcePath;
  }
}

/**
 * App shim: central adapter that provides vault, metadata, workspace to plugins.
 */
export class AppShim implements App {
  vault: Vault;
  metadataCache: IMetadataCache;
  workspace: Workspace;
  private commandRegistry: CommandRegistry;

  constructor(mindRoot: string) {
    this.vault = new Vault(mindRoot);
    this.metadataCache = new MetadataCacheShim(mindRoot, this.vault);
    this.workspace = new WorkspaceShim();
    this.commandRegistry = new CommandRegistry();
  }

  isDarkMode(): boolean {
    // TODO: detect MindOS theme
    return false;
  }

  loadLocalStorage(key: string): unknown {
    // TODO: use MindOS storage
    return null;
  }

  saveLocalStorage(key: string, data: unknown): void {
    // TODO: use MindOS storage
  }

  registerCommand(pluginId: string, command: Command): Command {
    return this.commandRegistry.register(pluginId, command);
  }

  unregisterCommand(pluginId: string, commandId: string): void {
    this.commandRegistry.unregister(pluginId, commandId);
  }

  unregisterAllCommands(pluginId: string): void {
    this.commandRegistry.unregisterAll(pluginId);
  }

  getCommands() {
    return this.commandRegistry.list();
  }

  executeCommand(fullId: string): Promise<void> {
    return this.commandRegistry.execute(fullId);
  }
}
