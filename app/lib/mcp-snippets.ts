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

export function generateStdioSnippet(agent: AgentInfo): ConfigSnippet {
  const stdioEntry: Record<string, unknown> = { type: 'stdio', command: 'mindos', args: ['mcp'] };

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

  if (agent.globalNestedKey) {
    const s = JSON.stringify({ [agent.configKey]: { mindos: stdioEntry } }, null, 2);
    return { snippet: s, displaySnippet: s, path: agent.projectPath ?? agent.globalPath };
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
  const httpEntry: Record<string, unknown> = { url: endpoint };
  if (token) httpEntry.headers = { Authorization: `Bearer ${token}` };

  // Masked token for display
  const displayEntry: Record<string, unknown> = { url: endpoint };
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

    if (agent.globalNestedKey) {
      return JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
    }

    return JSON.stringify({ [agent.configKey]: { mindos: entry } }, null, 2);
  };

  return {
    snippet: buildSnippet(httpEntry),
    displaySnippet: buildSnippet(token ? displayEntry : httpEntry),
    path: agent.format === 'toml'
      ? agent.globalPath
      : (agent.globalNestedKey ? (agent.projectPath ?? agent.globalPath) : agent.globalPath),
  };
}

/** Generate snippet based on transport mode */
export function generateSnippet(
  agent: AgentInfo,
  status: McpStatus | null,
  transport: 'stdio' | 'http',
): ConfigSnippet {
  if (transport === 'stdio') {
    return generateStdioSnippet(agent);
  }
  return generateHttpSnippet(
    agent,
    status?.endpoint ?? 'http://127.0.0.1:8781/mcp',
    status?.authToken,
    status?.maskedToken,
  );
}
