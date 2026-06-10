/**
 * Shared MCP config snippet generation utilities.
 * Extracted from McpServerStatus.tsx for reuse in AgentsPanel.
 */

import type { AgentInfo, McpStatus } from '@/components/settings/types';

export interface ConfigSnippet {
  /** Snippet with full token — for clipboard copy */
  snippet: string;
  /** Snippet with masked token — for display in UI */
  displaySnippet: string;
  /** Target config file path */
  path: string;
}

function quotedConfigString(value: unknown): string {
  return JSON.stringify(String(value));
}

function yamlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : quotedConfigString(key);
}

function buildNestedObject(dotPath: string, leaf: Record<string, unknown>): Record<string, unknown> {
  const parts = dotPath.split('.').map((part) => part.trim()).filter(Boolean);
  const root: Record<string, unknown> = {};
  let current = root;
  for (const part of parts) {
    current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  Object.assign(current, leaf);
  return root;
}

function buildYamlSnippet(sectionKey: string, entry: Record<string, unknown>): string {
  const lines = [
    `${yamlKey(sectionKey)}:`,
    `  mindos:`,
  ];
  if (entry.type) lines.push(`    type: ${quotedConfigString(entry.type)}`);
  if (entry.command) lines.push(`    command: ${quotedConfigString(entry.command)}`);
  if (entry.url) lines.push(`    url: ${quotedConfigString(entry.url)}`);
  if (Array.isArray(entry.args)) {
    lines.push(`    args: [${entry.args.map(quotedConfigString).join(', ')}]`);
  }
  if (entry.env && typeof entry.env === 'object') {
    lines.push('    env:');
    for (const [key, value] of Object.entries(entry.env)) {
      lines.push(`      ${yamlKey(key)}: ${quotedConfigString(value)}`);
    }
  }
  if (entry.headers && typeof entry.headers === 'object') {
    lines.push('    headers:');
    for (const [key, value] of Object.entries(entry.headers)) {
      lines.push(`      ${yamlKey(key)}: ${quotedConfigString(value)}`);
    }
  }
  return lines.join('\n');
}

export function generateStdioSnippet(agent: AgentInfo): ConfigSnippet {
  const stdioEntry: Record<string, unknown> = agent.entryStyle === 'kilo'
    ? {
        type: 'local',
        command: ['mindos', 'mcp'],
        environment: { MCP_TRANSPORT: 'stdio' },
        enabled: true,
      }
    : {
        type: 'stdio',
        command: 'mindos',
        args: ['mcp'],
        env: { MCP_TRANSPORT: 'stdio' },
      };

  if (agent.format === 'toml') {
    const lines = [
      `[${agent.configKey}.mindos]`,
      `command = "mindos"`,
      `args = ["mcp"]`,
      '',
      `[${agent.configKey}.mindos.env]`,
      `MCP_TRANSPORT = "stdio"`,
    ];
    const s = lines.join('\n');
    return { snippet: s, displaySnippet: s, path: agent.globalPath };
  }

  if (agent.format === 'yaml') {
    const s = buildYamlSnippet(agent.configKey, stdioEntry);
    return { snippet: s, displaySnippet: s, path: agent.globalPath };
  }

  if (agent.globalNestedKey) {
    const s = JSON.stringify(buildNestedObject(agent.globalNestedKey, { mindos: stdioEntry }), null, 2);
    return { snippet: s, displaySnippet: s, path: agent.globalPath };
  }

  const s = JSON.stringify({ [agent.configKey]: { mindos: stdioEntry } }, null, 2);
  return { snippet: s, displaySnippet: s, path: agent.globalPath };
}

export function generateHttpSnippet(
  agent: AgentInfo,
  endpoint: string,
  token?: string,
  maskedToken?: string,
): ConfigSnippet {
  // Full token for copy
  const httpEntry: Record<string, unknown> = agent.entryStyle === 'kilo'
    ? { type: 'remote', url: endpoint, enabled: true }
    : { url: endpoint };
  if (token) httpEntry.headers = { Authorization: `Bearer ${token}` };

  // Masked token for display
  const displayEntry: Record<string, unknown> = agent.entryStyle === 'kilo'
    ? { type: 'remote', url: endpoint, enabled: true }
    : { url: endpoint };
  if (maskedToken) displayEntry.headers = { Authorization: `Bearer ${maskedToken}` };

  const buildSnippet = (entry: Record<string, unknown>) => {
    if (agent.format === 'toml') {
      const lines = [
        `[${agent.configKey}.mindos]`,
        `type = "http"`,
        `url = "${endpoint}"`,
      ];
      const authVal = (entry.headers as Record<string, string>)?.Authorization;
      if (authVal) {
        lines.push('');
        lines.push(`[${agent.configKey}.mindos.headers]`);
        lines.push(`Authorization = "${authVal}"`);
      }
      return lines.join('\n');
    }

    if (agent.format === 'yaml') {
      return buildYamlSnippet(agent.configKey, entry);
    }

    if (agent.globalNestedKey) {
      return JSON.stringify(buildNestedObject(agent.globalNestedKey, { mindos: entry }), null, 2);
    }

    return JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
  };

  return {
    snippet: buildSnippet(httpEntry),
    displaySnippet: buildSnippet(maskedToken ? displayEntry : httpEntry),
    path: agent.format === 'toml'
      ? agent.globalPath
      : agent.globalPath,
  };
}

/** Generate snippet based on transport mode */
export function generateSnippet(
  agent: AgentInfo,
  status: McpStatus | null,
  transport: 'stdio' | 'http',
  revealedToken?: string,
): ConfigSnippet {
  if (transport === 'stdio') {
    return generateStdioSnippet(agent);
  }
  // For remote/http mode, prefer localIP over endpoint (which is always localhost)
  const endpoint = status?.localIP
    ? `http://${status.localIP}:${status.port}/mcp`
    : (status?.endpoint ?? 'http://127.0.0.1:8781/mcp');
  return generateHttpSnippet(
    agent,
    endpoint,
    revealedToken,
    status?.maskedToken,
  );
}
