export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.resolve(os.homedir(), p.slice(2)) : p;
}

interface AgentDef {
  name: string;
  project: string | null;
  global: string;
  key: string;
}

const MCP_AGENTS: Record<string, AgentDef> = {
  'claude-code':    { name: 'Claude Code',    project: '.mcp.json',                       global: '~/.claude.json',    key: 'mcpServers' },
  'claude-desktop': { name: 'Claude Desktop', project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '~/.config/Claude/claude_desktop_config.json', key: 'mcpServers' },
  'cursor':         { name: 'Cursor',          project: '.cursor/mcp.json',                global: '~/.cursor/mcp.json', key: 'mcpServers' },
  'windsurf':       { name: 'Windsurf',        project: null,                               global: '~/.codeium/windsurf/mcp_config.json', key: 'mcpServers' },
  'cline':          { name: 'Cline',           project: null,                               global: process.platform === 'darwin' ? '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' : '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json', key: 'mcpServers' },
  'trae':           { name: 'Trae',            project: '.trae/mcp.json',                  global: '~/.trae/mcp.json', key: 'mcpServers' },
  'gemini-cli':     { name: 'Gemini CLI',      project: '.gemini/settings.json',           global: '~/.gemini/settings.json', key: 'mcpServers' },
  'openclaw':       { name: 'OpenClaw',        project: null,                               global: '~/.openclaw/mcp.json', key: 'mcpServers' },
  'codebuddy':      { name: 'CodeBuddy',       project: null,                               global: '~/.claude-internal/.claude.json', key: 'mcpServers' },
};

interface InstallRequest {
  agents: Array<{ key: string; scope: 'project' | 'global' }>;
  transport: 'stdio' | 'http';
  url?: string;
  token?: string;
}

function buildEntry(transport: string, url?: string, token?: string) {
  if (transport === 'stdio') {
    return { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
  }
  const entry: Record<string, unknown> = { url: url || 'http://localhost:8787/mcp' };
  if (token) entry.headers = { Authorization: `Bearer ${token}` };
  return entry;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InstallRequest;
    const { agents, transport, url, token } = body;
    const entry = buildEntry(transport, url, token);
    const results: Array<{ agent: string; status: string; path?: string; message?: string }> = [];

    for (const { key, scope } of agents) {
      const agent = MCP_AGENTS[key];
      if (!agent) {
        results.push({ agent: key, status: 'error', message: `Unknown agent: ${key}` });
        continue;
      }

      const isGlobal = scope === 'global';
      const configPath = isGlobal ? agent.global : agent.project;
      if (!configPath) {
        results.push({ agent: key, status: 'error', message: `${agent.name} does not support ${scope} scope` });
        continue;
      }

      const absPath = expandHome(configPath);

      try {
        // Read existing config
        let config: Record<string, unknown> = {};
        if (fs.existsSync(absPath)) {
          config = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
        }

        // Merge — only touch mcpServers.mindos
        if (!config[agent.key]) config[agent.key] = {};
        (config[agent.key] as Record<string, unknown>).mindos = entry;

        // Write
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(absPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

        results.push({ agent: key, status: 'ok', path: configPath });
      } catch (err) {
        results.push({ agent: key, status: 'error', message: String(err) });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
