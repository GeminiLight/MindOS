/**
 * Shared MCP agent definitions for CLI tools.
 * Mirrors app/lib/mcp-agents.ts — keep in sync manually.
 *
 * Each agent entry includes presenceCli / presenceDirs for detecting
 * whether the agent is installed on the user's machine. To add a new
 * agent, add a single entry here — no separate table needed.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

function expandHome(p) {
  return p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p;
}

export const MCP_AGENTS = {
  'claude-code': {
    name: 'Claude Code',
    project: '.mcp.json',
    global: '~/.claude.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'claude',
    presenceDirs: ['~/.claude/'],
  },
  'claude-desktop': {
    name: 'Claude Desktop',
    project: null,
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : '~/.config/Claude/claude_desktop_config.json',
    key: 'mcpServers',
    preferredTransport: 'http',
    presenceDirs: ['~/Library/Application Support/Claude/', '~/.config/Claude/'],
  },
  'cursor': {
    name: 'Cursor',
    project: '.cursor/mcp.json',
    global: '~/.cursor/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.cursor/'],
  },
  'windsurf': {
    name: 'Windsurf',
    project: null,
    global: '~/.codeium/windsurf/mcp_config.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.codeium/windsurf/'],
  },
  'cline': {
    name: 'Cline',
    project: null,
    global: process.platform === 'darwin'
      ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'
      : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [
      '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/',
      '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/',
    ],
  },
  'trae': {
    name: 'Trae',
    project: '.trae/mcp.json',
    global: '~/.trae/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.trae/'],
  },
  'gemini-cli': {
    name: 'Gemini CLI',
    project: '.gemini/settings.json',
    global: '~/.gemini/settings.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'gemini',
    presenceDirs: ['~/.gemini/'],
  },
  'openclaw': {
    name: 'OpenClaw',
    project: null,
    global: '~/.openclaw/mcp.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'openclaw',
    presenceDirs: ['~/.openclaw/'],
  },
  'codebuddy': {
    name: 'CodeBuddy',
    project: null,
    global: '~/.claude-internal/.claude.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceCli: 'claude-internal',
    presenceDirs: ['~/.claude-internal/'],
  },
};

export function detectAgentPresence(agentKey) {
  const agent = MCP_AGENTS[agentKey];
  if (!agent) return false;
  if (agent.presenceCli) {
    try {
      execSync(
        process.platform === 'win32' ? `where ${agent.presenceCli}` : `which ${agent.presenceCli}`,
        { stdio: 'pipe' },
      );
      return true;
    } catch { /* not found */ }
  }
  if (agent.presenceDirs?.some(d => existsSync(expandHome(d)))) return true;
  return false;
}
