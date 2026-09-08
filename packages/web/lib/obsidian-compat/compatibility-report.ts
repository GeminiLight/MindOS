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
  runtimeTier?: PluginRuntimeTierRequirement;
}

/**
 * MindOS runs Obsidian plugins in one of three tiers:
 * - `server`: the snapshot runtime (fake DOM, safe hosts, MCP/headless).
 * - `browser`: an isolated realm with real DOM and the shared CodeMirror 6 instance.
 * - `native`: the Desktop broker that exposes Node / Electron capabilities per plugin.
 */
export type ObsidianRuntimeTier = 'server' | 'browser' | 'native';
export type ObsidianRuntimeModuleTier = 'supported' | 'browser' | 'native' | 'unknown';

export interface PluginRuntimeTierRequirement {
  /** Lowest tier in which every detected feature can run end-to-end. */
  required: ObsidianRuntimeTier;
  /** True when no blocker prevents loading in the server tier (features may still be catalog-only there). */
  loadsInServerTier: boolean;
  browserModules: string[];
  nativeModules: string[];
  unknownModules: string[];
  browserApis: string[];
  reasons: string[];
}

const BROWSER_TIER_MODULE_PREFIXES = ['@codemirror/', '@lezer/', 'prosemirror-'];
const BROWSER_TIER_MODULES = new Set(['codemirror', 'codemirror5']);
const NATIVE_TIER_EXTRA_MODULES = new Set(['@electron/remote', 'electron/main', 'electron/renderer']);
/** Node builtins outside the supported set that the static scanner does not list in NODE_RUNTIME_MODULES. */
const NATIVE_TIER_BUILTIN_MODULES = new Set([
  'async_hooks', 'child_process', 'cluster', 'constants', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'fs', 'http2',
  'inspector', 'module', 'perf_hooks', 'process', 'punycode', 'readline', 'repl', 'sys', 'tty', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);
const NATIVE_TIER_MODULE_PREFIXES = ['fs/', 'dns/', 'readline/', 'stream/', 'util/', 'path/'];

function isRelativeModule(moduleName: string): boolean {
  return moduleName.startsWith('.') || moduleName.startsWith('/');
}

/** Obsidian APIs whose full behaviour needs a real DOM or the live editor, even though the server tier catalogs them. */
const BROWSER_TIER_APIS = new Set([
  'registerEditorExtension',
  'registerEditorSuggest',
  'registerMarkdownPostProcessor',
  'registerMarkdownCodeBlockProcessor',
  'registerView',
  'MarkdownRenderer',
  'CodeMirror',
  'CodeMirrorAdapter.commands',
  'Workspace.iterateCodeMirrors',
  'Workspace.getLeaf',
  'Workspace.splitActiveLeaf',
  'Workspace.getLeftLeaf',
  'Workspace.getRightLeaf',
  'Workspace.revealLeaf',
]);

export function classifyRuntimeModuleTier(moduleName: string): ObsidianRuntimeModuleTier {
  if (SUPPORTED_RUNTIME_MODULES.has(moduleName)) return 'supported';
  const normalized = moduleName.replace(/^node:/, '');
  if (SUPPORTED_RUNTIME_MODULES.has(normalized)) return 'supported';
  if (
    NODE_RUNTIME_MODULES.has(moduleName)
    || NODE_RUNTIME_MODULES.has(normalized)
    || NATIVE_TIER_EXTRA_MODULES.has(moduleName)
    || NATIVE_TIER_BUILTIN_MODULES.has(normalized)
    || NATIVE_TIER_MODULE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || moduleName.startsWith('node:')
  ) {
    return 'native';
  }
  if (BROWSER_TIER_MODULES.has(moduleName) || BROWSER_TIER_MODULE_PREFIXES.some((prefix) => moduleName.startsWith(prefix))) {
    return 'browser';
  }
  return 'unknown';
}

export function classifyPluginRuntimeTier(
  report: Pick<PluginCompatibilityReport, 'obsidianApis' | 'unsupportedModules' | 'blockers'>,
): PluginRuntimeTierRequirement {
  const browserModules: string[] = [];
  const nativeModules: string[] = [];
  const unknownModules: string[] = [];
  for (const moduleName of report.unsupportedModules) {
    // Relative specifiers are bundler leftovers, not a runtime capability; they stay in blockers only.
    if (isRelativeModule(moduleName)) continue;
    const tier = classifyRuntimeModuleTier(moduleName);
    if (tier === 'native') nativeModules.push(moduleName);
    else if (tier === 'browser') browserModules.push(moduleName);
    else if (tier === 'unknown') unknownModules.push(moduleName);
  }
  const browserApis = report.obsidianApis.filter((api) => BROWSER_TIER_APIS.has(api));

  const reasons: string[] = [];
  if (nativeModules.length > 0) reasons.push(`Native modules need the Desktop broker tier: ${unique(nativeModules).join(', ')}.`);
  if (browserModules.length > 0) reasons.push(`Editor modules need the browser tier with shared CodeMirror 6: ${unique(browserModules).join(', ')}.`);
  if (browserApis.length > 0) reasons.push(`DOM / editor APIs are catalog-only in the server tier: ${unique(browserApis).join(', ')}.`);
  if (unknownModules.length > 0) reasons.push(`Unrecognized modules block every tier until classified: ${unique(unknownModules).join(', ')}.`);

  const required: ObsidianRuntimeTier = nativeModules.length > 0
    ? 'native'
    : browserModules.length > 0 || browserApis.length > 0
      ? 'browser'
      : 'server';

  return {
    required,
    loadsInServerTier: report.blockers.length === 0,
    browserModules: unique(browserModules),
    nativeModules: unique(nativeModules),
    unknownModules: unique(unknownModules),
    browserApis: unique(browserApis),
    reasons,
  };
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
    [/workspace\.setActiveLeaf\s*\(/, 'Workspace.setActiveLeaf'],
    [/workspace\.getUnpinnedLeaf\s*\(/, 'Workspace.getUnpinnedLeaf'],
    [/workspace\.splitActiveLeaf\s*\(/, 'Workspace.splitActiveLeaf'],
    [/workspace\.getLeavesOfType\s*\(/, 'Workspace.getLeavesOfType'],
    [/workspace\.revealLeaf\s*\(/, 'Workspace.revealLeaf'],
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

  const blockers = unique([
    ...unsupportedModules.map((moduleName) => `Requires unsupported runtime module: ${moduleName}`),
    ...collectDynamicModuleBlockers(code),
  ]);

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
    blockers,
    runtimeTier: classifyPluginRuntimeTier({ obsidianApis, unsupportedModules, blockers }),
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
