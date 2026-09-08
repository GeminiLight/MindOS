import {
  getDefaultMindRoot,
  listDirectoriesFromMindRoot,
  listMindSpacesFromMindRoot,
  readLinesFromMindRoot,
  readRuntimeSettings,
  readTextFileFromMindRoot,
  getSkillRootsFromRuntime,
  writeRuntimeSettings,
  type MindosRuntimeOptions,
  type MindosRuntimeSettings,
} from './runtime.js';
import { createMindRootTreeCache } from './tree-cache.js';
import { MindosSearchIndex } from './search/index.js';
import { createDefaultMcpAgents } from './mcp-agent-registry.js';
import { getMindosServerEventBus, type MindosServerEventBus } from './events/bus.js';
import type { CodexThreadManagerServices } from './handlers/agent-runtimes-codex.js';
import type { ChannelsVerifyServices } from './handlers/channels-verify.js';
import type { ExtractDocxServices } from './handlers/extract-docx.js';
import type { ExtractPdfServices } from './handlers/extract-pdf.js';
import type { ImConfigServices } from './handlers/im-config.js';
import type { ImStatusServices } from './handlers/im-status.js';
import type { ImTestServices } from './handlers/im-test.js';
import type { MindosMcpAgentDef } from './handlers/mcp-install.js';
import type { MindosMcpConfigFile, MindosMcpToolCacheEntry } from './handlers/mcp-tools.js';
import type { SearchRequestOptions } from './handlers/search.js';
import type { SearchPrewarmPayload } from './handlers/search-prewarm.js';
import type { MindosSkillRoot } from './handlers/skills.js';
import type { MindOSSSEvent } from '../agent/turn/index.js';

export type MindosChannelServices =
  ChannelsVerifyServices &
  ImConfigServices &
  ImStatusServices &
  ImTestServices;

/**
 * Host-provided capabilities the route table runs against. The standalone
 * Product Server builds them from the mind root (`createDefaultMindosHttpServices`);
 * the Next host wraps its own filesystem cache and search stack.
 */
export type MindosHttpServices = {
  mindRoot: string;
  homeDir?: string;
  runtimeRoot?: string;
  staticRoot?: string;
  agentSessionsStorePath?: string;
  updateStatusPath?: string;
  collectAllFiles(): string[];
  getRecentlyModified(limit: number): Array<{ path: string; mtime: number }>;
  getTreeVersion(): number;
  /** Per-file stats from the tree cache; lets the link index rescan only changed files. */
  collectFileStats?(): Array<{ path: string; mtime: number; size: number }>;
  /** Warms the runtime search index and reports whether it was already fresh. Hosts with a worker-built index may resolve asynchronously. */
  prewarmSearch?(): SearchPrewarmPayload | Promise<SearchPrewarmPayload>;
  readTextFile(path: string): string;
  readLines(path: string): string[];
  listSpaces(): string[];
  listDirectories(): string[];
  search(query: string, options: SearchRequestOptions): Promise<unknown[]>;
  readSettings(): MindosRuntimeSettings;
  writeSettings(settings: MindosRuntimeSettings): void;
  /** Marks any tree/link caches dirty after internal writes. Optional for custom services. */
  invalidateTreeCache?(): void;
  /** Releases watchers/timers owned by the services (called on server close for default services). */
  dispose?(): void;
  /**
   * Process event bus behind `GET /api/events`. Default services wire the tree
   * cache into it as a lazy source; custom services may omit it, in which case
   * the stream route answers 503 and clients fall back to polling.
   */
  events?: MindosServerEventBus;
  mcpAgents?: Record<string, MindosMcpAgentDef>;
  mcpTools?: {
    readMcpConfig(): MindosMcpConfigFile;
    readMcpToolCache(): Record<string, MindosMcpToolCacheEntry> | null;
    updateServerDirectTools(server: string, directTools: boolean | string[]): void;
  };
  listSkills(): { disabledSkills?: string[]; skillRoots: MindosSkillRoot[] };
  agentTurnStream(input: unknown): AsyncIterable<MindOSSSEvent>;
  createCodexClient?: CodexThreadManagerServices['createCodexClient'];
  documentExtraction?: ExtractPdfServices & ExtractDocxServices;
  channels?: MindosChannelServices;
  syncDaemon?: {
    start?(mindRoot: string): void;
    stop?(): void;
    reconfigure?(mindRoot: string): void;
    restart?(mindRoot: string): void;
  };
};

export type DefaultMindosHttpServicesOptions = MindosRuntimeOptions & {
  runtimeRoot?: string;
  staticRoot?: string;
  mcpAgents?: Record<string, MindosMcpAgentDef>;
  documentExtraction?: ExtractPdfServices & ExtractDocxServices;
  syncDaemon?: MindosHttpServices['syncDaemon'];
};

export function createDefaultMindosHttpServices(options: DefaultMindosHttpServicesOptions = {}): MindosHttpServices {
  const mindRoot = getDefaultMindRoot(options);
  // Watcher-driven cache: avoids walking the whole library on every poll of
  // /api/tree-version (~5s) and on every /api/files request.
  const treeCache = createMindRootTreeCache(mindRoot);
  // The search index takes its file stats from the tree cache, so a warm query
  // never walks the library: tree version unchanged → no stat walk at all.
  const searchIndex = new MindosSearchIndex(mindRoot, { listFiles: () => treeCache.collectFileStats() });
  // Push path: the tree cache only detects changes actively while the event
  // stream has subscribers (bus lazy source), so an idle server stays lazy.
  const events = getMindosServerEventBus();
  const removeTreeSource = events.addSource(() => treeCache.subscribe((version) => {
    events.emit({ type: 'tree.changed', version });
  }));
  const channels: MindosChannelServices = {};
  if (options.homeDir) {
    channels.configPath = `${options.homeDir}/.mindos/im.json`;
  }
  return {
    mindRoot,
    homeDir: options.homeDir,
    runtimeRoot: options.runtimeRoot,
    staticRoot: options.staticRoot,
    agentSessionsStorePath: options.homeDir ? `${options.homeDir}/.mindos/sessions.json` : undefined,
    updateStatusPath: options.homeDir ? `${options.homeDir}/.mindos/update-status.json` : undefined,
    collectAllFiles: () => treeCache.collectAllFiles(),
    collectFileStats: () => treeCache.collectFileStats(),
    getRecentlyModified: (limit) => treeCache.getRecentlyModified(limit),
    getTreeVersion: () => treeCache.getTreeVersion(),
    prewarmSearch: () => {
      const warmed = searchIndex.refresh({ treeVersion: treeCache.getTreeVersion() });
      const fileCount = treeCache.collectAllFiles().length;
      return {
        warmed: true as const,
        cacheState: warmed.cacheState,
        documentCount: fileCount,
        core: { cacheState: warmed.cacheState, fileCount, indexedDocuments: searchIndex.getFileCount() },
      };
    },
    invalidateTreeCache: () => treeCache.invalidate(),
    dispose: () => {
      removeTreeSource();
      treeCache.dispose();
    },
    events,
    readTextFile: (filePath) => readTextFileFromMindRoot(mindRoot, filePath),
    readLines: (filePath) => readLinesFromMindRoot(mindRoot, filePath),
    listSpaces: () => listMindSpacesFromMindRoot(mindRoot),
    listDirectories: () => listDirectoriesFromMindRoot(mindRoot),
    search: async (query, searchOptions) => searchIndex.search(query, searchOptions, { treeVersion: treeCache.getTreeVersion() }),
    readSettings: () => readRuntimeSettings(options),
    writeSettings: (settings) => writeRuntimeSettings(settings, options),
    mcpAgents: options.mcpAgents ?? createDefaultMcpAgents(),
    documentExtraction: options.documentExtraction,
    channels,
    syncDaemon: options.syncDaemon,
    mcpTools: {
      readMcpConfig: () => ({ mcpServers: {} }),
      readMcpToolCache: () => null,
      updateServerDirectTools: () => {},
    },
    listSkills: () => ({
      disabledSkills: readRuntimeSettings(options).disabledSkills,
      skillRoots: getSkillRootsFromRuntime({
        mindRoot,
        runtimeRoot: options.runtimeRoot,
        homeDir: options.homeDir,
        settings: readRuntimeSettings(options),
      }),
    }),
    agentTurnStream: async function* () {
      yield {
        type: 'error',
        message: 'Product agent turn runtime is not configured. Start the Next adapter or inject an agentTurnStream service.',
      };
    },
  };
}
