/**
 * Obsidian Plugin Compatibility - Static compatibility analyzer
 * Scans plugin code to infer required APIs and likely blockers.
 */

export type CompatibilityLevel = 'compatible' | 'partial' | 'blocked';

export interface PluginCompatibilityReport {
  obsidianApis: string[];
  moduleImports: string[];
  nodeModules: string[];
  unsupportedModules: string[];
  supportedApis: string[];
  partialApis: string[];
  unsupportedApis: string[];
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
  'normalizePath',
  'Platform',
  'loadData',
  'saveData',
  'addCommand',
  'removeCommand',
  'addSettingTab',
  'addRibbonIcon',
  'addStatusBarItem',
  'Vault.read',
  'Vault.cachedRead',
  'Vault.create',
  'Vault.modify',
  'Vault.append',
  'Vault.appendBinary',
  'Vault.process',
  'Vault.getResourcePath',
  'Vault.delete',
  'Vault.trash',
  'Vault.rename',
  'Vault.copy',
  'Vault.adapter',
  'MetadataCache.getCache',
  'MetadataCache.getFileCache',
  'MetadataCache.getFirstLinkpathDest',
  'MetadataCache.fileToLinktext',
  'FileManager.processFrontMatter',
  'FileManager.generateMarkdownLink',
  'FileManager.getNewFileParent',
  'FileManager.renameFile',
  'FileManager.promptForDeletion',
  'FileManager.trashFile',
  'FileManager.getAvailablePathForAttachment',
  'Workspace.openLinkText',
  'Workspace.onLayoutReady',
  'Workspace.getActiveViewOfType',
  'Workspace.iterateRootLeaves',
  'Workspace.iterateAllLeaves',
  'request',
  'requestUrl',
]);

const PARTIAL_APIS = new Set([
  'registerView',
  'registerExtensions',
  'registerMarkdownPostProcessor',
  'registerMarkdownCodeBlockProcessor',
  'registerEditorExtension',
  'ItemView',
  'MarkdownView',
  'MarkdownRenderChild',
  'MarkdownRenderer',
  'WorkspaceLeaf',
  'Workspace.getLeaf',
  'Workspace.getLeavesOfType',
  'Menu',
  'MenuItem',
  'SuggestModal',
  'FuzzySuggestModal',
]);

const NODE_BLOCKLIST = new Set([
  'fs',
  'node:fs',
  'path',
  'node:path',
  'child_process',
  'node:child_process',
  'electron',
  'os',
  'node:os',
  'net',
  'node:net',
  'tls',
  'node:tls',
  'http',
  'node:http',
  'https',
  'node:https',
  'crypto',
  'node:crypto',
  'worker_threads',
  'node:worker_threads',
]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function collectObsidianImports(code: string): string[] {
  const apis: string[] = [];

  const destructured = code.matchAll(/require\(['"]obsidian['"]\)\s*;?|const\s*\{([^}]+)\}\s*=\s*require\(['"]obsidian['"]\)|import\s*\{([^}]+)\}\s*from\s*['"]obsidian['"]/g);
  for (const match of destructured) {
    const names = (match[1] ?? match[2])?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
    apis.push(...names);
  }

  const methodPatterns: Array<[RegExp, string]> = [
    [/\.addCommand\s*\(/, 'addCommand'],
    [/\.removeCommand\s*\(/, 'removeCommand'],
    [/\.addSettingTab\s*\(/, 'addSettingTab'],
    [/\.addRibbonIcon\s*\(/, 'addRibbonIcon'],
    [/\.addStatusBarItem\s*\(/, 'addStatusBarItem'],
    [/\.loadData\s*\(/, 'loadData'],
    [/\.saveData\s*\(/, 'saveData'],
    [/\.vault\.read\s*\(|\bvault\.read\s*\(/, 'Vault.read'],
    [/\.vault\.cachedRead\s*\(|\bvault\.cachedRead\s*\(/, 'Vault.cachedRead'],
    [/\.vault\.create\s*\(|\bvault\.create\s*\(/, 'Vault.create'],
    [/\.vault\.modify\s*\(|\bvault\.modify\s*\(/, 'Vault.modify'],
    [/\.vault\.append\s*\(|\bvault\.append\s*\(/, 'Vault.append'],
    [/\.vault\.appendBinary\s*\(|\bvault\.appendBinary\s*\(/, 'Vault.appendBinary'],
    [/\.vault\.process\s*\(|\bvault\.process\s*\(/, 'Vault.process'],
    [/\.vault\.getResourcePath\s*\(|\bvault\.getResourcePath\s*\(/, 'Vault.getResourcePath'],
    [/\.vault\.delete\s*\(|\bvault\.delete\s*\(/, 'Vault.delete'],
    [/\.vault\.trash\s*\(|\bvault\.trash\s*\(/, 'Vault.trash'],
    [/\.vault\.rename\s*\(|\bvault\.rename\s*\(/, 'Vault.rename'],
    [/\.vault\.copy\s*\(|\bvault\.copy\s*\(/, 'Vault.copy'],
    [/\.vault\.adapter\.|[^.\w]vault\.adapter\./, 'Vault.adapter'],
    [/\.registerView\s*\(/, 'registerView'],
    [/\.registerExtensions\s*\(/, 'registerExtensions'],
    [/\.registerMarkdownPostProcessor\s*\(/, 'registerMarkdownPostProcessor'],
    [/\.registerMarkdownCodeBlockProcessor\s*\(/, 'registerMarkdownCodeBlockProcessor'],
    [/\.registerEditorExtension\s*\(/, 'registerEditorExtension'],
    [/metadataCache\.getCache\s*\(/, 'MetadataCache.getCache'],
    [/metadataCache\.getFileCache\s*\(/, 'MetadataCache.getFileCache'],
    [/metadataCache\.getFirstLinkpathDest\s*\(/, 'MetadataCache.getFirstLinkpathDest'],
    [/metadataCache\.fileToLinktext\s*\(/, 'MetadataCache.fileToLinktext'],
    [/fileManager\.processFrontMatter\s*\(/, 'FileManager.processFrontMatter'],
    [/fileManager\.generateMarkdownLink\s*\(/, 'FileManager.generateMarkdownLink'],
    [/fileManager\.getNewFileParent\s*\(/, 'FileManager.getNewFileParent'],
    [/fileManager\.renameFile\s*\(/, 'FileManager.renameFile'],
    [/fileManager\.promptForDeletion\s*\(/, 'FileManager.promptForDeletion'],
    [/fileManager\.trashFile\s*\(/, 'FileManager.trashFile'],
    [/fileManager\.getAvailablePathForAttachment\s*\(/, 'FileManager.getAvailablePathForAttachment'],
    [/workspace\.openLinkText\s*\(/, 'Workspace.openLinkText'],
    [/workspace\.onLayoutReady\s*\(/, 'Workspace.onLayoutReady'],
    [/workspace\.getActiveViewOfType\s*\(/, 'Workspace.getActiveViewOfType'],
    [/workspace\.iterateRootLeaves\s*\(/, 'Workspace.iterateRootLeaves'],
    [/workspace\.iterateAllLeaves\s*\(/, 'Workspace.iterateAllLeaves'],
    [/workspace\.getLeaf\s*\(/, 'Workspace.getLeaf'],
    [/workspace\.getLeavesOfType\s*\(/, 'Workspace.getLeavesOfType'],
    [/\brequestUrl\s*\(/, 'requestUrl'],
    [/\brequest\s*\(/, 'request'],
    [/\bMarkdownRenderer\.renderMarkdown\s*\(|\bMarkdownRenderer\.render\s*\(/, 'MarkdownRenderer'],
    [/\bnormalizePath\s*\(/, 'normalizePath'],
  ];

  for (const [pattern, name] of methodPatterns) {
    if (pattern.test(code)) {
      apis.push(name);
    }
  }

  const namespaceMatches = code.matchAll(/\bobsidian\.([A-Za-z_$][\w$]*)/g);
  for (const match of namespaceMatches) {
    if (match[1]) {
      apis.push(match[1]);
    }
  }

  return unique(apis);
}

function collectModuleImports(code: string): string[] {
  const modules: string[] = [];
  const requireMatches = code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of requireMatches) {
    const moduleName = match[1];
    if (moduleName && moduleName !== 'obsidian') {
      modules.push(moduleName);
    }
  }

  const dynamicImportMatches = code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
  for (const match of dynamicImportMatches) {
    const moduleName = match[1];
    if (moduleName && moduleName !== 'obsidian') {
      modules.push(moduleName);
    }
  }

  const staticImportMatches = code.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g);
  for (const match of staticImportMatches) {
    const moduleName = match[1];
    if (moduleName && moduleName !== 'obsidian') {
      modules.push(moduleName);
    }
  }

  const exportFromMatches = code.matchAll(/\bexport\s+[^'"]+\s+from\s+['"]([^'"]+)['"]/g);
  for (const match of exportFromMatches) {
    const moduleName = match[1];
    if (moduleName && moduleName !== 'obsidian') {
      modules.push(moduleName);
    }
  }

  return unique(modules);
}

function collectNodeModules(moduleImports: string[]): string[] {
  const modules: string[] = [];
  for (const moduleName of moduleImports) {
    if (!moduleName || moduleName.startsWith('.') || moduleName.startsWith('/')) continue;
    const normalizedModuleName = moduleName.replace(/^node:/, '');
    if (NODE_BLOCKLIST.has(moduleName) || NODE_BLOCKLIST.has(normalizedModuleName)) {
      modules.push(moduleName);
    }
  }
  return unique(modules);
}

function collectUnsupportedModules(moduleImports: string[]): string[] {
  return unique(moduleImports);
}

function collectDynamicModuleBlockers(code: string): string[] {
  const blockers: string[] = [];
  if (/require\s*\(\s*[^'"\s]/.test(code)) {
    blockers.push('Uses dynamic require(), which the MindOS Obsidian runtime cannot safely resolve.');
  }
  if (/import\s*\(\s*[^'"\s]/.test(code)) {
    blockers.push('Uses dynamic import(), which the MindOS Obsidian runtime cannot safely resolve.');
  }
  return blockers;
}

export function analyzePluginCompatibility(code: string, manifest?: { isDesktopOnly?: boolean }): PluginCompatibilityReport {
  const obsidianApis = collectObsidianImports(code);
  const moduleImports = collectModuleImports(code);
  const nodeModules = collectNodeModules(moduleImports);
  const unsupportedModules = collectUnsupportedModules(moduleImports);

  const supportedApis = obsidianApis.filter((api) => SUPPORTED_APIS.has(api));
  const partialApis = obsidianApis.filter((api) => PARTIAL_APIS.has(api));
  const unsupportedApis = obsidianApis.filter((api) => !SUPPORTED_APIS.has(api) && !PARTIAL_APIS.has(api));

  const blockers = [
    ...(manifest?.isDesktopOnly ? ['Manifest marks this plugin as desktop-only.'] : []),
    ...unsupportedModules.map((moduleName) => `Requires unsupported runtime module: ${moduleName}`),
    ...collectDynamicModuleBlockers(code),
  ];

  return {
    obsidianApis,
    moduleImports,
    nodeModules,
    unsupportedModules,
    supportedApis: unique(supportedApis),
    partialApis: unique(partialApis),
    unsupportedApis: unique(unsupportedApis),
    blockers: unique(blockers),
  };
}

export function getCompatibilityLevel(report: PluginCompatibilityReport): CompatibilityLevel {
  if (report.blockers.length > 0) {
    return 'blocked';
  }
  if (report.partialApis.length > 0 || report.unsupportedApis.length > 0) {
    return 'partial';
  }
  return 'compatible';
}
