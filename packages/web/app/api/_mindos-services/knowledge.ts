import os from 'os';
import { revalidatePath } from 'next/cache';
import {
  getSkillRootsFromRuntime,
  type InboxSaveInput,
  type MindosHttpServices,
  type MindosKnowledgeWriteChange,
  type MindosRuntimeSettings,
} from '@geminilight/mindos/server';
import * as fsLib from '@/lib/fs';
import * as embeddingProvider from '@/lib/core/embedding-provider';
import { getEmbeddingStatus } from '@/lib/core/hybrid-search';
import { expandInboxDocumentCaptures } from '@/lib/core/inbox-document-capture';
import { metrics } from '@/lib/metrics';
import { ensureDefaultMindSystemUpgrade } from '@/lib/mind-system-upgrade';
import * as mcpConfig from '@/lib/pi-integration/mcp-config';
import { getProjectRoot, resolveMindosCliLibPath } from '@/lib/project-root';
import { readSettings } from '@/lib/settings';
import { SYSTEM_FILES } from '@/lib/types';

type WebKnowledgeServices = Pick<
  MindosHttpServices,
  'listSkills' | 'knowledgeWrites' | 'syncDaemon' | 'monitoring' | 'embedding' | 'ensureMindSystemDefaults' | 'mcpTools'
>;

/**
 * Knowledge-root, skill, sync, monitoring and embedding capabilities owned by
 * the Web host. Every `@/lib` export is reached inside a function or getter so
 * a route only touches the modules its handler actually needs (tests mock
 * `@/lib/*` partially per route).
 */
export function createWebKnowledgeServices(): WebKnowledgeServices {
  return {
    listSkills: () => {
      const settings = readSettings();
      return {
        disabledSkills: settings.disabledSkills,
        skillRoots: getSkillRootsFromRuntime({
          // The configured root wins (the settings store may point at a library the resolver has not switched to yet).
          mindRoot: settings.mindRoot || fsLib.getMindRoot(),
          runtimeRoot: getProjectRoot(),
          homeDir: os.homedir(),
          settings: settings as unknown as MindosRuntimeSettings,
        }),
      };
    },
    knowledgeWrites: {
      get protectedRootFiles() {
        return SYSTEM_FILES;
      },
      expandInboxFiles: async (files) => {
        const expanded = await expandInboxDocumentCaptures(files);
        return expanded.files as InboxSaveInput[];
      },
      onChanged: refreshKnowledgeCaches,
    },
    syncDaemon: createLazySyncDaemon(),
    monitoring: {
      metricsSnapshot: () => metrics.getSnapshot(),
      // Tree-version key lets the handler reuse its knowledge-base stats walk
      // until the library actually changes.
      getTreeVersion: () => fsLib.peekTreeVersion(),
    },
    embedding: {
      isLocalModelDownloaded: (model) => embeddingProvider.isLocalModelDownloaded(model),
      downloadLocalModel: (model) => embeddingProvider.downloadLocalModel(model),
      get defaultLocalModel() {
        return embeddingProvider.DEFAULT_LOCAL_MODEL;
      },
      get localModelOptions() {
        return embeddingProvider.LOCAL_MODEL_OPTIONS;
      },
      getEmbeddingStatus: () => getEmbeddingStatus(),
    },
    ensureMindSystemDefaults: (mindRoot) => {
      ensureDefaultMindSystemUpgrade(mindRoot);
    },
    mcpTools: {
      readMcpConfig: () => mcpConfig.readMcpConfig(),
      readMcpToolCache: () => mcpConfig.readMcpToolCache(),
      updateServerDirectTools: (server, directTools) => mcpConfig.updateServerDirectTools(server, directTools),
    },
  };
}

/**
 * The product handler writes straight to disk, bypassing the lib/fs in-memory
 * caches (file tree, known-file set, search and link indexes). Tree-shape
 * operations drop everything (and revalidate the Next router cache); content
 * edits take the same incremental path the watcher uses, which keeps the
 * search index warm instead of forcing a full rebuild on every save.
 */
function refreshKnowledgeCaches({ treeChanged, paths }: MindosKnowledgeWriteChange): void {
  if (treeChanged) {
    fsLib.invalidateCache();
    try {
      revalidatePath('/', 'layout');
    } catch {
      // Next cache revalidation is unavailable in some test runtimes.
    }
    return;
  }
  if (paths.length === 0) return;
  for (const path of paths) fsLib.handleWatcherEvent(path);
  fsLib.flushWatcherChanges();
}

type SyncDaemonModule = {
  startSyncDaemon(mindRoot: string): Promise<unknown>;
  stopSyncDaemon(): void;
};

/**
 * The sync daemon lives in the CLI (`bin/lib/sync.js`), outside the Next
 * bundle; it is required on first use through an indirect `require` so webpack
 * neither bundles nor stubs it. Any failure leaves sync commands as no-ops,
 * matching the previous route behaviour.
 */
function createLazySyncDaemon(): NonNullable<MindosHttpServices['syncDaemon']> {
  let module: SyncDaemonModule | null | undefined;
  const load = (): SyncDaemonModule | null => {
    if (module !== undefined) return module;
    if (process.env.NEXT_RUNTIME === 'edge') return (module = null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const dynamicRequire = new Function('id', 'return require(id)') as (id: string) => SyncDaemonModule;
      module = dynamicRequire(resolveMindosCliLibPath('sync.js'));
    } catch {
      module = null;
    }
    return module;
  };
  const start = (mindRoot: string) => {
    const daemon = load();
    if (daemon) void daemon.startSyncDaemon(mindRoot).catch(() => {});
  };
  const stop = () => {
    try {
      load()?.stopSyncDaemon();
    } catch {
      // Stopping an already-stopped daemon is not an error for the caller.
    }
  };
  return {
    start,
    stop,
    reconfigure: start,
    restart: (mindRoot) => {
      stop();
      start(mindRoot);
    },
  };
}
