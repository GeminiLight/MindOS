/**
 * Obsidian Plugin Compatibility - Public API
 * Main entry point for using the compat layer
 */

export { Plugin } from './shims/plugin';
export { Vault } from './shims/vault';
export { Notice, Modal } from './shims/ui';
export { PluginSettingTab, Setting } from './shims/settings';
export { AppShim } from './shims/app';
export { PluginLoader } from './loader';
export { PluginManager } from './plugin-manager';
export { scanObsidianVaultPlugins, importObsidianPlugin } from './obsidian-import';
export { analyzePluginCompatibility, getCompatibilityLevel } from './compatibility-report';
export { CommandRegistry } from './command-registry';
export { Component } from './component';
export { Events } from './events';
export { validateManifest, ManifestError } from './manifest';
export { CompatError, CompatErrorCodes } from './errors';
export type { PluginManifest, TFile, TFolder, TAbstractFile, Command } from './types';
