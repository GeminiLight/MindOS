/**
 * Obsidian Plugin Compatibility - Static compatibility analyzer
 * Scans plugin code to infer required APIs and likely blockers.
 */

export type CompatibilityLevel = 'compatible' | 'partial' | 'blocked';

export interface PluginCompatibilityReport {
  obsidianApis: string[];
  nodeModules: string[];
  supportedApis: string[];
  partialApis: string[];
  blockers: string[];
}

const SUPPORTED_APIS = new Set([
  'Plugin',
  'Component',
  'Events',
  'Notice',
  'Modal',
  'PluginSettingTab',
  'Setting',
  'TFile',
  'TFolder',
  'TAbstractFile',
  'loadData',
  'saveData',
  'addCommand',
  'MetadataCache.getCache',
  'MetadataCache.getFileCache',
]);

const PARTIAL_APIS = new Set([
  'registerView',
  'registerMarkdownPostProcessor',
  'registerMarkdownCodeBlockProcessor',
  'registerEditorExtension',
  'ItemView',
  'WorkspaceLeaf',
]);

const NODE_BLOCKLIST = new Set([
  'fs',
  'path',
  'child_process',
  'electron',
  'os',
  'net',
  'tls',
  'worker_threads',
]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function collectObsidianImports(code: string): string[] {
  const apis: string[] = [];

  const destructured = code.matchAll(/require\('obsidian'\)\s*;?|const\s*\{([^}]+)\}\s*=\s*require\('obsidian'\)|import\s*\{([^}]+)\}\s*from\s*['"]obsidian['"]/g);
  for (const match of destructured) {
    const names = (match[1] ?? match[2])?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
    apis.push(...names);
  }

  const methodPatterns: Array<[RegExp, string]> = [
    [/\.addCommand\s*\(/, 'addCommand'],
    [/\.loadData\s*\(/, 'loadData'],
    [/\.saveData\s*\(/, 'saveData'],
    [/\.registerView\s*\(/, 'registerView'],
    [/\.registerMarkdownPostProcessor\s*\(/, 'registerMarkdownPostProcessor'],
    [/\.registerMarkdownCodeBlockProcessor\s*\(/, 'registerMarkdownCodeBlockProcessor'],
    [/\.registerEditorExtension\s*\(/, 'registerEditorExtension'],
    [/metadataCache\.getCache\s*\(/, 'MetadataCache.getCache'],
    [/metadataCache\.getFileCache\s*\(/, 'MetadataCache.getFileCache'],
  ];

  for (const [pattern, name] of methodPatterns) {
    if (pattern.test(code)) {
      apis.push(name);
    }
  }

  return unique(apis);
}

function collectNodeModules(code: string): string[] {
  const modules: string[] = [];
  const matches = code.matchAll(/require\('([^']+)'\)/g);
  for (const match of matches) {
    const moduleName = match[1];
    if (!moduleName || moduleName === 'obsidian') {
      continue;
    }
    if (NODE_BLOCKLIST.has(moduleName)) {
      modules.push(moduleName);
    }
  }
  return unique(modules);
}

export function analyzePluginCompatibility(code: string): PluginCompatibilityReport {
  const obsidianApis = collectObsidianImports(code);
  const nodeModules = collectNodeModules(code);

  const supportedApis = obsidianApis.filter((api) => SUPPORTED_APIS.has(api));
  const partialApis = obsidianApis.filter((api) => PARTIAL_APIS.has(api));

  const blockers = [
    ...nodeModules.map((moduleName) => `Requires unsupported runtime module: ${moduleName}`),
  ];

  return {
    obsidianApis,
    nodeModules,
    supportedApis: unique(supportedApis),
    partialApis: unique(partialApis),
    blockers: unique(blockers),
  };
}

export function getCompatibilityLevel(report: PluginCompatibilityReport): CompatibilityLevel {
  if (report.blockers.length > 0) {
    return 'blocked';
  }
  if (report.partialApis.length > 0) {
    return 'partial';
  }
  return 'compatible';
}
