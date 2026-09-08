import type { MindosHttpServices } from '@geminilight/mindos/server';
import * as fsLib from '@/lib/fs';
import { hybridSearch } from '@/lib/core/hybrid-search';
import { prewarmCoreSearchIndex } from '@/lib/core/search';
import { getProjectRoot } from '@/lib/project-root';
import { readRuntimeAuthConfig } from '@/lib/runtime-auth-config';
import { effectiveSopRoot } from '@/lib/settings';
import { telemetry } from '@/lib/telemetry';

function notDelegated(capability: string): never {
  throw new Error(`MindOS Web host: "${capability}" is served by a dedicated Next route, not through the shared MindOS app.`);
}

/**
 * `MindosHttpServices` backed by the Web host's own filesystem cache, hybrid
 * search and runtime auth config. Only the capabilities the delegated routes
 * use are wired; everything else throws so a route cannot silently run against
 * a half-configured host. `mindRoot` / `runtimeRoot` are lazy getters because
 * the Web mind root can be switched at runtime (and per test).
 */
export function createWebMindosServices(overrides: Partial<MindosHttpServices> = {}): MindosHttpServices {
  const services: MindosHttpServices = {
    mindRoot: '',
    collectAllFiles: () => fsLib.collectAllFiles(),
    getRecentlyModified: (limit) => fsLib.getRecentlyModified(limit),
    getTreeVersion: () => fsLib.getTreeVersion(),
    readTextFile: (path) => fsLib.getFileContent(path),
    readLines: (path) => fsLib.readLines(path),
    listSpaces: () => notDelegated('listSpaces'),
    listDirectories: () => notDelegated('listDirectories'),
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
    readSettings: () => {
      const auth = readRuntimeAuthConfig();
      return { mindRoot: fsLib.getMindRoot(), authToken: auth.authToken, webPassword: auth.webPassword };
    },
    writeSettings: () => notDelegated('writeSettings'),
    listSkills: () => notDelegated('listSkills'),
    agentTurnStream: async function* () {
      yield { type: 'error', message: 'Agent turns are served by the Next host route, not through the shared MindOS app.' };
    },
    ...overrides,
  };

  if (!('mindRoot' in overrides)) {
    Object.defineProperty(services, 'mindRoot', { enumerable: true, get: () => fsLib.getMindRoot() });
  }
  if (!('runtimeRoot' in overrides)) {
    Object.defineProperty(services, 'runtimeRoot', { enumerable: true, get: () => getProjectRoot() });
  }
  return services;
}
