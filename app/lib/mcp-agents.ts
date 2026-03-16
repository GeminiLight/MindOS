import fs from 'fs';
import path from 'path';
import os from 'os';

export function expandHome(p: string): string {
  return p.startsWith('~/') ? path.resolve(os.homedir(), p.slice(2)) : p;
}

export interface AgentDef {
  name: string;
  project: string | null;
  global: string;
  key: string;
  preferredTransport: 'stdio' | 'http';
}

export const MCP_AGENTS: Record<string, AgentDef> = {
  'claude-code':    { name: 'Claude Code',    project: '.mcp.json',                       global: '~/.claude.json',    key: 'mcpServers', preferredTransport: 'stdio' },
  'claude-desktop': { name: 'Claude Desktop', project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '~/.config/Claude/claude_desktop_config.json', key: 'mcpServers', preferredTransport: 'http' },
  'cursor':         { name: 'Cursor',          project: '.cursor/mcp.json',                global: '~/.cursor/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'windsurf':       { name: 'Windsurf',        project: null,                               global: '~/.codeium/windsurf/mcp_config.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'cline':          { name: 'Cline',           project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'trae':           { name: 'Trae',            project: '.trae/mcp.json',                  global: '~/.trae/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'gemini-cli':     { name: 'Gemini CLI',      project: '.gemini/settings.json',           global: '~/.gemini/settings.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'openclaw':       { name: 'OpenClaw',        project: null,                               global: '~/.openclaw/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' },
  'codebuddy':      { name: 'CodeBuddy',       project: null,                               global: '~/.claude-internal/.claude.json', key: 'mcpServers', preferredTransport: 'stdio' },
};

export function detectInstalled(agentKey: string): { installed: boolean; scope?: string; transport?: string; configPath?: string } {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return { installed: false };

  for (const [scope, cfgPath] of [['global', agent.global], ['project', agent.project]] as const) {
    if (!cfgPath) continue;
    const absPath = expandHome(cfgPath);
    if (!fs.existsSync(absPath)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
      const servers = config[agent.key];
      if (servers?.mindos) {
        const entry = servers.mindos;
        const transport = entry.type === 'stdio' ? 'stdio' : entry.url ? 'http' : 'unknown';
        return { installed: true, scope, transport, configPath: cfgPath };
      }
    } catch { /* ignore parse errors */ }
  }

  return { installed: false };
}
