export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import {
  handleSettingsGet,
  handleSettingsPost,
  type MindosServerSettings,
  type MindosSettingsServices,
  type MindosWebSearchConfig,
} from '@geminilight/mindos/server';
import { readSettings, writeSettings, ServerSettings } from '@/lib/settings';
import { readWebSearchConfig, writeWebSearchConfig } from '@/lib/web-search-config';
import { invalidateCache } from '@/lib/fs';
import { ALL_PROVIDER_IDS, getApiKeyEnvVar, getApiKeyFromEnv } from '@/lib/agent/providers';
import { parseProviders } from '@/lib/custom-endpoints';
import { getEmbeddingStatus } from '@/lib/core/hybrid-search';
import { readMindosIgnoreFile, writeMindosIgnoreFile } from '@/lib/core/tree';
import { handleRouteErrorSimple } from '@/lib/errors';
import { toNextResponse } from '../_mindos-adapter';

function createSettingsServices(): MindosSettingsServices {
  return {
    env: process.env,
    readSettings: () => readSettings() as MindosServerSettings,
    writeSettings: (settings) => writeSettings(settings as ServerSettings),
    readWebSearchConfig: () => readWebSearchConfig() as MindosWebSearchConfig,
    writeWebSearchConfig: (config) => writeWebSearchConfig(config),
    parseProviders,
    getEmbeddingStatus,
    invalidateCache,
    readSearchIgnoreFile: (mindRoot) => mindRoot ? readMindosIgnoreFile(mindRoot) : [],
    writeSearchIgnoreFile: (mindRoot, ignoredPaths) => {
      writeMindosIgnoreFile(mindRoot, ignoredPaths);
    },
    providerEnv: {
      ids: [...ALL_PROVIDER_IDS],
      getApiKeyEnvVar,
      getApiKeyFromEnv,
    },
  };
}

export async function GET() {
  return toNextResponse(handleSettingsGet(createSettingsServices()));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ServerSettings>;
    return toNextResponse(handleSettingsPost(body, createSettingsServices()));
  } catch (error) {
    return handleRouteErrorSimple(error);
  }
}
