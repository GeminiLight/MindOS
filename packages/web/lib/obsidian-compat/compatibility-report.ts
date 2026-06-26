/**
 * Obsidian Plugin Compatibility - Static compatibility analyzer
 * Scans plugin code to infer required APIs and likely blockers.
 */

import {
  isFullySupportedObsidianApi,
  isPartiallySupportedObsidianApi,
  isUnsupportedObsidianApi,
} from './capability-matrix';

export type CompatibilityLevel = 'compatible' | 'partial' | 'blocked';

export interface PluginPlatformRequirements {
  desktop: boolean;
  reasons: string[];
}

export interface PluginCompatibilityReport {
  obsidianApis: string[];
  moduleImports: string[];
  nodeModules: string[];
  supportedModules?: string[];
  unsupportedModules: string[];
  platformRequirements?: PluginPlatformRequirements;
  supportedApis: string[];
  partialApis: string[];
  unsupportedApis: string[];
  blockers: string[];
}

const NODE_RUNTIME_MODULES = new Set([
  'fs',
  'node:fs',
  'path',
  'node:path',
  'assert',
  'node:assert',
  'assert/strict',
  'node:assert/strict',
  'buffer',
  'node:buffer',
  'child_process',
  'node:child_process',
  'events',
  'node:events',
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
  'querystring',
  'node:querystring',
  'stream',
  'node:stream',
  'string_decoder',
  'node:string_decoder',
  'timers',
  'node:timers',
  'timers/promises',
  'node:timers/promises',
  'url',
  'node:url',
  'util',
  'node:util',
  'worker_threads',
  'node:worker_threads',
]);

const SUPPORTED_RUNTIME_MODULES = new Set([
  'path',
  'node:path',
  'assert',
  'node:assert',
  'assert/strict',
  'node:assert/strict',
  'buffer',
  'node:buffer',
  'crypto',
  'node:crypto',
  'events',
  'node:events',
  'querystring',
  'node:querystring',
  'stream',
  'node:stream',
  'string_decoder',
  'node:string_decoder',
  'timers',
  'node:timers',
  'timers/promises',
  'node:timers/promises',
  'url',
  'node:url',
  'util',
  'node:util',
]);

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function stripStringsAndComments(code: string): string {
  let output = '';
  let index = 0;
  let state: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code';

  while (index < code.length) {
    const char = code[index] ?? '';
    const next = code[index + 1] ?? '';

    if (state === 'code') {
      if (char === "'" || char === '"' || char === '`') {
        state = char === "'" ? 'single' : char === '"' ? 'double' : 'template';
        output += ' ';
      } else if (char === '/' && next === '/') {
        state = 'line-comment';
        output += '  ';
        index += 1;
      } else if (char === '/' && next === '*') {
        state = 'block-comment';
        output += '  ';
        index += 1;
      } else {
        output += char;
      }
      index += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        output += '\n';
      } else {
        output += ' ';
      }
      index += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        output += '  ';
        index += 2;
      } else {
        output += char === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (char === '\\') {
      output += ' ';
      if (index + 1 < code.length) {
        output += code[index + 1] === '\n' ? '\n' : ' ';
      }
      index += 2;
      continue;
    }

    if (
      (state === 'single' && char === "'")
      || (state === 'double' && char === '"')
      || (state === 'template' && char === '`')
    ) {
      state = 'code';
      output += ' ';
    } else {
      output += char === '\n' ? '\n' : ' ';
    }
    index += 1;
  }

  return output;
}

function normalizeImportedName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const withoutAlias = trimmed
    .replace(/\s+as\s+[A-Za-z_$][\w$]*$/u, '')
    .replace(/:\s*[A-Za-z_$][\w$]*$/u, '')
    .trim();
  return withoutAlias || null;
}

function collectObsidianNamespaceAliases(code: string): string[] {
  const aliases: string[] = [];

  const commonJsAliases = code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]obsidian['"]\)/g);
  for (const match of commonJsAliases) {
    if (match[1]) aliases.push(match[1]);
  }

  const esmAliases = code.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]obsidian['"]/g);
  for (const match of esmAliases) {
    if (match[1]) aliases.push(match[1]);
  }

  return unique(aliases);
}

function collectObsidianImports(code: string): string[] {
  const apis: string[] = [];

  const destructured = code.matchAll(/require\(['"]obsidian['"]\)\s*;?|const\s*\{([^}]+)\}\s*=\s*require\(['"]obsidian['"]\)|import\s*\{([^}]+)\}\s*from\s*['"]obsidian['"]/g);
  for (const match of destructured) {
    const names = (match[1] ?? match[2])
      ?.split(',')
      .map((item) => normalizeImportedName(item))
      .filter((item): item is string => Boolean(item)) ?? [];
    apis.push(...names);
  }

  const methodPatterns: Array<[RegExp, string]> = [
    [/\.addCommand\s*\(/, 'addCommand'],
    [/\.removeCommand\s*\(/, 'removeCommand'],
    [/\.commands\.listCommands\s*\(|\bcommands\.listCommands\s*\(/, 'Commands.listCommands'],
    [/\.addSettingTab\s*\(/, 'addSettingTab'],
    [/\.getSettingDefinitions\s*\(|\bgetSettingDefinitions\s*\(/, 'Plugin.getSettingDefinitions'],
    [/\.addRibbonIcon\s*\(/, 'addRibbonIcon'],
    [/\.addStatusBarItem\s*\(/, 'addStatusBarItem'],
    [/\.loadData\s*\(/, 'loadData'],
    [/\.saveData\s*\(/, 'saveData'],
    [/\.vault\.getAbstractFileByPath\s*\(|\bvault\.getAbstractFileByPath\s*\(/, 'Vault.getAbstractFileByPath'],
    [/\.vault\.getFileByPath\s*\(|\bvault\.getFileByPath\s*\(/, 'Vault.getFileByPath'],
    [/\.vault\.getFolderByPath\s*\(|\bvault\.getFolderByPath\s*\(/, 'Vault.getFolderByPath'],
    [/\.vault\.getMarkdownFiles\s*\(|\bvault\.getMarkdownFiles\s*\(/, 'Vault.getMarkdownFiles'],
    [/\.vault\.getAllLoadedFiles\s*\(|\bvault\.getAllLoadedFiles\s*\(/, 'Vault.getAllLoadedFiles'],
    [/\.vault\.getFiles\s*\(|\bvault\.getFiles\s*\(/, 'Vault.getFiles'],
    [/\.vault\.readBinary\s*\(|\bvault\.readBinary\s*\(/, 'Vault.readBinary'],
    [/\.vault\.read\s*\(|\bvault\.read\s*\(/, 'Vault.read'],
    [/\.vault\.cachedRead\s*\(|\bvault\.cachedRead\s*\(/, 'Vault.cachedRead'],
    [/\.vault\.createBinary\s*\(|\bvault\.createBinary\s*\(/, 'Vault.createBinary'],
    [/\.vault\.create\s*\(|\bvault\.create\s*\(/, 'Vault.create'],
    [/\.vault\.modifyBinary\s*\(|\bvault\.modifyBinary\s*\(/, 'Vault.modifyBinary'],
    [/\.vault\.modify\s*\(|\bvault\.modify\s*\(/, 'Vault.modify'],
    [/\.vault\.appendBinary\s*\(|\bvault\.appendBinary\s*\(/, 'Vault.appendBinary'],
    [/\.vault\.append\s*\(|\bvault\.append\s*\(/, 'Vault.append'],
    [/\.vault\.process\s*\(|\bvault\.process\s*\(/, 'Vault.process'],
    [/\.vault\.getResourcePath\s*\(|\bvault\.getResourcePath\s*\(/, 'Vault.getResourcePath'],
    [/\.vault\.getConfig\s*\(|\bvault\.getConfig\s*\(/, 'Vault.getConfig'],
    [/\.vault\.setConfig\s*\(|\bvault\.setConfig\s*\(/, 'Vault.setConfig'],
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
    [/\.registerEditorSuggest\s*\(/, 'registerEditorSuggest'],
    [/metadataCache\.getCache\s*\(/, 'MetadataCache.getCache'],
    [/metadataCache\.getFileCache\s*\(/, 'MetadataCache.getFileCache'],
    [/metadataCache\.getFirstLinkpathDest\s*\(/, 'MetadataCache.getFirstLinkpathDest'],
    [/metadataCache\.fileToLinktext\s*\(/, 'MetadataCache.fileToLinktext'],
    [/metadataCache\.resolvedLinks\b/, 'MetadataCache.resolvedLinks'],
    [/metadataCache\.unresolvedLinks\b/, 'MetadataCache.unresolvedLinks'],
    [/fileManager\.processFrontMatter\s*\(/, 'FileManager.processFrontMatter'],
    [/fileManager\.generateMarkdownLink\s*\(/, 'FileManager.generateMarkdownLink'],
    [/fileManager\.getNewFileParent\s*\(/, 'FileManager.getNewFileParent'],
    [/fileManager\.renameFile\s*\(/, 'FileManager.renameFile'],
    [/fileManager\.promptForDeletion\s*\(/, 'FileManager.promptForDeletion'],
    [/fileManager\.trashFile\s*\(/, 'FileManager.trashFile'],
    [/fileManager\.getAvailablePathForAttachment\s*\(/, 'FileManager.getAvailablePathForAttachment'],
    [/workspace\.openLinkText\s*\(/, 'Workspace.openLinkText'],
    [/workspace\.on\s*\(\s*['"]editor-menu['"]/, 'Workspace.editor-menu'],
    [/workspace\.on\s*\(/, 'Workspace.on'],
    [/workspace\.trigger\s*\(/, 'Workspace.trigger'],
    [/workspace\.onLayoutReady\s*\(/, 'Workspace.onLayoutReady'],
    [/workspace\.getActiveFile\s*\(/, 'Workspace.getActiveFile'],
    [/workspace\.getActiveViewOfType\s*\(/, 'Workspace.getActiveViewOfType'],
    [/workspace\.iterateRootLeaves\s*\(/, 'Workspace.iterateRootLeaves'],
    [/workspace\.iterateAllLeaves\s*\(/, 'Workspace.iterateAllLeaves'],
    [/workspace\.iterateCodeMirrors\s*\(/, 'Workspace.iterateCodeMirrors'],
    [/workspace\.getLeftLeaf\s*\(/, 'Workspace.getLeftLeaf'],
    [/workspace\.getRightLeaf\s*\(/, 'Workspace.getRightLeaf'],
    [/workspace\.getLeaf\s*\(/, 'Workspace.getLeaf'],
    [/workspace\.getLeavesOfType\s*\(/, 'Workspace.getLeavesOfType'],
    [/customCss\.getSnippetPath\s*\(/, 'CustomCss.getSnippetPath'],
    [/customCss\.setCssEnabledStatus\s*\(/, 'CustomCss.setCssEnabledStatus'],
    [/customCss\.readSnippets\s*\(/, 'CustomCss.readSnippets'],
    [/\b(?:window\.)?CodeMirror\.(?:defineMode|getMode|modes)\b/, 'CodeMirror'],
    [/\b(?:window\.)?CodeMirrorAdapter\.commands\b/, 'CodeMirrorAdapter.commands'],
    [/\brequestUrl\s*\(/, 'requestUrl'],
    [/\brequest\s*\(/, 'request'],
    [/\bMarkdownRenderer\.renderMarkdown\s*\(|\bMarkdownRenderer\.render\s*\(/, 'MarkdownRenderer'],
    [/\bhtmlToMarkdown\s*\(/, 'htmlToMarkdown'],
    [/\bgetLinkpath\s*\(/, 'getLinkpath'],
    [/\bparseLinktext\s*\(/, 'parseLinktext'],
    [/\barrayBufferToBase64\s*\(/, 'arrayBufferToBase64'],
    [/\bbase64ToArrayBuffer\s*\(/, 'base64ToArrayBuffer'],
    [/\bgetAllTags\s*\(/, 'getAllTags'],
    [/\brequireApiVersion\s*\(/, 'requireApiVersion'],
    [/\bnormalizePath\s*\(/, 'normalizePath'],
    [/\bprepareSimpleSearch\s*\(/, 'prepareSimpleSearch'],
    [/\brenderMatches\s*\(/, 'renderMatches'],
  ];

  for (const [pattern, name] of methodPatterns) {
    if (pattern.test(code)) {
      apis.push(name);
    }
  }

  for (const alias of collectObsidianNamespaceAliases(code)) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namespaceMatches = code.matchAll(new RegExp(`\\b${escapedAlias}\\.([A-Za-z_$][\\w$]*)`, 'g'));
    for (const match of namespaceMatches) {
      if (match[1]) {
        apis.push(match[1]);
      }
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
    if (NODE_RUNTIME_MODULES.has(moduleName) || NODE_RUNTIME_MODULES.has(normalizedModuleName)) {
      modules.push(moduleName);
    }
  }
  return unique(modules);
}

function collectSupportedModules(moduleImports: string[]): string[] {
  return unique(moduleImports.filter((moduleName) => SUPPORTED_RUNTIME_MODULES.has(moduleName)));
}

function collectUnsupportedModules(moduleImports: string[], supportedModules: string[]): string[] {
  const supported = new Set(supportedModules);
  return unique(moduleImports.filter((moduleName) => !supported.has(moduleName)));
}

function collectDynamicModuleBlockers(code: string): string[] {
  const blockers: string[] = [];
  const codeOnly = stripStringsAndComments(code);
  if (/(?<![.$\w\\])require\s*\(\s*[^'"\s)]/u.test(codeOnly)) {
    blockers.push('Uses dynamic require(), which the MindOS Obsidian runtime cannot safely resolve.');
  }
  if (/(?<![.$\w])import\s*\(\s*[^'"\s)]/u.test(codeOnly)) {
    blockers.push('Uses dynamic import(), which the MindOS Obsidian runtime cannot safely resolve.');
  }
  return blockers;
}

export function analyzePluginCompatibility(code: string, manifest?: { isDesktopOnly?: boolean }): PluginCompatibilityReport {
  const obsidianApis = collectObsidianImports(code);
  const moduleImports = collectModuleImports(code);
  const nodeModules = collectNodeModules(moduleImports);
  const supportedModules = collectSupportedModules(moduleImports);
  const unsupportedModules = collectUnsupportedModules(moduleImports, supportedModules);
  const platformRequirements: PluginPlatformRequirements = {
    desktop: manifest?.isDesktopOnly === true,
    reasons: manifest?.isDesktopOnly === true
      ? ['Manifest declares this plugin is desktop-only.']
      : [],
  };

  const supportedApis = obsidianApis.filter(isFullySupportedObsidianApi);
  const partialApis = obsidianApis.filter(isPartiallySupportedObsidianApi);
  const unsupportedApis = obsidianApis.filter(isUnsupportedObsidianApi);

  const blockers = [
    ...unsupportedModules.map((moduleName) => `Requires unsupported runtime module: ${moduleName}`),
    ...collectDynamicModuleBlockers(code),
  ];

  return {
    obsidianApis,
    moduleImports,
    nodeModules,
    supportedModules,
    unsupportedModules,
    platformRequirements,
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
  if (
    report.platformRequirements?.desktop === true
    || (report.supportedModules?.length ?? 0) > 0
    || report.partialApis.length > 0
    || report.unsupportedApis.length > 0
  ) {
    return 'partial';
  }
  return 'compatible';
}
