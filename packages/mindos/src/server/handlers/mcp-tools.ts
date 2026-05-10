import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type MindosMcpToolCacheEntry = {
  tools?: Array<{ name: string; description?: string }>;
  cachedAt?: number;
};

export type MindosMcpServerEntry = {
  lifecycle?: 'keep-alive' | 'lazy' | 'eager';
  directTools?: boolean | string[];
  [key: string]: unknown;
};

export type MindosMcpConfigFile = {
  mcpServers: Record<string, MindosMcpServerEntry>;
  settings?: Record<string, unknown>;
  imports?: string[];
};

export type MindosMcpToolsServices = {
  readMcpConfig(): MindosMcpConfigFile;
  readMcpToolCache(): Record<string, MindosMcpToolCacheEntry> | null;
};

export type MindosMcpDirectToolsServices = {
  updateServerDirectTools(server: string, directTools: boolean | string[]): void;
};

export type MindosMcpDirectToolsRequest = {
  server?: string;
  directTools?: boolean | string[];
};

export function handleMcpToolsGet(
  services: MindosMcpToolsServices,
): MindosServerResponse<{
  servers: Array<{
    name: string;
    toolCount: number;
    tools: Array<{ name: string; description: string }>;
    directTools: boolean | string[];
    lifecycle: 'keep-alive' | 'lazy' | 'eager';
    cached: boolean;
  }>;
} | { error: string }> {
  let config: MindosMcpConfigFile;
  let cache: Record<string, MindosMcpToolCacheEntry> | null;
  try {
    config = normalizeMcpConfig(services.readMcpConfig());
    cache = services.readMcpToolCache();
  } catch (error) {
    return errorResponse(error);
  }

  const servers = Object.entries(config.mcpServers).map(([name, entry]) => {
    const serverCache = cache?.[name];
    const tools = (serverCache?.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
    }));

    return {
      name,
      toolCount: tools.length,
      tools,
      directTools: entry.directTools ?? false,
      lifecycle: entry.lifecycle ?? 'lazy',
      cached: !!serverCache,
    };
  });

  return json({ servers });
}

export function handleMcpDirectToolsPost(
  body: unknown,
  services: MindosMcpDirectToolsServices,
): MindosServerResponse<{ ok: true; server: string; directTools: boolean | string[] } | { error: string }> {
  const payload = normalizeDirectToolsRequest(body);

  if (!payload.server || typeof payload.server !== 'string') {
    return json({ error: 'Missing or invalid "server" field' }, { status: 400 });
  }
  const server = payload.server.trim();
  if (!server || isUnsafeObjectKey(server)) {
    return json({ error: 'Invalid server name' }, { status: 400 });
  }

  const directTools = payload.directTools;
  if (directTools !== true && directTools !== false && !Array.isArray(directTools)) {
    return json({ error: '"directTools" must be true, false, or string[]' }, { status: 400 });
  }

  if (Array.isArray(directTools) && !directTools.every((item) => typeof item === 'string')) {
    return json({ error: '"directTools" array must contain only strings' }, { status: 400 });
  }

  try {
    services.updateServerDirectTools(server, directTools);
  } catch (error) {
    return errorResponse(error);
  }

  return json({ ok: true, server, directTools });
}

function normalizeMcpConfig(config: MindosMcpConfigFile | undefined | null): MindosMcpConfigFile {
  if (!config || typeof config !== 'object' || !config.mcpServers || typeof config.mcpServers !== 'object') {
    return { mcpServers: {} };
  }
  return config;
}

function normalizeDirectToolsRequest(body: unknown): MindosMcpDirectToolsRequest {
  return body && typeof body === 'object' ? body as MindosMcpDirectToolsRequest : {};
}

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}
