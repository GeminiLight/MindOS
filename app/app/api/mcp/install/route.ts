export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MCP_AGENTS, expandHome } from '@/lib/mcp-agents';

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
