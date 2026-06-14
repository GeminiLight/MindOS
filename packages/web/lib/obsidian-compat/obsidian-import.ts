/**
 * Obsidian Plugin Compatibility - Obsidian vault import scanner
 * Scans `.obsidian/plugins` and imports selected plugins into MindOS `.plugins`.
 */

import fs from 'fs';
import path from 'path';
import { analyzePluginCompatibility, getCompatibilityLevel, type CompatibilityLevel, type PluginCompatibilityReport } from './compatibility-report';
import { validateManifest } from './manifest';
import type { PluginManifest } from './types';
import { resolveExistingSafe } from '@/lib/core/security';

export interface ObsidianPluginHotkey {
  modifiers: string[];
  key: string;
}

export interface ObsidianPluginCommandHotkeys {
  commandId: string;
  hotkeys: ObsidianPluginHotkey[];
}

export interface ObsidianVaultPluginConfig {
  enabledInObsidian: boolean;
  hotkeys: ObsidianPluginCommandHotkeys[];
  hotkeyCount: number;
}

export interface ImportedObsidianPluginConfig extends ObsidianVaultPluginConfig {
  schemaVersion: 1;
  source: 'obsidian';
  pluginId: string;
}

interface ObsidianVaultConfigSnapshot {
  enabledPluginIds: Set<string>;
  hotkeys: Map<string, ObsidianPluginHotkey[]>;
}

export interface ScannedObsidianPlugin {
  id: string;
  manifest: PluginManifest;
  sourceDir: string;
  compatibility: PluginCompatibilityReport;
  compatibilityLevel: CompatibilityLevel;
  hasStyles: boolean;
  hasData: boolean;
  obsidianConfig: ObsidianVaultPluginConfig;
}

export interface SkippedPlugin {
  dirName: string;
  reason: string;
}

export interface ScanResult {
  plugins: ScannedObsidianPlugin[];
  skipped: SkippedPlugin[];
}

export interface ImportObsidianPluginOptions {
  vaultRoot: string;
  pluginId: string;
  targetMindRoot: string;
}

export interface ImportedObsidianPlugin {
  pluginId: string;
  targetDir: string;
  obsidianConfig: ImportedObsidianPluginConfig;
}

function resolveVaultPluginsDir(vaultRoot: string): string {
  return resolveExistingSafe(vaultRoot, '.obsidian/plugins');
}

function resolvePluginDir(root: string, basePath: string, pluginId: string): string {
  if (!pluginId || pluginId.includes('..') || pluginId.includes('/') || pluginId.includes('\\')) {
    throw new Error(`Plugin path escapes plugins directory: ${pluginId}`);
  }
  try {
    return resolveExistingSafe(root, `${basePath}/${pluginId}`);
  } catch {
    throw new Error(`Plugin path escapes plugins directory: ${pluginId}`);
  }
}

function readManifest(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  return validateManifest(JSON.parse(raw));
}

function readMainCode(pluginDir: string): string {
  return fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf-8');
}

function readJsonFile(root: string, relativePath: string): unknown | null {
  try {
    const filePath = resolveExistingSafe(root, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readObsidianEnabledPluginIds(vaultRoot: string): Set<string> {
  const parsed = readJsonFile(vaultRoot, '.obsidian/community-plugins.json');
  if (Array.isArray(parsed)) {
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.enabledPlugins)) {
      return new Set(record.enabledPlugins.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
    }
    return new Set(Object.entries(record)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginId]) => pluginId));
  }
  return new Set();
}

function normalizeHotkey(value: unknown): ObsidianPluginHotkey | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { modifiers?: unknown; key?: unknown };
  if (typeof record.key !== 'string' || record.key.trim().length === 0) return null;
  const modifiers = Array.isArray(record.modifiers)
    ? record.modifiers.filter((modifier): modifier is string => typeof modifier === 'string' && modifier.trim().length > 0)
    : [];
  return {
    modifiers,
    key: record.key.trim(),
  };
}

function normalizeHotkeyList(value: unknown): ObsidianPluginHotkey[] {
  if (Array.isArray(value)) {
    return value.map(normalizeHotkey).filter((hotkey): hotkey is ObsidianPluginHotkey => hotkey !== null);
  }
  if (value && typeof value === 'object') {
    const record = value as { hotkeys?: unknown };
    if (Array.isArray(record.hotkeys)) {
      return normalizeHotkeyList(record.hotkeys);
    }
    const hotkey = normalizeHotkey(value);
    return hotkey ? [hotkey] : [];
  }
  return [];
}

function readObsidianHotkeys(vaultRoot: string): Map<string, ObsidianPluginHotkey[]> {
  const parsed = readJsonFile(vaultRoot, '.obsidian/hotkeys.json');
  const hotkeys = new Map<string, ObsidianPluginHotkey[]>();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return hotkeys;
  }

  for (const [commandId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const list = normalizeHotkeyList(value);
    if (list.length > 0) {
      hotkeys.set(commandId, list);
    }
  }
  return hotkeys;
}

function readObsidianVaultConfigSnapshot(vaultRoot: string): ObsidianVaultConfigSnapshot {
  return {
    enabledPluginIds: readObsidianEnabledPluginIds(vaultRoot),
    hotkeys: readObsidianHotkeys(vaultRoot),
  };
}

function obsidianVaultPluginConfigFromSnapshot(snapshot: ObsidianVaultConfigSnapshot, pluginId: string): ObsidianVaultPluginConfig {
  const hotkeys = Array.from(snapshot.hotkeys.entries())
    .filter(([commandId]) => commandId === pluginId || commandId.startsWith(`${pluginId}:`) || commandId.startsWith(`obsidian:${pluginId}:`))
    .map(([commandId, list]) => ({ commandId, hotkeys: list }))
    .sort((a, b) => a.commandId.localeCompare(b.commandId, 'en'));

  return {
    enabledInObsidian: snapshot.enabledPluginIds.has(pluginId),
    hotkeys,
    hotkeyCount: hotkeys.reduce((sum, item) => sum + item.hotkeys.length, 0),
  };
}

export function readObsidianVaultPluginConfig(vaultRoot: string, pluginId: string): ObsidianVaultPluginConfig {
  return obsidianVaultPluginConfigFromSnapshot(readObsidianVaultConfigSnapshot(vaultRoot), pluginId);
}

function toImportedObsidianPluginConfig(pluginId: string, config: ObsidianVaultPluginConfig): ImportedObsidianPluginConfig {
  return {
    schemaVersion: 1,
    source: 'obsidian',
    pluginId,
    enabledInObsidian: config.enabledInObsidian,
    hotkeys: config.hotkeys,
    hotkeyCount: config.hotkeyCount,
  };
}

export function readImportedObsidianPluginConfig(mindRoot: string, pluginId: string): ImportedObsidianPluginConfig | null {
  try {
    const pluginDir = resolvePluginDir(mindRoot, '.plugins', pluginId);
    const parsed = readJsonFile(pluginDir, 'obsidian-import.json');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Partial<ImportedObsidianPluginConfig>;
    if (record.schemaVersion !== 1 || record.source !== 'obsidian' || record.pluginId !== pluginId) {
      return null;
    }
    const hotkeys = Array.isArray(record.hotkeys)
      ? record.hotkeys
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const commandId = (item as { commandId?: unknown }).commandId;
          if (typeof commandId !== 'string' || commandId.trim().length === 0) return null;
          const list = normalizeHotkeyList((item as { hotkeys?: unknown }).hotkeys);
          return list.length > 0 ? { commandId: commandId.trim(), hotkeys: list } : null;
        })
        .filter((item): item is ObsidianPluginCommandHotkeys => item !== null)
      : [];
    return {
      schemaVersion: 1,
      source: 'obsidian',
      pluginId,
      enabledInObsidian: record.enabledInObsidian === true,
      hotkeys,
      hotkeyCount: hotkeys.reduce((sum, item) => sum + item.hotkeys.length, 0),
    };
  } catch {
    return null;
  }
}

export async function scanObsidianVaultPlugins(vaultRoot: string): Promise<ScanResult> {
  let pluginsDir: string;
  try {
    pluginsDir = resolveVaultPluginsDir(vaultRoot);
  } catch {
    return { plugins: [], skipped: [] };
  }
  if (!fs.existsSync(pluginsDir)) {
    return { plugins: [], skipped: [] };
  }

  const entries = fs.readdirSync(pluginsDir);
  const obsidianConfigSnapshot = readObsidianVaultConfigSnapshot(vaultRoot);
  const plugins: ScannedObsidianPlugin[] = [];
  const skipped: SkippedPlugin[] = [];

  for (const entry of entries) {
    const pluginDir = path.resolve(path.join(pluginsDir, entry));
    if (!fs.existsSync(pluginDir) || !fs.lstatSync(pluginDir).isDirectory()) {
      continue;
    }

    try {
      const manifest = readManifest(pluginDir);
      const code = readMainCode(pluginDir);
      const compatibility = analyzePluginCompatibility(code, manifest);
      const obsidianConfig = obsidianVaultPluginConfigFromSnapshot(obsidianConfigSnapshot, manifest.id);
      plugins.push({
        id: manifest.id,
        manifest,
        sourceDir: pluginDir,
        compatibility,
        compatibilityLevel: getCompatibilityLevel(compatibility),
        hasStyles: fs.existsSync(path.join(pluginDir, 'styles.css')),
        hasData: fs.existsSync(path.join(pluginDir, 'data.json')),
        obsidianConfig,
      });
    } catch (err) {
      skipped.push({
        dirName: entry,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    plugins: plugins.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    skipped,
  };
}

export async function importObsidianPlugin(options: ImportObsidianPluginOptions): Promise<ImportedObsidianPlugin> {
  const sourceDir = resolvePluginDir(options.vaultRoot, '.obsidian/plugins', options.pluginId);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Obsidian plugin not found: ${options.pluginId}`);
  }

  let targetDir: string;
  try {
    resolveExistingSafe(options.targetMindRoot, '.plugins');
    targetDir = resolveExistingSafe(options.targetMindRoot, `.plugins/${options.pluginId}`);
  } catch {
    throw new Error(`Plugin target path escapes .plugins directory: ${options.pluginId}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const fileName of ['manifest.json', 'main.js', 'styles.css', 'data.json']) {
    const from = path.join(sourceDir, fileName);
    const to = path.join(targetDir, fileName);
    if (fs.existsSync(from) && fs.statSync(from).isFile()) {
      fs.copyFileSync(from, to);
    }
  }
  const obsidianConfig = toImportedObsidianPluginConfig(
    options.pluginId,
    readObsidianVaultPluginConfig(options.vaultRoot, options.pluginId),
  );
  fs.writeFileSync(
    path.join(targetDir, 'obsidian-import.json'),
    JSON.stringify(obsidianConfig, null, 2),
    'utf-8',
  );

  return {
    pluginId: options.pluginId,
    targetDir,
    obsidianConfig,
  };
}
