import { previewMindosMcpConfig } from '@geminilight/mindos/agent/config/preview';
import type { AgentInfo, McpStatus } from '@/components/settings/types';

export interface ConfigSnippet {
  snippet: string;
  displaySnippet: string;
  path: string;
}

function preview(agent: AgentInfo, transport: 'stdio' | 'http', url?: string, token?: string): string {
  return previewMindosMcpConfig({ key: agent.configKey, format: agent.format, globalNestedKey: agent.globalNestedKey, entryStyle: agent.entryStyle }, transport, { url, token });
}

export function generateStdioSnippet(agent: AgentInfo): ConfigSnippet {
  const snippet = preview(agent, 'stdio');
  return { snippet, displaySnippet: snippet, path: agent.globalPath };
}

export function generateHttpSnippet(agent: AgentInfo, endpoint: string, token?: string, maskedToken?: string): ConfigSnippet {
  return {
    snippet: preview(agent, 'http', endpoint, token),
    // Never put a revealed credential on screen, even when no masked value was supplied.
    displaySnippet: preview(agent, 'http', endpoint, maskedToken || (token ? '••••••••' : undefined)),
    path: agent.globalPath,
  };
}

export function generateSnippet(agent: AgentInfo, status: McpStatus | null, transport: 'stdio' | 'http', revealedToken?: string): ConfigSnippet {
  if (transport === 'stdio') return generateStdioSnippet(agent);
  return generateHttpSnippet(agent, status?.endpoint ?? `http://127.0.0.1:${status?.port ?? 8781}/mcp`, revealedToken, status?.maskedToken);
}
