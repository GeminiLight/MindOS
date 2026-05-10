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

export interface ScannedObsidianPlugin {
  id: string;
  manifest: PluginManifest;
  sourceDir: string;
  compatibility: PluginCompatibilityReport;
  compatibilityLevel: CompatibilityLevel;
  hasStyles: boolean;
  hasData: boolean;
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
      const compatibility = analyzePluginCompatibility(code);
      plugins.push({
        id: manifest.id,
        manifest,
        sourceDir: pluginDir,
        compatibility,
        compatibilityLevel: getCompatibilityLevel(compatibility),
        hasStyles: fs.existsSync(path.join(pluginDir, 'styles.css')),
        hasData: fs.existsSync(path.join(pluginDir, 'data.json')),
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

  return {
    pluginId: options.pluginId,
    targetDir,
  };
}
