import os from 'os';
import {
  listDirectoriesFromMindRoot,
  listMindSpacesFromMindRoot,
  type MindosHttpServices,
  type MindosRuntimeSettings,
} from '@geminilight/mindos/server';
import * as fsLib from '@/lib/fs';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { prewarmCoreSearchIndex } from '@/lib/core/search';
import { getProjectRoot } from '@/lib/project-root';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { effectiveSopRoot, readSettings, writeSettings, type ServerSettings } from '@/lib/settings';
import { telemetry } from '@/lib/telemetry';
import { createWebAgentServices, listWebMcpAgents } from './_mindos-services/agents';
import { createWebChannelServices } from './_mindos-services/channels';
import { createWebKnowledgeServices } from './_mindos-services/knowledge';
import { createWebSettingsServices } from './_mindos-services/settings';

/**
 * `MindosHttpServices` backed by the Web host: its filesystem cache, hybrid
 * search, settings store and the in-process state the Next app owns (A2A
 * registry, ACP session overrides, IM clients, runtime descriptor cache).
 * Everything the shared route table needs is injected here so the Web routes
 * stay one-line delegations. `mindRoot` / `runtimeRoot` / `homeDir` /
 * `mcpAgents` are lazy getters because the Web mind root can be switched at
 * runtime (and per test) and the agent registry includes user-defined agents.
 */
export function createWebMindosServices(overrides: Partial<MindosHttpServices> = {}): MindosHttpServices {
  const services: MindosHttpServices = {
    mindRoot: '',
    collectAllFiles: () => fsLib.collectAllFiles(),
    getRecentlyModified: (limit) => fsLib.getRecentlyModified(limit),
    getTreeVersion: () => fsLib.getTreeVersion(),
    readTextFile: (path) => fsLib.getFileContent(path),
    readLines: (path) => fsLib.readLines(path),
    listSpaces: () => listMindSpacesFromMindRoot(fsLib.getMindRoot()),
    listDirectories: () => listDirectoriesFromMindRoot(fsLib.getMindRoot()),
    search: async (query, options) => {
      const stop = telemetry.startTimer('search.api.request', { queryLen: query.length });
      try {
        const results = await hybridSearch(effectiveSopRoot(), query, options);
        stop({ resultCount: results.length, success: true });
        return results;
      } catch (error) {
        telemetry.track('search.api.error', {
          queryLen: query.length,
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        stop({ success: false });
        throw error;
      }
    },
    prewarmSearch: async () => {
      const stop = telemetry.startTimer('search.prewarm.request');
      try {
        const uiResult = fsLib.prewarmSearchIndex();
        let coreResult: { cacheState: string; fileCount: number } | undefined;
        try {
          coreResult = await prewarmCoreSearchIndex(fsLib.getMindRoot());
        } catch {
          // Core prewarm failure is non-critical; UI search still works.
        }
        stop({
          uiCacheState: uiResult.cacheState,
          uiDocumentCount: uiResult.documentCount,
          coreCacheState: coreResult?.cacheState ?? 'skipped',
          coreFileCount: coreResult?.fileCount ?? 0,
          success: true,
        });
        return {
          warmed: true,
          cacheState: uiResult.cacheState,
          documentCount: uiResult.documentCount,
          core: coreResult
            ? { cacheState: coreResult.cacheState, fileCount: coreResult.fileCount }
            : { cacheState: 'skipped', fileCount: 0 },
        };
      } catch (error) {
        telemetry.track('search.prewarm.error', {
          errorType: error instanceof Error ? error.name : 'unknown',
        });
        stop({ success: false });
        throw error;
      }
    },
    // The Web settings store is the source for API routes (as before the
    // delegation); the proxy's runtime auth config (persisted config + env) fills
    // in auth fields the store does not carry so `/api/health` still reports
    // what the proxy enforces.
    readSettings: () => {
      const settings = readSettings() as unknown as MindosRuntimeSettings;
      const auth = readRuntimeAuthConfig();
      return {
        ...settings,
        mindRoot: fsLib.getMindRoot(),
        authToken: settings.authToken || auth.authToken,
        webPassword: settings.webPassword || auth.webPassword,
      };
    },
    writeSettings: (settings) => writeSettings(settings as unknown as ServerSettings),
    agentTurnStream: async function* () {
      yield { type: 'error', message: 'Agent turns are served by the Next host route, not through the shared MindOS app.' };
    },
    ...createWebKnowledgeServices(),
    ...createWebAgentServices(),
    ...createWebSettingsServices(),
    channels: createWebChannelServices(),
    ...overrides,
  };

  const lazy = <K extends keyof MindosHttpServices>(key: K, get: () => MindosHttpServices[K]) => {
    if (key in overrides) return;
    Object.defineProperty(services, key, { enumerable: true, get });
  };
  lazy('mindRoot', () => fsLib.getMindRoot());
  lazy('runtimeRoot', () => getProjectRoot());
  lazy('homeDir', () => os.homedir());
  lazy('mcpAgents', () => listWebMcpAgents());
  return services;
}
