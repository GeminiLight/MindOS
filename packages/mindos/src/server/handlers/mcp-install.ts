import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { errorResponse, json, type MindosServerResponse } from '../response.js';

export type MindosMcpAgentDef = {
  name: string;
  project: string | null;
  global: string;
  projectReadAlso?: string[];
  globalReadAlso?: string[];
  key: string;
  preferredTransport: 'stdio' | 'http';
  format?: 'json' | 'toml' | 'yaml';
  globalNestedKey?: string;
  entryStyle?: 'standard' | 'kilo';
};

export type MindosSkillAgentRegistration = {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
};

export type MindosSkillWorkspaceProfile = {
  mode: 'universal' | 'additional' | 'unsupported';
  skillAgentName?: string;
  workspacePath: string;
};

export type MindosMcpInstallItem = {
  key: string;
  scope: 'project' | 'global';
  transport?: 'stdio' | 'http' | 'auto';
};

export type MindosMcpInstallRequest = {
  agents?: MindosMcpInstallItem[];
  transport?: 'stdio' | 'http' | 'auto';
  url?: string;
  token?: string;
};

export type MindosMcpUninstallRequest = {
  agents?: Array<{
    key: string;
    scope: 'project' | 'global';
  }>;
};

export type MindosMcpInstallResult = {
  agent: string;
  status: string;
  path?: string;
  message?: string;
  transport?: string;
  verified?: boolean;
  verifyError?: string;
};

export type MindosMcpInstallServices = {
  agents: Record<string, MindosMcpAgentDef>;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  requireAgentPresence?: boolean;
  detectAgentPresence?: (agent: string) => boolean;
  readSettings?: () => { mcpPort?: number; disabledSkills?: string[] };
  fetcher?: typeof fetch;
};

export type MindosMcpUninstallServices = {
  agents: Record<string, MindosMcpAgentDef>;
  homeDir?: string;
};

function parseJsonc(text: string): Record<string, unknown> {
  let stripped = text.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*$)/gm, (match, comment) => comment ? '' : match);
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!stripped.trim()) return {};
  return JSON.parse(stripped) as Record<string, unknown>;
}

function expandHome(input: string, homeDir = homedir()): string {
  return input.startsWith('~/') || input.startsWith('~\\') ? resolve(homeDir, input.slice(2)) : input;
}

function configPathCandidates(agent: MindosMcpAgentDef, scope: 'global' | 'project'): string[] {
  const primary = scope === 'global' ? agent.global : agent.project;
  const readAlso = scope === 'global' ? agent.globalReadAlso : agent.projectReadAlso;
  return [primary, ...(readAlso ?? [])].filter((entry): entry is string => !!entry);
}

function isUnsafeObjectKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function assertSafeObjectKeyPath(dotPath: string, label: string): string[] {
  const parts = dotPath.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(isUnsafeObjectKey)) {
    throw new Error(`Invalid ${label}`);
  }
  return parts;
}

function assertSafeObjectKey(key: string, label: string): void {
  if (!key || isUnsafeObjectKey(key)) throw new Error(`Invalid ${label}`);
}

function readOwnRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const value = obj[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function ensureNestedPath(obj: Record<string, unknown>, dotPath: string): Record<string, unknown> {
  const parts = assertSafeObjectKeyPath(dotPath, 'nested config path');
  let current = obj;
  for (const part of parts) {
    const existing = readOwnRecord(current, part);
    if (!existing) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  return current;
}

function getNestedPath(obj: Record<string, unknown>, dotPath: string): Record<string, unknown> | null {
  const parts = assertSafeObjectKeyPath(dotPath, 'nested config path');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current && typeof current === 'object' ? current as Record<string, unknown> : null;
}

function quotedConfigString(value: unknown): string {
  return JSON.stringify(String(value));
}

function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : quotedConfigString(key);
}

function tomlTablePath(sectionKey: string, serverName: string, ...suffixes: string[]): string {
  return [
    ...sectionKey.split('.').filter(Boolean).map(tomlKey),
    tomlKey(serverName),
    ...suffixes.map(tomlKey),
  ].join('.');
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : quotedConfigString(key);
}

function isYamlMappingLine(trimmed: string, key: string): boolean {
  return trimmed === `${key}:` || trimmed === `${yamlKey(key)}:`;
}

function buildTomlEntry(sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [`[${tomlTablePath(sectionKey, serverName)}]`];
  if (entry.type) lines.push(`type = ${quotedConfigString(entry.type)}`);
  if (entry.command) lines.push(`command = ${quotedConfigString(entry.command)}`);
  if (entry.url) lines.push(`url = ${quotedConfigString(entry.url)}`);
  if (Array.isArray(entry.args)) lines.push(`args = [${entry.args.map(quotedConfigString).join(', ')}]`);
  if (entry.env && typeof entry.env === 'object') {
    lines.push('', `[${tomlTablePath(sectionKey, serverName, 'env')}]`);
    for (const [key, value] of Object.entries(entry.env)) lines.push(`${tomlKey(key)} = ${quotedConfigString(value)}`);
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('', `[${tomlTablePath(sectionKey, serverName, 'headers')}]`);
    for (const [key, value] of Object.entries(entry.headers)) lines.push(`${tomlKey(key)} = ${quotedConfigString(value)}`);
  }
  return lines.join('\n');
}

function mergeTomlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const sectionHeader = `[${tomlTablePath(sectionKey, serverName)}]`;
  const envHeader = `[${tomlTablePath(sectionKey, serverName, 'env')}]`;
  const headersHeader = `[${tomlTablePath(sectionKey, serverName, 'headers')}]`;
  const legacyHeaders = new Set([
    `[${sectionKey}.${serverName}]`,
    `[${sectionKey}.${serverName}.env]`,
    `[${sectionKey}.${serverName}.headers]`,
  ]);
  const result: string[] = [];
  let skipping = false;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader || trimmed === envHeader || trimmed === headersHeader || legacyHeaders.has(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[')) skipping = false;
    if (!skipping) result.push(line);
  }

  while (result.length > 0 && result[result.length - 1]?.trim() === '') result.pop();
  result.push('', buildTomlEntry(sectionKey, serverName, entry), '');
  return result.join('\n');
}

function removeTomlEntry(existing: string, sectionKey: string, serverName: string): string {
  const sectionHeader = `[${tomlTablePath(sectionKey, serverName)}]`;
  const envHeader = `[${tomlTablePath(sectionKey, serverName, 'env')}]`;
  const headersHeader = `[${tomlTablePath(sectionKey, serverName, 'headers')}]`;
  const legacyHeaders = new Set([
    `[${sectionKey}.${serverName}]`,
    `[${sectionKey}.${serverName}.env]`,
    `[${sectionKey}.${serverName}.headers]`,
  ]);
  const result: string[] = [];
  let skipping = false;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader || trimmed === envHeader || trimmed === headersHeader || legacyHeaders.has(trimmed)) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith('[')) skipping = false;
    if (!skipping) result.push(line);
  }

  const cleaned: string[] = [];
  for (const line of result) {
    if (line.trim() === '' && cleaned.length > 0 && cleaned[cleaned.length - 1]?.trim() === '') continue;
    cleaned.push(line);
  }
  return cleaned.join('\n');
}

function buildYamlEntry(serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [`  ${yamlKey(serverName)}:`];
  if (entry.type) lines.push(`    type: ${quotedConfigString(entry.type)}`);
  if (entry.command) lines.push(`    command: ${quotedConfigString(entry.command)}`);
  if (entry.url) lines.push(`    url: ${quotedConfigString(entry.url)}`);
  if (Array.isArray(entry.args)) lines.push(`    args: [${entry.args.map(quotedConfigString).join(', ')}]`);
  if (entry.env && typeof entry.env === 'object') {
    lines.push('    env:');
    for (const [key, value] of Object.entries(entry.env)) lines.push(`      ${yamlKey(key)}: ${quotedConfigString(value)}`);
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('    headers:');
    for (const [key, value] of Object.entries(entry.headers)) lines.push(`      ${yamlKey(key)}: ${quotedConfigString(value)}`);
  }
  return lines.join('\n');
}

function mergeYamlEntry(existing: string, sectionKey: string, serverName: string, entry: Record<string, unknown>): string {
  const newBlock = buildYamlEntry(serverName, entry);
  if (!existing.trim()) return `${sectionKey}:\n${newBlock}\n`;

  const result: string[] = [];
  let inSection = false;
  let sectionFound = false;
  let baseIndent = -1;
  let skipping = false;
  let serverIndent = -1;

  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;

    if (indent === 0 && trimmed === `${sectionKey}:`) {
      inSection = true;
      sectionFound = true;
      baseIndent = -1;
      result.push(line);
      continue;
    }
    if (indent === 0 && trimmed && !trimmed.startsWith('#') && inSection) {
      while (result.length > 0 && result[result.length - 1]?.trim() === '') result.pop();
      result.push(newBlock, '', line);
      inSection = false;
      skipping = false;
      continue;
    }
    if (!inSection) {
      result.push(line);
      continue;
    }
    if (!trimmed || trimmed.startsWith('#')) {
      if (!skipping) result.push(line);
      continue;
    }
    if (baseIndent < 0) baseIndent = indent;
    if (indent === baseIndent) {
      if (isYamlMappingLine(trimmed, serverName)) {
        skipping = true;
        serverIndent = indent;
        continue;
      }
      skipping = false;
    }
    if (skipping) {
      if (indent > serverIndent) continue;
      skipping = false;
    }
    result.push(line);
  }

  if (inSection) {
    while (result.length > 0 && result[result.length - 1]?.trim() === '') result.pop();
    result.push(newBlock);
  }
  if (!sectionFound) {
    while (result.length > 0 && result[result.length - 1]?.trim() === '') result.pop();
    result.push('', `${sectionKey}:`, newBlock);
  }

  let output = result.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  return output;
}

function buildEntry(
  transport: 'stdio' | 'http',
  agent: MindosMcpAgentDef,
  services: MindosMcpInstallServices,
  url?: string,
  token?: string,
): Record<string, unknown> {
  if (agent.entryStyle === 'kilo') {
    if (transport === 'stdio') {
      return {
        type: 'local',
        command: ['mindos', 'mcp'],
        environment: { MCP_TRANSPORT: 'stdio' },
        enabled: true,
      };
    }
    const fallbackPort = Number(services.env?.MINDOS_MCP_PORT) || services.readSettings?.().mcpPort || 8781;
    const entry: Record<string, unknown> = {
      type: 'remote',
      // 127.0.0.1 (not localhost): the MCP server binds an IPv4 socket and some
      // Windows HTTP stacks resolve localhost to ::1 first without fallback
      url: url || `http://127.0.0.1:${fallbackPort}/mcp`,
      enabled: true,
    };
    if (token) entry.headers = { Authorization: `Bearer ${token}` };
    return entry;
  }

  if (transport === 'stdio') {
    return { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
  }
  const fallbackPort = Number(services.env?.MINDOS_MCP_PORT) || services.readSettings?.().mcpPort || 8781;
  // 127.0.0.1 (not localhost) — see remote-entry comment above
  const entry: Record<string, unknown> = { url: url || `http://127.0.0.1:${fallbackPort}/mcp` };
  if (token) entry.headers = { Authorization: `Bearer ${token}` };
  return entry;
}

async function verifyHttpConnection(
  mcpUrl: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ verified: boolean; verifyError?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetcher(mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: controller.signal,
      });
      if (res.ok) return { verified: true };
      return { verified: false, verifyError: `HTTP ${res.status}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { verified: false, verifyError: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleMcpInstallPost(
  body: MindosMcpInstallRequest,
  services: MindosMcpInstallServices,
): Promise<MindosServerResponse<{ results: MindosMcpInstallResult[] } | { error: string }>> {
  try {
    const results: MindosMcpInstallResult[] = [];
    const globalTransport = body.transport ?? 'auto';

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const agent = services.agents[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const effectiveTransport = item.transport && item.transport !== 'auto'
        ? item.transport
        : globalTransport !== 'auto'
          ? globalTransport
          : agent.preferredTransport;
      const configPath = scope === 'global' ? agent.global : agent.project;
      if (!configPath) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      if (services.requireAgentPresence && !services.detectAgentPresence?.(key)) {
        results.push({
          agent: key,
          status: 'error',
          message: `${agent.name} was not detected on this machine. Install the agent first, then refresh.`,
        });
        continue;
      }

      const absPath = expandHome(configPath, services.homeDir);
      const entry = buildEntry(effectiveTransport, agent, services, body.url, body.token);

      try {
        mkdirSync(dirname(absPath), { recursive: true });
        if (agent.format === 'toml') {
          const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
          writeFileSync(absPath, mergeTomlEntry(existing, agent.key, 'mindos', entry), 'utf-8');
        } else if (agent.format === 'yaml') {
          const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
          writeFileSync(absPath, mergeYamlEntry(existing, agent.key, 'mindos', entry), 'utf-8');
        } else {
          const config = existsSync(absPath) ? parseJsonc(readFileSync(absPath, 'utf-8')) : {};
          const container = scope === 'global' && agent.globalNestedKey
            ? ensureNestedPath(config, agent.globalNestedKey)
            : (() => {
                assertSafeObjectKey(agent.key, 'agent config key');
                if (!readOwnRecord(config, agent.key)) config[agent.key] = {};
                return config[agent.key] as Record<string, unknown>;
              })();
          container.mindos = entry;
          writeFileSync(absPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
        }

        const result: MindosMcpInstallResult = { agent: key, status: 'ok', path: configPath, transport: effectiveTransport };

        if (effectiveTransport === 'http') {
          const verification = await verifyHttpConnection(String(entry.url), body.token, services.fetcher);
          result.verified = verification.verified;
          if (verification.verifyError) result.verifyError = verification.verifyError;
        }

        results.push(result);
      } catch (error) {
        results.push({ agent: key, status: 'error', message: String(error) });
      }
    }

    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleMcpUninstallPost(
  body: MindosMcpUninstallRequest,
  services: MindosMcpUninstallServices,
): MindosServerResponse<{ results: MindosMcpInstallResult[] } | { error: string }> {
  try {
    const results: MindosMcpInstallResult[] = [];

    for (const item of body.agents ?? []) {
      const { key, scope } = item;
      const agent = services.agents[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const configPaths = configPathCandidates(agent, scope);
      if (configPaths.length === 0) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      const existingPaths = configPaths.filter((configPath) => existsSync(expandHome(configPath, services.homeDir)));
      if (existingPaths.length === 0) {
        results.push({ agent: key, status: 'ok', message: 'Config file does not exist' });
        continue;
      }

      const updatedPaths: string[] = [];
      const errors: string[] = [];
      try {
        for (const configPath of existingPaths) {
          const absPath = expandHome(configPath, services.homeDir);
          try {
            if (agent.format === 'toml') {
              writeFileSync(absPath, removeTomlEntry(readFileSync(absPath, 'utf-8'), agent.key, 'mindos'), 'utf-8');
            } else {
              const config = parseJsonc(readFileSync(absPath, 'utf-8'));
              const container = scope === 'global' && agent.globalNestedKey
                ? getNestedPath(config, agent.globalNestedKey)
                : (() => {
                    assertSafeObjectKey(agent.key, 'agent config key');
                    return readOwnRecord(config, agent.key) ?? undefined;
                  })();
              if (container && 'mindos' in container) {
                delete container.mindos;
                writeFileSync(absPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
              }
            }
            updatedPaths.push(configPath);
          } catch (error) {
            errors.push(`${configPath}: ${String(error)}`);
          }
        }

        if (errors.length > 0) {
          results.push({ agent: key, status: 'error', message: errors.join('; ') });
        } else {
          results.push({ agent: key, status: 'ok', path: updatedPaths[0] ?? configPaths[0] });
        }
      } catch (error) {
        results.push({ agent: key, status: 'error', message: String(error) });
      }
    }

    return json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
